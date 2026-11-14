-- =============================================================================
-- Odys · agenzie: profilo, ruoli interni, team e licenze (AG-01, AG-02, AG-05,
-- AG-09, AG-10).
--
-- Un'agenzia ha un proprietario (chi ha il piano Agenzia) e dei membri con un
-- ruolo interno: Proprietario, Amministratore, Operatore, Coordinatore. Un
-- coordinatore può essere Associato (indipendente) o Con licenza: la licenza è
-- una riga di `subscriptions` con `source = 'agency_license'` e piano
-- `coordinator_premium`, quindi i diritti arrivano e se ne vanno con il calcolo
-- esistente (`user_plan`). Ogni azione passa da una funzione che controlla il
-- ruolo; ogni assegnazione e revoca di licenza va nel registro attività.
-- Stesse regole di packages/domain/src/lib/agency.ts.
-- =============================================================================

create type public.agency_role as enum ('owner', 'admin', 'operator', 'coordinator');
create type public.agency_link_type as enum ('associated', 'licensed');
create type public.agency_member_status as enum ('invited', 'active', 'declined', 'removed');

create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  legal_name text not null check (char_length(btrim(legal_name)) between 2 and 160),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  description text not null default '' check (char_length(description) <= 1500),
  logo_url text check (logo_url is null or logo_url ~ '^https://'),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (char_length(phone) <= 40),
  website text check (website is null or website ~ '^https?://'),
  city text check (char_length(city) <= 80),
  country text check (char_length(country) <= 80),
  -- Licenze acquistate (AG-09, AG-10): l'acquisto è simulato finché non c'è il fornitore di pagamento.
  license_seats integer not null default 0 check (license_seats between 0 and 500),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'annual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.agencies is 'Agenzie (AG-01): profilo organizzazione e licenze acquistate.';

create trigger agencies_touch before update on public.agencies
  for each row execute function public.touch_updated_at();

create table public.agency_members (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.agency_role not null,
  link_type public.agency_link_type,
  status public.agency_member_status not null default 'invited',
  license_subscription_id uuid references public.subscriptions (id) on delete set null,
  umbrella_default boolean not null default false,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  removed_at timestamptz,
  unique (agency_id, user_id),
  check ((role = 'coordinator') = (link_type is not null))
);

create index agency_members_user_idx on public.agency_members (user_id, status);
comment on table public.agency_members is 'Membri dell''agenzia con ruolo interno (AG-02) e legame dei coordinatori (AG-05).';

-- Ruolo attivo dell'utente collegato in un'agenzia (null se non ne fa parte: nei controlli va con coalesce,
-- perché «null not in (...)» non è vero e lascerebbe passare chi è fuori dall'agenzia).
create or replace function public.agency_role_of(p_agency_id uuid)
returns public.agency_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.agency_members m
  where m.agency_id = p_agency_id and m.user_id = auth.uid() and m.status = 'active';
$$;

-- -----------------------------------------------------------------------------
-- Regole di accesso: i membri attivi leggono la propria agenzia; tutti leggono il profilo pubblico.
-- -----------------------------------------------------------------------------
alter table public.agencies enable row level security;
alter table public.agency_members enable row level security;

create policy agencies_member_select on public.agencies for select to authenticated
  using (public.agency_role_of(id) is not null);
-- Profilo (AG-01): proprietario e amministratori. Licenze e fatturazione solo dalle funzioni.
create policy agencies_profile_update on public.agencies for update to authenticated
  using (public.agency_role_of(id) in ('owner', 'admin'))
  with check (public.agency_role_of(id) in ('owner', 'admin'));
-- Ognuno vede le proprie appartenenze e i propri inviti; il team intero esce da agency_team().
create policy agency_members_own_select on public.agency_members for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.agencies, public.agency_members from anon, authenticated;
grant select on public.agencies, public.agency_members to authenticated;
grant update (legal_name, display_name, slug, description, logo_url, email, phone, website, city, country) on public.agencies to authenticated;

-- Profilo pubblico dell'agenzia (AG-01): solo dati pubblici e coordinatori attivi.
create or replace view public.agency_profiles
with (security_invoker = false)
as
  select a.id, a.slug, a.display_name, a.description, a.logo_url, a.email, a.phone, a.website, a.city, a.country, a.created_at,
         coalesce((select array_agg(m.user_id order by m.accepted_at) from public.agency_members m
                   join public.profiles p on p.id = m.user_id
                   where m.agency_id = a.id and m.status = 'active' and m.role = 'coordinator' and p.role in ('coordinator', 'admin') and p.status = 'active'), '{}') as coordinator_ids
  from public.agencies a;

grant select on public.agency_profiles to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Creazione dell'agenzia: chi ha il piano Agenzia, una per proprietario.
-- -----------------------------------------------------------------------------
create or replace function public.create_agency(p_legal_name text, p_display_name text, p_slug text)
returns public.agencies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency public.agencies;
begin
  if auth.uid() is null or not public.has_entitlement('agency.team') then
    raise exception 'Questa funzione è inclusa nel piano Agenzia.' using errcode = '42501';
  end if;
  if exists (select 1 from public.agencies where owner_id = auth.uid()) then
    raise exception 'Hai già un’agenzia.' using errcode = '23505';
  end if;
  if exists (select 1 from public.agencies where slug = p_slug) then
    raise exception 'Questo indirizzo è già usato da un’altra agenzia.' using errcode = '23505';
  end if;
  insert into public.agencies (owner_id, legal_name, display_name, slug)
    values (auth.uid(), btrim(p_legal_name), btrim(p_display_name), p_slug) returning * into v_agency;
  insert into public.agency_members (agency_id, user_id, role, status, accepted_at, invited_by)
    values (v_agency.id, auth.uid(), 'owner', 'active', now(), auth.uid());
  insert into public.audit_log (action, entity, entity_id) values ('agency.create', 'agency', v_agency.id::text);
  return v_agency;
end;
$$;

-- -----------------------------------------------------------------------------
-- Team (AG-05): elenco con legame, licenza e stato operativo del coordinatore.
-- -----------------------------------------------------------------------------
create or replace function public.agency_team(p_agency_id uuid)
returns table (
  id uuid, user_id uuid, first_name text, last_name text, email text, role public.agency_role,
  link_type public.agency_link_type, status public.agency_member_status, licensed boolean,
  umbrella_default boolean, created_at timestamptz, accepted_at timestamptz,
  is_coordinator boolean, verified boolean, trips_on_sale integer, trips_running integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.agency_role_of(p_agency_id)::text, '') not in ('owner', 'admin', 'operator') then
    raise exception 'Operazione non consentita.' using errcode = '42501';
  end if;
  return query
    select m.id, m.user_id, p.first_name, p.last_name, u.email::text, m.role, m.link_type, m.status,
           exists (select 1 from public.subscriptions s where s.id = m.license_subscription_id and s.status = 'active' and (s.ends_at is null or s.ends_at > now())),
           m.umbrella_default, m.created_at, m.accepted_at,
           p.role in ('coordinator', 'admin'),
           exists (select 1 from public.coordinator_applications a where a.user_id = m.user_id and a.status = 'approved'),
           (select count(*)::integer from public.published_trips t where t.coordinator_id = m.user_id and t.status = 'published' and (t.start_date is null or t.start_date > current_date)),
           (select count(*)::integer from public.published_trips t where t.coordinator_id = m.user_id and t.status = 'published' and t.start_date <= current_date and (t.end_date is null or t.end_date >= current_date))
    from public.agency_members m
    join public.profiles p on p.id = m.user_id
    join auth.users u on u.id = m.user_id
    where m.agency_id = p_agency_id and m.status in ('invited', 'active')
    order by case m.role when 'owner' then 0 when 'admin' then 1 when 'operator' then 2 else 3 end, m.created_at;
end;
$$;

-- Invito per email a un account Odys esistente (AG-05). Nessuna email parte: l'invito si vede nel profilo.
-- Il legame di un coordinatore nasce «associato»: diventa «con licenza» solo con assign_agency_license().
create or replace function public.invite_agency_member(p_agency_id uuid, p_email text, p_role public.agency_role)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_member public.agency_members;
begin
  if coalesce(public.agency_role_of(p_agency_id)::text, '') not in ('owner', 'admin') then
    raise exception 'Operazione non consentita.' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'Il proprietario è uno solo e non si invita.' using errcode = '23514';
  end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and status = 'active') then
    raise exception 'Nessun account Odys attivo con questa email: chiedi alla persona di registrarsi.' using errcode = 'P0002';
  end if;
  select * into v_member from public.agency_members where agency_id = p_agency_id and user_id = v_user;
  if found and v_member.status in ('invited', 'active') then
    raise exception 'Questa persona fa già parte del team o ha un invito in attesa.' using errcode = '23505';
  end if;
  if found then
    update public.agency_members
      set role = p_role, link_type = case when p_role = 'coordinator' then 'associated'::public.agency_link_type end,
          status = 'invited', invited_by = auth.uid(), created_at = now(), accepted_at = null, removed_at = null, license_subscription_id = null
      where id = v_member.id returning * into v_member;
  else
    insert into public.agency_members (agency_id, user_id, role, link_type, status, invited_by)
      values (p_agency_id, v_user, p_role, case when p_role = 'coordinator' then 'associated'::public.agency_link_type end, 'invited', auth.uid())
      returning * into v_member;
  end if;
  insert into public.audit_log (action, entity, entity_id, metadata)
    values ('agency.invite', 'agency_member', v_member.id::text, jsonb_build_object('agency', p_agency_id, 'role', p_role));
  return v_member.id;
end;
$$;

-- L'invitato accetta o rifiuta.
create or replace function public.respond_agency_invite(p_member_id uuid, p_accept boolean)
returns public.agency_member_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.agency_members;
begin
  select * into v_member from public.agency_members where id = p_member_id and user_id = auth.uid() for update;
  if not found or v_member.status <> 'invited' then
    raise exception 'Invito non trovato.' using errcode = 'P0002';
  end if;
  update public.agency_members
    set status = case when p_accept then 'active' else 'declined' end::public.agency_member_status,
        accepted_at = case when p_accept then now() end
    where id = p_member_id returning * into v_member;
  insert into public.audit_log (action, entity, entity_id, metadata)
    values (case when p_accept then 'agency.invite_accept' else 'agency.invite_decline' end, 'agency_member', p_member_id::text, jsonb_build_object('agency', v_member.agency_id));
  return v_member.status;
end;
$$;

-- Licenze (AG-09): assegnare dà subito i diritti del Coordinatore Premium; revocare li toglie.
create or replace function public.assign_agency_license(p_member_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.agency_members;
  v_agency public.agencies;
  v_used integer;
  v_subscription uuid;
begin
  select * into v_member from public.agency_members where id = p_member_id for update;
  if not found or coalesce(public.agency_role_of(v_member.agency_id)::text, '') not in ('owner', 'admin') then
    raise exception 'Operazione non consentita.' using errcode = '42501';
  end if;
  if v_member.role <> 'coordinator' or v_member.status <> 'active' then
    raise exception 'La licenza si assegna a un coordinatore che ha accettato l’invito.' using errcode = '23514';
  end if;
  if v_member.link_type = 'licensed' then
    raise exception 'Questo coordinatore ha già una licenza.' using errcode = '23505';
  end if;
  select * into v_agency from public.agencies where id = v_member.agency_id for update;
  select count(*) into v_used from public.agency_members m
    where m.agency_id = v_agency.id and m.status = 'active' and m.link_type = 'licensed';
  if v_used >= v_agency.license_seats then
    raise exception 'Non hai licenze libere: aumentane il numero.' using errcode = '23514';
  end if;
  insert into public.subscriptions (user_id, plan, status, source, created_by)
    values (v_member.user_id, 'coordinator_premium', 'active', 'agency_license', auth.uid()) returning id into v_subscription;
  update public.agency_members set link_type = 'licensed', license_subscription_id = v_subscription where id = p_member_id;
  insert into public.audit_log (action, entity, entity_id, metadata)
    values ('agency.license_assign', 'agency_member', p_member_id::text, jsonb_build_object('agency', v_agency.id, 'user', v_member.user_id));
  return v_subscription;
end;
$$;

create or replace function public.revoke_agency_license(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.agency_members;
begin
  select * into v_member from public.agency_members where id = p_member_id for update;
  if not found or coalesce(public.agency_role_of(v_member.agency_id)::text, '') not in ('owner', 'admin') then
    raise exception 'Operazione non consentita.' using errcode = '42501';
  end if;
  if v_member.link_type is distinct from 'licensed' then
    raise exception 'Questo coordinatore non ha una licenza.' using errcode = '23514';
  end if;
  update public.subscriptions set status = 'cancelled', ends_at = greatest(now(), starts_at + interval '1 second')
    where id = v_member.license_subscription_id and status = 'active';
  update public.agency_members set link_type = 'associated', license_subscription_id = null where id = p_member_id;
  insert into public.audit_log (action, entity, entity_id, metadata)
    values ('agency.license_revoke', 'agency_member', p_member_id::text, jsonb_build_object('agency', v_member.agency_id, 'user', v_member.user_id));
end;
$$;

-- Uscita dal team: chi ha una licenza la perde. Il proprietario non si rimuove.
create or replace function public.remove_agency_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.agency_members;
begin
  select * into v_member from public.agency_members where id = p_member_id for update;
  if not found or coalesce(public.agency_role_of(v_member.agency_id)::text, '') not in ('owner', 'admin') then
    raise exception 'Operazione non consentita.' using errcode = '42501';
  end if;
  if v_member.role = 'owner' then
    raise exception 'Il proprietario non si rimuove dal team.' using errcode = '23514';
  end if;
  if v_member.link_type = 'licensed' then
    perform public.revoke_agency_license(p_member_id);
  end if;
  update public.agency_members set status = 'removed', removed_at = now() where id = p_member_id;
  insert into public.audit_log (action, entity, entity_id, metadata)
    values ('agency.member_remove', 'agency_member', p_member_id::text, jsonb_build_object('agency', v_member.agency_id));
end;
$$;

-- Numero di licenze e fatturazione (AG-10): solo il proprietario. Non si scende sotto le licenze assegnate.
create or replace function public.set_agency_license_seats(p_agency_id uuid, p_seats integer, p_billing_cycle text)
returns public.agencies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
  v_agency public.agencies;
begin
  if public.agency_role_of(p_agency_id) is distinct from 'owner' then
    raise exception 'Solo il proprietario gestisce le licenze acquistate.' using errcode = '42501';
  end if;
  select count(*) into v_used from public.agency_members m
    where m.agency_id = p_agency_id and m.status = 'active' and m.link_type = 'licensed';
  if p_seats < v_used then
    raise exception 'Hai % licenze assegnate: revocane qualcuna prima di scendere a %.', v_used, p_seats using errcode = '23514';
  end if;
  update public.agencies set license_seats = p_seats, billing_cycle = p_billing_cycle where id = p_agency_id returning * into v_agency;
  insert into public.audit_log (action, entity, entity_id, metadata)
    values ('agency.license_seats', 'agency', p_agency_id::text, jsonb_build_object('seats', p_seats, 'billing_cycle', p_billing_cycle));
  return v_agency;
end;
$$;

revoke all on function public.agency_role_of(uuid) from public, anon;
revoke all on function public.create_agency(text, text, text) from public, anon;
revoke all on function public.agency_team(uuid) from public, anon;
revoke all on function public.invite_agency_member(uuid, text, public.agency_role) from public, anon;
revoke all on function public.respond_agency_invite(uuid, boolean) from public, anon;
revoke all on function public.assign_agency_license(uuid) from public, anon;
revoke all on function public.revoke_agency_license(uuid) from public, anon;
revoke all on function public.remove_agency_member(uuid) from public, anon;
revoke all on function public.set_agency_license_seats(uuid, integer, text) from public, anon;
grant execute on function public.agency_role_of(uuid) to authenticated;
grant execute on function public.create_agency(text, text, text) to authenticated;
grant execute on function public.agency_team(uuid) to authenticated;
grant execute on function public.invite_agency_member(uuid, text, public.agency_role) to authenticated;
grant execute on function public.respond_agency_invite(uuid, boolean) to authenticated;
grant execute on function public.assign_agency_license(uuid) to authenticated;
grant execute on function public.revoke_agency_license(uuid) to authenticated;
grant execute on function public.remove_agency_member(uuid) to authenticated;
grant execute on function public.set_agency_license_seats(uuid, integer, text) to authenticated;
