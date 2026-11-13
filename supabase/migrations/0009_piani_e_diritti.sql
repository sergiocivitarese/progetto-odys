-- =============================================================================
-- Odys · piani e diritti (specifiche per ruolo, 28 ottobre 2026).
--
-- Cinque profili: Traveller Base, Traveller Premium, Coordinatore Base,
-- Coordinatore Premium e Agenzia. Il client chiede al server i diritti
-- (`my_entitlements()`) e controlla un diritto per funzione, mai il piano.
--
-- La tabella `plan_entitlements` coincide con PLAN_ENTITLEMENTS di
-- packages/domain/src/lib/entitlements.ts (lo verifica un test).
-- Requisiti: TP-10, AG-09 (predisposizione), elementi trasversali (pagamenti:
-- abbonamenti gestiti come diritti di accesso), vincolo globale di 12 posti.
-- =============================================================================

create type public.plan_tier as enum ('traveller_base', 'traveller_premium', 'coordinator_base', 'coordinator_premium', 'agency');
create type public.subscription_plan as enum ('traveller_premium', 'coordinator_premium', 'agency');
create type public.subscription_status as enum ('active', 'cancelled', 'expired');
-- `self`: abbonamento personale; `agency_license`: licenza assegnata da un'agenzia;
-- `admin`: assegnato da un amministratore (demo e collaudo, finché mancano i pagamenti).
create type public.subscription_source as enum ('self', 'agency_license', 'admin');

create table public.plan_entitlements (
  plan public.plan_tier not null,
  entitlement text not null,
  primary key (plan, entitlement)
);

insert into public.plan_entitlements (plan, entitlement) values
  ('traveller_base', 'trips.book'),
  ('traveller_premium', 'trips.book'), ('traveller_premium', 'ai.generate'), ('traveller_premium', 'trips.insights'), ('traveller_premium', 'split.use'),
  ('coordinator_base', 'trips.book'), ('coordinator_base', 'ai.generate'), ('coordinator_base', 'trips.insights'), ('coordinator_base', 'split.use'),
  ('coordinator_base', 'trips.sell'), ('coordinator_base', 'participants.manage'), ('coordinator_base', 'posts.publish'),
  ('coordinator_premium', 'trips.book'), ('coordinator_premium', 'ai.generate'), ('coordinator_premium', 'trips.insights'), ('coordinator_premium', 'split.use'),
  ('coordinator_premium', 'trips.sell'), ('coordinator_premium', 'participants.manage'), ('coordinator_premium', 'posts.publish'), ('coordinator_premium', 'analytics.coordinator'),
  ('agency', 'ai.generate'), ('agency', 'trips.sell'), ('agency', 'participants.manage'), ('agency', 'posts.publish'),
  ('agency', 'agency.catalog'), ('agency', 'agency.team'), ('agency', 'agency.licenses'), ('agency', 'agency.umbrella'), ('agency', 'agency.dashboard');

comment on table public.plan_entitlements is 'Diritti di ogni profilo (tabella a pagina 2 delle specifiche per ruolo).';

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan public.subscription_plan not null,
  status public.subscription_status not null default 'active',
  source public.subscription_source not null default 'self',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create index subscriptions_user_idx on public.subscriptions (user_id, status);

comment on table public.subscriptions is 'Abbonamenti e licenze: danno diritti finché sono attivi e nel periodo di validità.';

create trigger subscriptions_touch
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- Profilo effettivo di un utente: stesso calcolo di resolvePlan() nel dominio.
create or replace function public.user_plan(p_user_id uuid)
returns public.plan_tier
language sql
stable
security definer
set search_path = ''
as $$
  with account as (
    select role from public.profiles where id = p_user_id and status = 'active'
  ), plans as (
    select array_agg(s.plan) as active
    from public.subscriptions s
    where s.user_id = p_user_id and s.status = 'active'
      and s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())
  )
  select case
    when a.role = 'agency' or 'agency' = any(coalesce(p.active, '{}')) then 'agency'
    when a.role in ('coordinator', 'admin') then
      case when 'coordinator_premium' = any(coalesce(p.active, '{}')) then 'coordinator_premium' else 'coordinator_base' end
    when 'traveller_premium' = any(coalesce(p.active, '{}')) or 'coordinator_premium' = any(coalesce(p.active, '{}')) then 'traveller_premium'
    else 'traveller_base'
  end::public.plan_tier
  from account a cross join plans p;
$$;

-- Diritti dell'utente collegato: un account sospeso non ne ha.
create or replace function public.my_entitlements()
returns table (plan public.plan_tier, entitlements text[])
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.id, p.role, public.user_plan(p.id) as plan
    from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
  )
  select me.plan,
         array(
           select e.entitlement from public.plan_entitlements e where e.plan = me.plan
           union
           select 'admin.moderate' where me.role = 'admin'
           order by 1
         )
  from me;
$$;

create or replace function public.has_entitlement(p_entitlement text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p_entitlement = any(entitlements) from public.my_entitlements()), false);
$$;

-- Assegnazione di un piano da parte dell'amministratore, con traccia nel registro.
-- `p_plan` null revoca i piani assegnati dall'amministratore.
create or replace function public.admin_set_plan(p_user_id uuid, p_plan public.subscription_plan, p_note text default null)
returns public.plan_tier
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.plan_tier;
  v_after public.plan_tier;
begin
  if not public.is_admin() then
    raise exception 'Solo un amministratore può assegnare un piano.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Account non trovato.' using errcode = 'P0002';
  end if;
  v_before := public.user_plan(p_user_id);
  update public.subscriptions set status = 'cancelled', ends_at = greatest(now(), starts_at + interval '1 second')
    where user_id = p_user_id and source = 'admin' and status = 'active';
  if p_plan is not null then
    insert into public.subscriptions (user_id, plan, source, created_by) values (p_user_id, p_plan, 'admin', auth.uid());
  end if;
  v_after := public.user_plan(p_user_id);
  insert into public.audit_log (actor_id, action, entity, entity_id, metadata)
    values (auth.uid(), 'account.plan', 'profile', p_user_id::text, jsonb_build_object(
      'from', v_before, 'to', v_after, 'note', nullif(btrim(coalesce(p_note, '')), '')));
  return v_after;
end;
$$;

-- Elenco account per l'amministratore, con il profilo effettivo.
drop function public.admin_accounts(text);
create function public.admin_accounts(p_query text default null)
returns table (id uuid, email text, first_name text, last_name text, role public.user_role, status public.account_status, created_at timestamptz, plan public.plan_tier)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Solo un amministratore può vedere gli account.' using errcode = '42501';
  end if;
  return query
    select p.id, u.email::text, p.first_name, p.last_name, p.role, p.status, p.created_at, public.user_plan(p.id)
    from public.profiles p
    join auth.users u on u.id = p.id
    where v_query is null
       or u.email ilike '%' || v_query || '%'
       or (p.first_name || ' ' || p.last_name) ilike '%' || v_query || '%'
    order by p.created_at desc
    limit 100;
end;
$$;

-- ---------------------------------------------------------------------------
-- Vincolo globale: al massimo 12 partecipanti per viaggio, coordinatore escluso.
-- ---------------------------------------------------------------------------
update public.published_trips set capacity = 12 where capacity > 12;
alter table public.published_trips add constraint published_trips_capacity_max check (capacity is null or capacity <= 12);

-- =============================================================================
-- Regole di accesso
-- =============================================================================
alter table public.plan_entitlements enable row level security;
alter table public.subscriptions enable row level security;

create policy plan_entitlements_select on public.plan_entitlements for select to anon, authenticated using (true);
-- Ognuno vede i propri abbonamenti; le modifiche passano solo dalle funzioni del server.
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

grant select on public.plan_entitlements to anon, authenticated;
grant select on public.subscriptions to authenticated;

revoke execute on function public.user_plan(uuid) from anon, authenticated, public;
revoke execute on function public.my_entitlements() from anon, public;
revoke execute on function public.has_entitlement(text) from anon, public;
revoke execute on function public.admin_set_plan(uuid, public.subscription_plan, text) from anon, public;
revoke execute on function public.admin_accounts(text) from anon, public;
grant execute on function public.my_entitlements() to authenticated;
grant execute on function public.has_entitlement(text) to authenticated;
grant execute on function public.admin_set_plan(uuid, public.subscription_plan, text) to authenticated;
grant execute on function public.admin_accounts(text) to authenticated;
