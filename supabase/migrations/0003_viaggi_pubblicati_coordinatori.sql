-- =============================================================================
-- Odys · viaggi pubblicati dai coordinatori, profili pubblici, salvataggi.
--
-- Requisiti: U-01…U-04, U-06…U-09, U-17, U-21 (itinerario gratuito: "usa come
-- base"), C-01/C-03 (ruolo attivato dall'amministratore), C-04 (linee guida),
-- C-06…C-09, C-12…C-14, P-06 (prezzi in centesimi), §11.2 (stati del viaggio).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Stati del viaggio pubblicato (§11.2)
-- ---------------------------------------------------------------------------
create type public.published_trip_status as enum (
  'draft', 'scheduled', 'published', 'active', 'completed', 'cancelled', 'archived'
);

-- Il coordinatore attivo: ruolo assegnato da un amministratore (C-01, C-03).
create or replace function public.is_coordinator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('coordinator', 'admin') and status = 'active'
  );
$$;

-- Ruolo e stato: il vincolo vale per gli utenti dell'app (ruoli API `anon` e
-- `authenticated`); chi gestisce il database dalla dashboard Supabase (ruolo
-- `postgres`) può assegnare i ruoli, come previsto da C-03 (attivazione manuale).
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
     and current_user in ('anon', 'authenticated')
     and not public.is_admin() then
    raise exception 'Solo un amministratore può modificare ruolo o stato dell''account.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Linee guida del coordinatore tra i consensi versionati (C-04).
alter table public.consents drop constraint consents_kind_check;
alter table public.consents add constraint consents_kind_check
  check (kind in ('terms', 'privacy', 'marketing', 'coordinator_guidelines'));

-- Copia di un viaggio pubblicato tra i propri viaggi (U-21).
alter table public.trip_versions drop constraint trip_versions_change_kind_check;
alter table public.trip_versions add constraint trip_versions_change_kind_check check (change_kind in (
  'created', 'edited', 'dates', 'budget', 'lodging', 'geography', 'progress', 'route', 'import', 'restore', 'copied'
));

-- ---------------------------------------------------------------------------
-- Profilo pubblico (U-04, U-09, C-06): solo i campi presentabili.
-- ---------------------------------------------------------------------------
alter table public.profiles add column public_headline text check (char_length(public_headline) <= 120);

-- Vista pubblica dei coordinatori: nome e iniziale del cognome, presentazione,
-- interessi. Nessun dato personale (data di nascita, email, stato) esce da qui.
create view public.coordinator_profiles
with (security_invoker = false)
as
  select
    p.id,
    p.first_name,
    left(p.last_name, 1) as last_initial,
    p.public_headline,
    p.bio,
    p.interests,
    p.avatar_url,
    p.created_at
  from public.profiles p
  where p.role in ('coordinator', 'admin') and p.status = 'active';

comment on view public.coordinator_profiles is 'Profilo pubblico dei coordinatori attivi (nessun dato personale riservato).';

-- ---------------------------------------------------------------------------
-- Viaggi pubblicati (offerta del coordinatore)
-- ---------------------------------------------------------------------------
create table public.published_trips (
  id uuid primary key default gen_random_uuid(),
  coordinator_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  source_trip_id uuid references public.trips (id) on delete set null,
  status public.published_trip_status not null default 'draft',
  title text not null check (char_length(title) between 3 and 120),
  summary text not null default '' check (char_length(summary) <= 600),
  destination text not null default '',
  start_date date,
  end_date date,
  duration_days integer,
  price_cents integer check (price_cents >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  capacity integer check (capacity > 0),
  included text[] not null default '{}',
  excluded text[] not null default '{}',
  cover_image_url text,
  itinerary jsonb not null,
  scheduled_for timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index published_trips_public_idx on public.published_trips (status, start_date);
create index published_trips_coordinator_idx on public.published_trips (coordinator_id, updated_at desc);
create index published_trips_destination_idx on public.published_trips (lower(destination));

create trigger published_trips_touch
  before update on public.published_trips
  for each row execute function public.touch_updated_at();

-- Visibile al pubblico: pubblicato, in corso, concluso, oppure programmato e giunto all'ora.
create or replace function public.published_trip_is_public(p_status public.published_trip_status, p_scheduled_for timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status in ('published', 'active', 'completed')
      or (p_status = 'scheduled' and p_scheduled_for is not null and p_scheduled_for <= now());
$$;

-- Validazioni prima di programmare o pubblicare (C-13) e date di pubblicazione (C-12).
create or replace function public.published_trips_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.duration_days := case when new.start_date is not null and new.end_date is not null
    then (new.end_date - new.start_date) + 1 else new.duration_days end;

  if new.status in ('scheduled', 'published') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if char_length(btrim(new.summary)) < 20 then
      raise exception 'Aggiungi una descrizione di almeno 20 caratteri prima di pubblicare.' using errcode = '23514';
    end if;
    if new.start_date is null or new.end_date is null or new.end_date < new.start_date then
      raise exception 'Indica date di partenza e rientro valide.' using errcode = '23514';
    end if;
    if new.start_date < current_date then
      raise exception 'La data di partenza è già passata.' using errcode = '23514';
    end if;
    if new.capacity is null then
      raise exception 'Indica il numero di posti disponibili.' using errcode = '23514';
    end if;
    if new.price_cents is null then
      raise exception 'Indica la quota di partecipazione.' using errcode = '23514';
    end if;
    if jsonb_array_length(coalesce(new.itinerary -> 'days', '[]'::jsonb)) = 0 then
      raise exception 'L’itinerario deve contenere almeno una giornata.' using errcode = '23514';
    end if;
  end if;

  if new.status = 'scheduled' then
    if new.scheduled_for is null or new.scheduled_for <= now() then
      raise exception 'Scegli una data e un’ora di pubblicazione future.' using errcode = '23514';
    end if;
  end if;

  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end;
$$;

create trigger published_trips_guard
  before insert or update on public.published_trips
  for each row execute function public.published_trips_guard();

-- ---------------------------------------------------------------------------
-- Viaggi pubblicati salvati dagli utenti (U-08)
-- ---------------------------------------------------------------------------
create table public.saved_published_trips (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  published_trip_id uuid not null references public.published_trips (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, published_trip_id)
);

-- Viaggio personale nato da un viaggio pubblicato (U-21: "usa come base").
alter table public.trips add column copied_from uuid references public.published_trips (id) on delete set null;

-- ---------------------------------------------------------------------------
-- "Usa come base": copia l'itinerario pubblico tra i viaggi dell'utente.
-- ---------------------------------------------------------------------------
create or replace function public.copy_published_trip(p_published_trip_id uuid)
returns public.trips
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.published_trips;
  v_trip public.trips;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto.' using errcode = '28000';
  end if;
  select * into v_source from public.published_trips where id = p_published_trip_id;
  if not found then
    raise exception 'Viaggio non trovato.' using errcode = 'P0002';
  end if;
  v_trip := public.save_trip(null, v_source.title, v_source.itinerary, 'copied', 'Creato a partire da un viaggio pubblicato');
  update public.trips set copied_from = v_source.id where id = v_trip.id returning * into v_trip;
  return v_trip;
end;
$$;

-- =============================================================================
-- Regole di accesso
-- =============================================================================
alter table public.published_trips enable row level security;
alter table public.saved_published_trips enable row level security;

-- Lettura: il pubblico vede solo i viaggi visibili; il coordinatore tutti i propri.
create policy published_trips_public_select on public.published_trips for select to anon, authenticated
  using (public.published_trip_is_public(status, scheduled_for));
create policy published_trips_owner_select on public.published_trips for select to authenticated
  using (coordinator_id = auth.uid() or public.is_admin());

-- Scrittura: solo coordinatori attivi, sui propri viaggi.
create policy published_trips_insert on public.published_trips for insert to authenticated
  with check (coordinator_id = auth.uid() and public.is_coordinator());
create policy published_trips_update on public.published_trips for update to authenticated
  using ((coordinator_id = auth.uid() and public.is_coordinator()) or public.is_admin())
  with check ((coordinator_id = auth.uid() and public.is_coordinator()) or public.is_admin());

create policy saved_published_trips_all on public.saved_published_trips for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select on public.published_trips to anon, authenticated;
grant insert, update on public.published_trips to authenticated;
grant select, insert, delete on public.saved_published_trips to authenticated;
grant select on public.coordinator_profiles to anon, authenticated;
grant execute on function public.copy_published_trip(uuid) to authenticated;
grant execute on function public.published_trip_is_public(public.published_trip_status, timestamptz) to anon, authenticated;
revoke execute on function public.copy_published_trip(uuid) from anon, public;
-- Il campo public_headline si aggiorna come gli altri campi del profilo.
grant update on public.profiles to authenticated;
