-- =============================================================================
-- Odys · AI dell'agenzia per i coordinatori del team (AG-06).
--
-- * Impostazioni dell'agenzia: interruttore, fornitori convenzionati (usati per
--   primi: finiscono nelle indicazioni dell'itinerario generato) e margine
--   minimo sotto il quale il viaggio si pubblica solo dopo l'approvazione.
-- * Storico delle generazioni: le scrive il server quando un coordinatore del
--   team genera con l'AI dell'agenzia; stato «da revisionare» o «approvata»,
--   e il viaggio in cui è stata convertita.
-- La regola del margine la applica l'API alla pubblicazione (il margine si
-- calcola dai costi del viaggio con packages/domain/src/lib/tripPricing.ts).
-- =============================================================================

alter table public.agencies
  add column ai_enabled boolean not null default false,
  add column ai_min_margin_percent integer check (ai_min_margin_percent between 0 and 90),
  add column ai_suppliers text[] not null default '{}' check (cardinality(ai_suppliers) <= 20);

grant update (ai_enabled, ai_min_margin_percent, ai_suppliers) on public.agencies to authenticated;

create table public.agency_ai_generations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  coordinator_id uuid not null references public.profiles (id) on delete cascade,
  destination text not null check (char_length(destination) <= 120),
  title text not null check (char_length(title) <= 160),
  days integer not null check (days between 1 and 60),
  total_cents integer,
  budget_cents integer,
  suppliers text[] not null default '{}',
  status text not null default 'to_review' check (status in ('to_review', 'approved')),
  published_trip_id uuid references public.published_trips (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index agency_ai_generations_agency_idx on public.agency_ai_generations (agency_id, created_at desc);
comment on table public.agency_ai_generations is 'Storico delle generazioni con l''AI dell''agenzia (AG-06): le scrive solo il server.';

alter table public.published_trips add column ai_generation_id uuid references public.agency_ai_generations (id) on delete set null;
grant select (ai_generation_id) on public.published_trips to authenticated;

-- Il collegamento alla generazione non lo cambia il client (lo imposta solo record_agency_ai_generation).
create or replace function public.published_trips_ai_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and coalesce(current_setting('odys.agency_change', true), '') <> '1'
     and new.ai_generation_id is distinct from (case when tg_op = 'UPDATE' then old.ai_generation_id end) then
    raise exception 'La generazione dell’agenzia si collega solo dal generatore.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger published_trips_ai_guard
  before insert or update on public.published_trips
  for each row execute function public.published_trips_ai_guard();

alter table public.agency_ai_generations enable row level security;
-- Lo vede il coordinatore che ha generato e lo staff dell'agenzia.
create policy agency_ai_generations_select on public.agency_ai_generations for select to authenticated
  using (coordinator_id = (select auth.uid()) or public.agency_staff(agency_id));
revoke all on public.agency_ai_generations from anon, authenticated;
grant select on public.agency_ai_generations to authenticated;

-- Registra la generazione e la collega al viaggio appena creato dal coordinatore.
create or replace function public.record_agency_ai_generation(
  p_agency_id uuid, p_trip_id uuid, p_destination text, p_title text, p_days integer, p_total_cents integer, p_budget_cents integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency public.agencies;
  v_id uuid;
begin
  select * into v_agency from public.agencies where id = p_agency_id;
  if not found or not v_agency.ai_enabled or not public.agency_has_coordinator(p_agency_id, auth.uid()) then
    raise exception 'L’AI di questa agenzia non è attiva per te.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.published_trips t where t.id = p_trip_id and t.coordinator_id = auth.uid()) then
    raise exception 'Viaggio non trovato.' using errcode = 'P0002';
  end if;
  insert into public.agency_ai_generations (agency_id, coordinator_id, destination, title, days, total_cents, budget_cents, suppliers, published_trip_id)
    values (p_agency_id, auth.uid(), left(p_destination, 120), left(p_title, 160), p_days, p_total_cents, p_budget_cents, v_agency.ai_suppliers, p_trip_id)
    returning id into v_id;
  perform set_config('odys.agency_change', '1', true);
  update public.published_trips set ai_generation_id = v_id where id = p_trip_id;
  perform set_config('odys.agency_change', '', true);
  insert into public.audit_log (action, entity, entity_id, metadata)
    values ('agency.ai_generate', 'agency_ai_generation', v_id::text, jsonb_build_object('agency', p_agency_id, 'trip', p_trip_id));
  return v_id;
end;
$$;

-- Proprietario e amministratori approvano (anche sotto il margine minimo).
create or replace function public.review_agency_ai_generation(p_generation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generation public.agency_ai_generations;
begin
  select * into v_generation from public.agency_ai_generations where id = p_generation_id for update;
  if not found or not public.agency_staff(v_generation.agency_id, array['owner', 'admin']) then
    raise exception 'Generazione non trovata.' using errcode = 'P0002';
  end if;
  update public.agency_ai_generations set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() where id = p_generation_id;
  insert into public.audit_log (action, entity, entity_id, metadata)
    values ('agency.ai_review', 'agency_ai_generation', p_generation_id::text, jsonb_build_object('agency', v_generation.agency_id));
end;
$$;

revoke all on function public.published_trips_ai_guard() from public, anon, authenticated;
revoke all on function public.record_agency_ai_generation(uuid, uuid, text, text, integer, integer, integer) from public, anon;
revoke all on function public.review_agency_ai_generation(uuid) from public, anon;
grant execute on function public.record_agency_ai_generation(uuid, uuid, text, text, integer, integer, integer) to authenticated;
grant execute on function public.review_agency_ai_generation(uuid) to authenticated;
