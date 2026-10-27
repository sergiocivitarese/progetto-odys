-- =============================================================================
-- Odys · Fase 1 — account, profili, viaggi con storico, preferenze, registro.
--
-- Requisiti coperti (analisi funzionale): U-08, U-10…U-13, S-01, S-02, S-04,
-- S-05, S-06, T-01, G-06 (traccia per assistenza), C-04 (consensi versionati).
--
-- Regole generali:
--   * ogni tabella esposta ha RLS attivo (S-01);
--   * ogni utente vede e modifica solo i propri dati;
--   * ruolo e stato dell'account li cambia solo un amministratore (G-02);
--   * ogni salvataggio di un itinerario crea una versione (storico) e
--     aggiorna una tabella strutturata delle attività, utile per analisi e AI.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tipi
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('traveler', 'coordinator', 'agency', 'admin');
create type public.account_status as enum ('active', 'suspended', 'disabled');

-- ---------------------------------------------------------------------------
-- Funzioni di supporto
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Converte una data 'AAAA-MM-GG' dell'itinerario; restituisce null se assente o non valida.
create or replace function public.odys_date(value text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if value is null or value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return value::date;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profili (U-12, U-13, S-05)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null default '' check (char_length(first_name) <= 80),
  last_name text not null default '' check (char_length(last_name) <= 80),
  birth_date date,
  bio text check (char_length(bio) <= 600),
  interests text[] not null default '{}',
  avatar_url text,
  role public.user_role not null default 'traveler',
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Dati personali minimi e ruolo di ogni account (1:1 con auth.users).';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

-- Età minima (S-05) e protezione di ruolo/stato (G-02).
create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.birth_date is not null and new.birth_date > (current_date - interval '18 years') then
    raise exception 'Per usare Odys devi avere almeno 18 anni.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE'
     and (new.role is distinct from old.role or new.status is distinct from old.status)
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_admin() then
    raise exception 'Solo un amministratore può modificare ruolo o stato dell''account.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_guard();

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Consensi versionati (S-04, C-04)
-- ---------------------------------------------------------------------------
create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('terms', 'privacy', 'marketing')),
  version text not null,
  granted boolean not null,
  created_at timestamptz not null default now()
);

create index consents_user_idx on public.consents (user_id, kind, created_at desc);

-- ---------------------------------------------------------------------------
-- Creazione automatica di profilo e consensi alla registrazione
-- (i dati arrivano dai metadati inviati con signUp)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  consent_version text := coalesce(meta ->> 'consent_version', '2026-10');
begin
  insert into public.profiles (id, first_name, last_name, birth_date)
  values (
    new.id,
    coalesce(meta ->> 'first_name', ''),
    coalesce(meta ->> 'last_name', ''),
    public.odys_date(meta ->> 'birth_date')
  );

  if coalesce((meta ->> 'accepted_terms')::boolean, false) then
    insert into public.consents (user_id, kind, version, granted)
    values (new.id, 'terms', consent_version, true),
           (new.id, 'privacy', consent_version, true);
  end if;

  if meta ? 'marketing_opt_in' then
    insert into public.consents (user_id, kind, version, granted)
    values (new.id, 'marketing', consent_version, coalesce((meta ->> 'marketing_opt_in')::boolean, false));
  end if;

  insert into public.user_preferences (user_id) values (new.id);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Preferenze dell'interfaccia (tema, onboarding)
-- ---------------------------------------------------------------------------
create table public.user_preferences (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  theme text not null default 'light' check (theme in ('light', 'dark', 'system')),
  onboarding_completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create trigger user_preferences_touch
  before update on public.user_preferences
  for each row execute function public.touch_updated_at();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Viaggi dell'utente (U-08, U-12) con eliminazione "morbida"
-- ---------------------------------------------------------------------------
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  destination text not null default '',
  departure date,
  return_date date,
  duration_days integer,
  pace text,
  itinerary jsonb not null,
  current_version integer not null default 1,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on column public.trips.itinerary is 'Itinerario completo (formato @odys/domain, compatibile con gli export Triply v5).';
comment on column public.trips.legacy_id is 'Identificativo di provenienza per gli import (export Odys/Triply).';
comment on column public.trips.deleted_at is 'Eliminazione morbida: il viaggio sparisce dalle liste ma lo storico resta.';

create index trips_owner_idx on public.trips (owner_id, updated_at desc) where deleted_at is null;
create unique index trips_owner_legacy_idx on public.trips (owner_id, legacy_id) where legacy_id is not null;

create trigger trips_touch
  before update on public.trips
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Storico delle versioni di ogni itinerario
-- ---------------------------------------------------------------------------
create table public.trip_versions (
  id bigint generated always as identity primary key,
  trip_id uuid not null references public.trips (id) on delete cascade,
  version integer not null,
  itinerary jsonb not null,
  change_kind text not null check (change_kind in (
    'created', 'edited', 'dates', 'budget', 'lodging', 'geography', 'progress', 'route', 'import', 'restore'
  )),
  summary text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (trip_id, version)
);

create index trip_versions_trip_idx on public.trip_versions (trip_id, version desc);

-- ---------------------------------------------------------------------------
-- Attività in forma strutturata (una riga per attività dell'ultima versione).
-- Base dati per ricerche, statistiche e futuri suggerimenti AI.
-- ---------------------------------------------------------------------------
create table public.trip_activities (
  trip_id uuid not null references public.trips (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  day_number integer not null,
  day_date date,
  position integer not null,
  start_time text,
  title text not null,
  category text,
  setting text,
  transport text,
  status text,
  completed boolean not null default false,
  requires_booking boolean not null default false,
  place_title text,
  city text,
  country text,
  latitude double precision,
  longitude double precision,
  geo_status text,
  destination text,
  pace text,
  primary key (trip_id, day_number, position)
);

create index trip_activities_city_idx on public.trip_activities (lower(city), category);
create index trip_activities_destination_idx on public.trip_activities (lower(destination));

-- ---------------------------------------------------------------------------
-- Salvataggio atomico: aggiorna il viaggio, crea la versione, rigenera le attività.
-- SECURITY INVOKER: valgono le regole RLS dell'utente che chiama.
-- p_record_version = false per aggiornamenti automatici (meteo, arricchimenti)
-- che non devono riempire lo storico.
-- ---------------------------------------------------------------------------
create or replace function public.save_trip(
  p_trip_id uuid,
  p_title text,
  p_itinerary jsonb,
  p_change_kind text default 'edited',
  p_summary text default null,
  p_legacy_id text default null,
  p_record_version boolean default true
)
returns public.trips
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_trip public.trips;
  v_destination text := coalesce(p_itinerary ->> 'destination', '');
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto.' using errcode = '28000';
  end if;
  if jsonb_typeof(p_itinerary -> 'days') is distinct from 'array' then
    raise exception 'Itinerario non valido.' using errcode = '22023';
  end if;

  if p_trip_id is null then
    insert into public.trips (owner_id, title, destination, departure, return_date, duration_days, pace, itinerary, current_version, legacy_id)
    values (
      auth.uid(),
      coalesce(nullif(btrim(p_title), ''), nullif(v_destination, ''), 'Viaggio'),
      v_destination,
      public.odys_date(p_itinerary ->> 'departure'),
      public.odys_date(p_itinerary ->> 'returnDate'),
      nullif(p_itinerary ->> 'duration', '')::integer,
      p_itinerary ->> 'pace',
      p_itinerary,
      1,
      p_legacy_id
    )
    returning * into v_trip;
  else
    update public.trips set
      title = coalesce(nullif(btrim(p_title), ''), title),
      destination = v_destination,
      departure = public.odys_date(p_itinerary ->> 'departure'),
      return_date = public.odys_date(p_itinerary ->> 'returnDate'),
      duration_days = nullif(p_itinerary ->> 'duration', '')::integer,
      pace = p_itinerary ->> 'pace',
      itinerary = p_itinerary,
      current_version = case when p_record_version then current_version + 1 else current_version end,
      deleted_at = null
    where id = p_trip_id and owner_id = auth.uid()
    returning * into v_trip;

    if not found then
      raise exception 'Viaggio non trovato.' using errcode = 'P0002';
    end if;
  end if;

  if p_record_version or p_trip_id is null then
    insert into public.trip_versions (trip_id, version, itinerary, change_kind, summary, created_by)
    values (v_trip.id, v_trip.current_version, p_itinerary, coalesce(p_change_kind, 'edited'), p_summary, auth.uid());
  end if;

  delete from public.trip_activities where trip_id = v_trip.id;
  insert into public.trip_activities (
    trip_id, owner_id, day_number, day_date, position, start_time, title, category, setting, transport,
    status, completed, requires_booking, place_title, city, country, latitude, longitude, geo_status, destination, pace
  )
  select
    v_trip.id,
    v_trip.owner_id,
    coalesce(nullif(d.day ->> 'day', '')::integer, d.day_index::integer),
    public.odys_date(d.day ->> 'date'),
    a.position::integer,
    a.activity ->> 'time',
    coalesce(nullif(a.activity ->> 'title', ''), 'Attività'),
    a.activity ->> 'category',
    a.activity ->> 'setting',
    a.activity ->> 'transport',
    a.activity ->> 'status',
    coalesce((a.activity ->> 'completed')::boolean, false),
    coalesce((a.activity ->> 'requiresBooking')::boolean, false),
    a.activity -> 'place' ->> 'title',
    a.activity -> 'place' ->> 'city',
    a.activity -> 'place' ->> 'country',
    nullif(a.activity -> 'place' ->> 'latitude', '')::double precision,
    nullif(a.activity -> 'place' ->> 'longitude', '')::double precision,
    a.activity -> 'place' ->> 'geoStatus',
    v_destination,
    p_itinerary ->> 'pace'
  from jsonb_array_elements(p_itinerary -> 'days') with ordinality as d(day, day_index)
  cross join lateral jsonb_array_elements(coalesce(d.day -> 'activities', '[]'::jsonb)) with ordinality as a(activity, position);

  return v_trip;
end;
$$;

-- ---------------------------------------------------------------------------
-- Idee di viaggio di gruppo salvate (U-08)
-- ---------------------------------------------------------------------------
create table public.saved_group_trips (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  group_trip_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, group_trip_id)
);

-- ---------------------------------------------------------------------------
-- Registro delle attività (S-06, G-06)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid default auth.uid() references auth.users (id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_actor_idx on public.audit_log (actor_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Cache del geocoding: condivisa, accessibile solo dal backend (service role).
-- ---------------------------------------------------------------------------
create table public.geocode_cache (
  query_key text primary key,
  nodes jsonb not null,
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- Regole di accesso (RLS)
-- =============================================================================
alter table public.profiles enable row level security;
alter table public.consents enable row level security;
alter table public.user_preferences enable row level security;
alter table public.trips enable row level security;
alter table public.trip_versions enable row level security;
alter table public.trip_activities enable row level security;
alter table public.saved_group_trips enable row level security;
alter table public.audit_log enable row level security;
alter table public.geocode_cache enable row level security; -- nessuna policy: solo service role

-- Profili: ognuno legge e aggiorna il proprio; l'amministratore li legge tutti.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Consensi: lettura dei propri; nuove scelte registrate come nuove righe.
create policy consents_select on public.consents for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy consents_insert on public.consents for insert to authenticated
  with check (user_id = auth.uid());

-- Preferenze
create policy preferences_all on public.user_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Viaggi
create policy trips_select on public.trips for select to authenticated
  using (owner_id = auth.uid());
create policy trips_insert on public.trips for insert to authenticated
  with check (owner_id = auth.uid());
create policy trips_update on public.trips for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Versioni: lettura e creazione solo sui propri viaggi; mai modificate o cancellate.
create policy trip_versions_select on public.trip_versions for select to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = auth.uid()));
create policy trip_versions_insert on public.trip_versions for insert to authenticated
  with check (exists (select 1 from public.trips t where t.id = trip_id and t.owner_id = auth.uid()));

-- Attività strutturate
create policy trip_activities_select on public.trip_activities for select to authenticated
  using (owner_id = auth.uid());
create policy trip_activities_insert on public.trip_activities for insert to authenticated
  with check (owner_id = auth.uid());
create policy trip_activities_delete on public.trip_activities for delete to authenticated
  using (owner_id = auth.uid());

-- Idee salvate
create policy saved_group_trips_all on public.saved_group_trips for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Registro: ognuno vede le proprie azioni, l'amministratore tutte; nessuna modifica.
create policy audit_log_select on public.audit_log for select to authenticated
  using (actor_id = auth.uid() or public.is_admin());
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (actor_id = auth.uid());

-- Permessi di base (Supabase li concede di default; li rendiamo espliciti).
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert on public.consents to authenticated;
grant select, insert, update on public.user_preferences to authenticated;
grant select, insert, update on public.trips to authenticated;
grant select, insert on public.trip_versions to authenticated;
grant select, insert, delete on public.trip_activities to authenticated;
grant select, insert, delete on public.saved_group_trips to authenticated;
grant select, insert on public.audit_log to authenticated;
grant execute on function public.save_trip(uuid, text, jsonb, text, text, text, boolean) to authenticated;
revoke all on public.geocode_cache from anon, authenticated;
