-- =============================================================================
-- Odys · la storia dei luoghi si legge solo con il diritto (TP-08, TP-10).
--
-- Finora il controllo «solo Premium» lo faceva l'API, ma la colonna
-- `place_stories` restava leggibile direttamente dal database con la chiave
-- pubblica. Ora i ruoli dell'app non hanno più il permesso di lettura su
-- quella colonna: il testo esce solo da `published_trip_place_stories()`, che
-- verifica il diritto `trips.insights` (o che chi chiede coordini il viaggio).
-- =============================================================================

-- Lettura: tutte le colonne tranne `place_stories`.
revoke select on public.published_trips from anon, authenticated;
grant select (
  id, coordinator_id, source_trip_id, status, title, summary, destination, start_date, end_date, duration_days,
  price_cents, currency, capacity, included, excluded, cover_image_url, itinerary, scheduled_for, published_at,
  created_at, updated_at, country, region, interests, deposit_cents, balance_due_date, visibility, age_min, age_max
) on public.published_trips to anon, authenticated;

-- La regola di visibilità non deve più leggere l'intera riga (che comprende la colonna riservata).
create or replace function public.published_trip_visible(
  p_status public.published_trip_status, p_scheduled_for timestamptz, p_visibility public.trip_visibility, p_coordinator_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.published_trip_is_public(p_status, p_scheduled_for)
     and (
       p_visibility = 'public'
       or p_coordinator_id = auth.uid()
       or (p_visibility = 'followers' and exists (
            select 1 from public.coordinator_follows f
            where f.coordinator_id = p_coordinator_id and f.follower_id = auth.uid()))
     );
$$;

drop policy published_trips_public_select on public.published_trips;
create policy published_trips_public_select on public.published_trips for select to anon, authenticated
  using (public.published_trip_visible(status, scheduled_for, visibility, coordinator_id));

-- «Usa come base» leggeva tutta la riga con i permessi dell'utente: ora solo ciò che copia.
create or replace function public.copy_published_trip(p_published_trip_id uuid)
returns public.trips
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_title text;
  v_itinerary jsonb;
  v_trip public.trips;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto.' using errcode = '28000';
  end if;
  select title, itinerary into v_title, v_itinerary from public.published_trips where id = p_published_trip_id;
  if not found then
    raise exception 'Viaggio non trovato.' using errcode = 'P0002';
  end if;
  v_trip := public.save_trip(null, v_title, v_itinerary, 'copied', 'Creato a partire da un viaggio pubblicato');
  update public.trips set copied_from = p_published_trip_id where id = v_trip.id returning * into v_trip;
  return v_trip;
end;
$$;

-- Quante storie ha un viaggio visibile: serve a tutti, per l'invito a Premium.
create or replace function public.published_trip_place_stories_count(p_published_trip_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_array_length(t.place_stories) from public.published_trips t
    where t.id = p_published_trip_id
      and (t.coordinator_id = auth.uid() or public.published_trip_visible(t.status, t.scheduled_for, t.visibility, t.coordinator_id))
  ), 0);
$$;

-- Il testo delle storie: a chi coordina il viaggio, all'amministratore e a chi ha il diritto `trips.insights`.
-- Per tutti gli altri restituisce null.
create or replace function public.published_trip_place_stories(p_published_trip_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select t.place_stories from public.published_trips t
  where t.id = p_published_trip_id
    and (
      t.coordinator_id = auth.uid()
      or public.is_admin()
      or (public.has_entitlement('trips.insights') and public.published_trip_visible(t.status, t.scheduled_for, t.visibility, t.coordinator_id))
    );
$$;

revoke execute on function public.published_trip_visible(public.published_trip_status, timestamptz, public.trip_visibility, uuid) from public;
revoke execute on function public.published_trip_place_stories_count(uuid) from public;
revoke execute on function public.published_trip_place_stories(uuid) from anon, public;
grant execute on function public.published_trip_visible(public.published_trip_status, timestamptz, public.trip_visibility, uuid) to anon, authenticated;
grant execute on function public.published_trip_place_stories_count(uuid) to anon, authenticated;
grant execute on function public.published_trip_place_stories(uuid) to authenticated;
