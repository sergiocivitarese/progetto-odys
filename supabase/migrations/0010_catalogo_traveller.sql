-- =============================================================================
-- Odys · catalogo per il Traveller Base (specifiche per ruolo).
--
-- Requisiti: TB-01…TB-07 (ricerca per intento, filtri, affinità, card e
-- dettaglio), TB-11 (Segui), CB-02 (interessi e fascia d'età del viaggio),
-- CB-04 (acconto e scadenza del saldo), CB-05 (visibilità), CP-05 (eventi
-- tracciati lato server: visualizzazione, salvataggio).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Dati del viaggio usati da ricerca, affinità e prenotazione
-- ---------------------------------------------------------------------------
create type public.trip_visibility as enum ('public', 'followers', 'invite');

alter table public.published_trips
  add column country text not null default '' check (char_length(country) <= 80),
  add column region text not null default '' check (char_length(region) <= 80),
  add column interests text[] not null default '{}' check (cardinality(interests) <= 12),
  add column deposit_cents integer check (deposit_cents >= 0),
  add column balance_due_date date,
  add column visibility public.trip_visibility not null default 'public',
  add column age_min integer check (age_min between 18 and 99),
  add column age_max integer check (age_max between 18 and 99),
  add constraint published_trips_age_range check (age_min is null or age_max is null or age_min <= age_max);

create index published_trips_country_idx on public.published_trips (lower(country));
create index published_trips_interests_idx on public.published_trips using gin (interests);

-- Viaggi già presenti: la meta era scritta «Città, Paese» e gli interessi stavano solo nell'itinerario.
update public.published_trips
  set country = btrim(split_part(destination, ',', 2)), destination = btrim(split_part(destination, ',', 1))
  where country = '' and destination ~ '^[^,]+,[^,]+$';
update public.published_trips
  set interests = array(select jsonb_array_elements_text(itinerary -> 'interests') limit 12)
  where interests = '{}' and jsonb_typeof(itinerary -> 'interests') = 'array';

-- Acconto e scadenza del saldo dei viaggi già presenti: valori provvisori
-- (un quarto della quota, saldo 30 giorni prima della partenza) finché il
-- cliente non decide la politica.
update public.published_trips
  set deposit_cents = least(price_cents, greatest(5000, (round(price_cents * 0.25 / 1000.0) * 1000)::integer))
  where deposit_cents is null and price_cents is not null;
update public.published_trips
  set balance_due_date = start_date - 30
  where balance_due_date is null and start_date is not null;

-- ---------------------------------------------------------------------------
-- Follower dei coordinatori (TB-11) — servono anche alla visibilità «Solo follower»
-- ---------------------------------------------------------------------------
create table public.coordinator_follows (
  follower_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  coordinator_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, coordinator_id),
  check (follower_id <> coordinator_id)
);

create index coordinator_follows_coordinator_idx on public.coordinator_follows (coordinator_id);

comment on table public.coordinator_follows is 'Chi segue quale coordinatore (TB-11).';

create or replace function public.coordinator_followers_count(p_coordinator_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.coordinator_follows where coordinator_id = p_coordinator_id;
$$;

-- ---------------------------------------------------------------------------
-- Visibilità (CB-05): Pubblico, Solo follower, Su invito.
-- «Su invito» resta fuori dal catalogo: lo vede chi lo coordina (gli inviti
-- arrivano con la creazione del viaggio in 4 passi).
-- ---------------------------------------------------------------------------
create or replace function public.published_trip_visible_to_me(p_trip public.published_trips)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.published_trip_is_public(p_trip.status, p_trip.scheduled_for)
     and (
       p_trip.visibility = 'public'
       or p_trip.coordinator_id = auth.uid()
       or (p_trip.visibility = 'followers' and exists (
            select 1 from public.coordinator_follows f
            where f.coordinator_id = p_trip.coordinator_id and f.follower_id = auth.uid()))
     );
$$;

drop policy published_trips_public_select on public.published_trips;
create policy published_trips_public_select on public.published_trips for select to anon, authenticated
  using (public.published_trip_visible_to_me(published_trips));

-- Validazioni prima di programmare o pubblicare (CB-05): aggiunge acconto,
-- scadenza del saldo e limite di 12 posti a quelle esistenti.
create or replace function public.published_trips_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.duration_days := case when new.start_date is not null and new.end_date is not null
    then (new.end_date - new.start_date) + 1 else new.duration_days end;

  if new.capacity is not null and new.capacity > 12 then
    raise exception 'Ogni viaggio ha al massimo 12 partecipanti.' using errcode = '23514';
  end if;
  if new.deposit_cents is not null and new.price_cents is not null and new.deposit_cents > new.price_cents then
    raise exception 'L’acconto non può superare la quota di partecipazione.' using errcode = '23514';
  end if;

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
    -- Valori provvisori se il coordinatore non li indica (politica da definire con il cliente).
    new.deposit_cents := coalesce(new.deposit_cents,
      least(new.price_cents, greatest(5000, (round(new.price_cents * 0.25 / 1000.0) * 1000)::integer)));
    new.balance_due_date := coalesce(new.balance_due_date, greatest(current_date, new.start_date - 30));
  end if;

  if new.balance_due_date is not null and new.start_date is not null and new.balance_due_date > new.start_date then
    raise exception 'Il saldo va pagato entro la data di partenza.' using errcode = '23514';
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

-- Posti occupati di più viaggi in una sola chiamata (card del catalogo, TB-05).
create or replace function public.published_trips_seats_taken(p_trip_ids uuid[])
returns table (trip_id uuid, taken integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.published_trip_id, count(*)::integer
  from public.participation_requests r
  join public.published_trips t on t.id = r.published_trip_id
  where r.published_trip_id = any(p_trip_ids)
    and r.status = 'confirmed'
    and public.published_trip_is_public(t.status, t.scheduled_for)
  group by r.published_trip_id;
$$;

-- ---------------------------------------------------------------------------
-- Eventi tracciati lato server (CP-05): la base di funnel e statistiche.
-- I client non scrivono né leggono la tabella: gli eventi nascono dai trigger
-- (salvataggio, richiesta, pagamento) o dalla funzione delle visualizzazioni.
-- ---------------------------------------------------------------------------
create type public.trip_event_kind as enum ('view', 'save', 'request', 'payment_confirmed');

create table public.trip_events (
  id bigint generated always as identity primary key,
  published_trip_id uuid not null references public.published_trips (id) on delete cascade,
  kind public.trip_event_kind not null,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index trip_events_trip_idx on public.trip_events (published_trip_id, kind, created_at desc);

comment on table public.trip_events is 'Eventi dei viaggi pubblicati (visualizzazione, salvataggio, richiesta, pagamento): scritti solo dal server.';

-- Visualizzazione del dettaglio: una al giorno per utente collegato; chi coordina il viaggio non conta.
create or replace function public.record_trip_view(p_published_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.published_trips;
begin
  select * into v_trip from public.published_trips where id = p_published_trip_id;
  if not found or not public.published_trip_visible_to_me(v_trip) or v_trip.coordinator_id = auth.uid() then
    return;
  end if;
  if auth.uid() is not null and exists (
    select 1 from public.trip_events e
    where e.published_trip_id = p_published_trip_id and e.kind = 'view' and e.user_id = auth.uid()
      and e.created_at >= date_trunc('day', now())
  ) then
    return;
  end if;
  insert into public.trip_events (published_trip_id, kind, user_id) values (p_published_trip_id, 'view', auth.uid());
end;
$$;

create or replace function public.saved_published_trips_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.trip_events (published_trip_id, kind, user_id) values (new.published_trip_id, 'save', new.user_id);
  return new;
end;
$$;

create trigger saved_published_trips_event
  after insert on public.saved_published_trips
  for each row execute function public.saved_published_trips_event();

-- =============================================================================
-- Regole di accesso
-- =============================================================================
alter table public.coordinator_follows enable row level security;
alter table public.trip_events enable row level security; -- nessuna policy: solo funzioni del server

-- Ognuno vede e gestisce chi segue; si seguono solo coordinatori attivi.
create policy coordinator_follows_select on public.coordinator_follows for select to authenticated
  using (follower_id = (select auth.uid()));
create policy coordinator_follows_insert on public.coordinator_follows for insert to authenticated
  with check (follower_id = (select auth.uid())
    and exists (select 1 from public.coordinator_profiles c where c.id = coordinator_id));
create policy coordinator_follows_delete on public.coordinator_follows for delete to authenticated
  using (follower_id = (select auth.uid()));

grant select, insert, delete on public.coordinator_follows to authenticated;
revoke all on public.trip_events from anon, authenticated;

revoke execute on function public.published_trip_visible_to_me(public.published_trips) from public;
revoke execute on function public.coordinator_followers_count(uuid) from public;
revoke execute on function public.published_trips_seats_taken(uuid[]) from public;
revoke execute on function public.record_trip_view(uuid) from public;
revoke execute on function public.saved_published_trips_event() from anon, authenticated, public;
grant execute on function public.published_trip_visible_to_me(public.published_trips) to anon, authenticated;
grant execute on function public.coordinator_followers_count(uuid) to anon, authenticated;
grant execute on function public.published_trips_seats_taken(uuid[]) to anon, authenticated;
grant execute on function public.record_trip_view(uuid) to anon, authenticated;
