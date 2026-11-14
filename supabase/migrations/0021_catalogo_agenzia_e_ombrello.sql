-- =============================================================================
-- Odys · catalogo dell'agenzia e modalità ombrello (AG-03, AG-04, AG-11, AG-12).
--
-- * Catalogo (AG-03): l'agenzia crea viaggi propri (`agency_owned`) con lo
--   stesso editor del coordinatore; le partenze dello stesso viaggio
--   condividono `series_id`, ognuna con il suo coordinatore e i suoi 12 posti.
-- * Assegnazione (AG-04): una partenza d'agenzia può nascere senza
--   coordinatore, ma non si pubblica finché non ne ha uno del team.
-- * Ombrello (AG-11): `organizer = 'agency'` rende l'agenzia organizzatore
--   responsabile anche di un viaggio del coordinatore. Lo decidono proprietario
--   e amministratori (per coordinatore, come predefinito, o per viaggio); da lì
--   la pubblicazione richiede la loro approvazione e lo staff vede e gestisce il
--   viaggio. Ogni cambio di copertura va nel registro attività.
-- * Trasparenza (AG-12): le condizioni di vendita dell'agenzia (`sale_terms`)
--   compaiono nel checkout dei viaggi in ombrello.
-- Punto aperto deciso in via provvisoria: la copertura non cambia su un viaggio
-- con pagamenti già confermati.
-- =============================================================================

alter table public.agencies add column sale_terms text not null default '' check (char_length(sale_terms) <= 4000);
grant update (sale_terms) on public.agencies to authenticated;

alter table public.published_trips
  add column agency_id uuid references public.agencies (id) on delete set null,
  add column agency_owned boolean not null default false,
  add column series_id uuid,
  add column organizer text not null default 'coordinator' check (organizer in ('coordinator', 'agency'));

alter table public.published_trips alter column coordinator_id drop not null;
alter table public.published_trips add constraint published_trips_owner_check
  check (coordinator_id is not null or (agency_id is not null and agency_owned));
alter table public.published_trips add constraint published_trips_organizer_agency_check
  check (organizer = 'coordinator' or agency_id is not null);
alter table public.published_trips add constraint published_trips_agency_owned_check
  check (not agency_owned or (agency_id is not null and organizer = 'agency'));

create index published_trips_agency_idx on public.published_trips (agency_id, series_id) where agency_id is not null;

grant select (agency_id, agency_owned, series_id, organizer) on public.published_trips to anon, authenticated;

-- Staff dell'agenzia con un ruolo tra quelli indicati (coalesce: chi è fuori non passa).
create or replace function public.agency_staff(p_agency_id uuid, p_roles text[] default array['owner', 'admin', 'operator'])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_agency_id is not null and coalesce(public.agency_role_of(p_agency_id)::text, '') = any(p_roles);
$$;

-- Il coordinatore è nel team dell'agenzia (attivo, ruolo coordinatore)?
create or replace function public.agency_has_coordinator(p_agency_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.agency_members m join public.profiles p on p.id = m.user_id
    where m.agency_id = p_agency_id and m.user_id = p_user_id and m.status = 'active' and m.role = 'coordinator'
      and p.role in ('coordinator', 'admin') and p.status = 'active'
  );
$$;

-- Proprietario e amministratori vedono anche i viaggi dei coordinatori del team (per decidere l'ombrello).
create or replace function public.agency_staff_sees_trip(p_coordinator_id uuid, p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.agency_staff(p_agency_id)
      or exists (
        select 1 from public.agency_members me
        where me.user_id = auth.uid() and me.status = 'active' and me.role in ('owner', 'admin')
          and public.agency_has_coordinator(me.agency_id, p_coordinator_id)
      );
$$;

-- -----------------------------------------------------------------------------
-- Regole di accesso dei viaggi pubblicati, estese allo staff dell'agenzia.
-- -----------------------------------------------------------------------------
drop policy published_trips_owner_select on public.published_trips;
create policy published_trips_owner_select on public.published_trips for select to authenticated
  using (coordinator_id = auth.uid() or public.is_admin() or public.agency_staff_sees_trip(coordinator_id, agency_id));

drop policy published_trips_insert on public.published_trips;
create policy published_trips_insert on public.published_trips for insert to authenticated
  with check ((coordinator_id = auth.uid() and public.is_coordinator()) or (agency_owned and public.agency_staff(agency_id)));

drop policy published_trips_update on public.published_trips;
create policy published_trips_update on public.published_trips for update to authenticated
  using ((coordinator_id = auth.uid() and public.is_coordinator()) or public.is_admin() or public.agency_staff(agency_id))
  with check ((coordinator_id = auth.uid() and public.is_coordinator()) or public.is_admin() or public.agency_staff(agency_id));

-- Regole dell'agenzia sul singolo viaggio. Il flag `odys.agency_change` lo accendono solo le funzioni qui sotto.
create or replace function public.published_trips_agency_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_internal boolean := coalesce(current_setting('odys.agency_change', true), '') = '1';
  v_actor uuid := auth.uid();
  v_default uuid;
begin
  if tg_op = 'INSERT' and v_actor is not null and not v_internal then
    if new.agency_owned then
      if not public.agency_staff(new.agency_id) then
        raise exception 'Operazione non consentita.' using errcode = '42501';
      end if;
      new.organizer := 'agency';
      if new.coordinator_id is not null and not public.agency_has_coordinator(new.agency_id, new.coordinator_id) then
        raise exception 'Scegli un coordinatore del team dell’agenzia.' using errcode = '23514';
      end if;
    else
      if new.agency_id is not null or new.organizer <> 'coordinator' then
        raise exception 'La copertura dell’agenzia si decide dall’area agenzia.' using errcode = '42501';
      end if;
      -- Ombrello predefinito del coordinatore (AG-11): il viaggio nuovo nasce coperto dall'agenzia.
      select m.agency_id into v_default from public.agency_members m
        where m.user_id = new.coordinator_id and m.status = 'active' and m.role = 'coordinator' and m.umbrella_default
        order by m.accepted_at limit 1;
      if v_default is not null then
        new.agency_id := v_default;
        new.organizer := 'agency';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' and v_actor is not null and not v_internal then
    if new.agency_id is distinct from old.agency_id or new.organizer is distinct from old.organizer
       or new.agency_owned is distinct from old.agency_owned or new.series_id is distinct from old.series_id then
      raise exception 'La copertura dell’agenzia si decide dall’area agenzia.' using errcode = '42501';
    end if;
    if new.coordinator_id is distinct from old.coordinator_id then
      raise exception 'Il coordinatore di una partenza si assegna dall’area agenzia.' using errcode = '42501';
    end if;
  end if;

  if new.status in ('scheduled', 'published') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if new.coordinator_id is null then
      raise exception 'Assegna un coordinatore prima di pubblicare questa partenza.' using errcode = '23514';
    end if;
    if new.organizer = 'agency' and v_actor is not null and not public.agency_staff(new.agency_id, array['owner', 'admin']) then
      raise exception 'Questo viaggio è coperto dall’agenzia: lo pubblica l’agenzia dopo averlo approvato.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger published_trips_agency_guard
  before insert or update on public.published_trips
  for each row execute function public.published_trips_agency_guard();

-- -----------------------------------------------------------------------------
-- Catalogo (AG-03, AG-04)
-- -----------------------------------------------------------------------------
-- Nuova partenza dello stesso viaggio: stessi contenuti, date nuove, nessun coordinatore, in bozza.
create or replace function public.add_agency_departure(p_trip_id uuid, p_start date, p_end date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.published_trips;
  v_series uuid;
  v_id uuid;
begin
  select * into v_trip from public.published_trips where id = p_trip_id;
  if not found or not v_trip.agency_owned or not public.agency_staff(v_trip.agency_id) then
    raise exception 'Viaggio non trovato.' using errcode = 'P0002';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Indica date di partenza e rientro valide.' using errcode = '23514';
  end if;
  v_series := coalesce(v_trip.series_id, v_trip.id);
  perform set_config('odys.agency_change', '1', true);
  update public.published_trips set series_id = v_series where id = v_trip.id and series_id is null;
  insert into public.published_trips (
    coordinator_id, agency_id, agency_owned, organizer, series_id, status, title, summary, destination, start_date, end_date,
    price_cents, currency, capacity, included, excluded, cover_image_url, itinerary, country, region, interests,
    deposit_cents, visibility, age_min, age_max, place_stories)
  values (
    null, v_trip.agency_id, true, 'agency', v_series, 'draft', v_trip.title, v_trip.summary, v_trip.destination, p_start, p_end,
    v_trip.price_cents, v_trip.currency, v_trip.capacity, v_trip.included, v_trip.excluded, v_trip.cover_image_url, v_trip.itinerary,
    v_trip.country, v_trip.region, v_trip.interests, v_trip.deposit_cents, v_trip.visibility, v_trip.age_min, v_trip.age_max, v_trip.place_stories)
  returning id into v_id;
  perform set_config('odys.agency_change', '', true);
  insert into public.audit_log (action, entity, entity_id, metadata)
    values ('agency.departure_add', 'published_trip', v_id::text, jsonb_build_object('agency', v_trip.agency_id, 'series', v_series));
  return v_id;
end;
$$;

-- Coordinatore di una partenza del catalogo: uno del team, oppure nessuno finché è in bozza.
create or replace function public.assign_departure_coordinator(p_trip_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.published_trips;
begin
  select * into v_trip from public.published_trips where id = p_trip_id for update;
  if not found or not v_trip.agency_owned or not public.agency_staff(v_trip.agency_id) then
    raise exception 'Viaggio non trovato.' using errcode = 'P0002';
  end if;
  if p_user_id is not null and not public.agency_has_coordinator(v_trip.agency_id, p_user_id) then
    raise exception 'Scegli un coordinatore del team dell’agenzia.' using errcode = '23514';
  end if;
  if p_user_id is null and v_trip.status in ('published', 'scheduled') then
    raise exception 'Una partenza pubblicata ha sempre un coordinatore: scegline un altro invece di toglierlo.' using errcode = '23514';
  end if;
  perform set_config('odys.agency_change', '1', true);
  update public.published_trips set coordinator_id = p_user_id where id = p_trip_id;
  perform set_config('odys.agency_change', '', true);
  insert into public.audit_log (action, entity, entity_id, metadata)
    values ('agency.departure_coordinator', 'published_trip', p_trip_id::text, jsonb_build_object('agency', v_trip.agency_id, 'coordinator', p_user_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- Ombrello (AG-11)
-- -----------------------------------------------------------------------------
create or replace function public.set_trip_umbrella(p_trip_id uuid, p_agency_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.published_trips;
begin
  if not public.agency_staff(p_agency_id, array['owner', 'admin']) then
    raise exception 'Operazione non consentita.' using errcode = '42501';
  end if;
  select * into v_trip from public.published_trips where id = p_trip_id for update;
  if not found or v_trip.agency_owned or v_trip.coordinator_id is null or not public.agency_has_coordinator(p_agency_id, v_trip.coordinator_id) then
    raise exception 'Viaggio non trovato.' using errcode = 'P0002';
  end if;
  if v_trip.agency_id is not null and v_trip.agency_id <> p_agency_id then
    raise exception 'Questo viaggio è già coperto da un’altra agenzia.' using errcode = '23514';
  end if;
  if (v_trip.organizer = 'agency') = p_on then
    return;
  end if;
  if exists (
    select 1 from public.payments p join public.participation_requests r on r.id = p.request_id
    where r.published_trip_id = p_trip_id and p.status = 'confirmed'
  ) then
    raise exception 'Il viaggio ha già pagamenti confermati: la copertura non si cambia.' using errcode = '23514';
  end if;
  perform set_config('odys.agency_change', '1', true);
  update public.published_trips
    set agency_id = case when p_on then p_agency_id end, organizer = case when p_on then 'agency' else 'coordinator' end
    where id = p_trip_id;
  perform set_config('odys.agency_change', '', true);
  insert into public.audit_log (action, entity, entity_id, metadata)
    values (case when p_on then 'agency.umbrella_on' else 'agency.umbrella_off' end, 'published_trip', p_trip_id::text,
            jsonb_build_object('agency', p_agency_id, 'coordinator', v_trip.coordinator_id));
end;
$$;

create or replace function public.set_member_umbrella_default(p_member_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.agency_members;
begin
  select * into v_member from public.agency_members where id = p_member_id for update;
  if not found or not public.agency_staff(v_member.agency_id, array['owner', 'admin']) then
    raise exception 'Operazione non consentita.' using errcode = '42501';
  end if;
  if v_member.role <> 'coordinator' or v_member.status <> 'active' then
    raise exception 'L’ombrello predefinito vale per i coordinatori del team.' using errcode = '23514';
  end if;
  update public.agency_members set umbrella_default = p_on where id = p_member_id;
  insert into public.audit_log (action, entity, entity_id, metadata)
    values ('agency.umbrella_default', 'agency_member', p_member_id::text, jsonb_build_object('agency', v_member.agency_id, 'on', p_on));
end;
$$;

-- Lo staff vede i partecipanti e i costi dei viaggi dell'agenzia (catalogo e ombrello).
create or replace function public.coordinates_published_trip(p_published_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.published_trips t
    where t.id = p_published_trip_id and (t.coordinator_id = auth.uid() or public.agency_staff(t.agency_id))
  );
$$;

drop function public.trip_participants(uuid);
create function public.trip_participants(p_published_trip_id uuid)
returns table (
  id uuid, user_id uuid, status public.participation_status, message text,
  created_at timestamptz, decided_at timestamptz, first_name text, last_name text, email text,
  seat_number integer, price_cents integer, deposit_cents integer, currency text, balance_due_date date,
  age integer, shared_interests integer, balance_reminded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.published_trips t
    where t.id = p_published_trip_id and (t.coordinator_id = auth.uid() or public.is_admin() or public.agency_staff(t.agency_id))
  ) then
    raise exception 'Operazione non consentita.' using errcode = '42501';
  end if;
  return query
    select r.id, r.user_id, r.status, r.message, r.created_at, r.decided_at, p.first_name, p.last_name,
           case when r.status in ('confirmed', 'balance_paid') then u.email::text end,
           r.seat_number, r.price_cents, r.deposit_cents, r.currency, r.balance_due_date,
           case when p.birth_date is not null then extract(year from pg_catalog.age(p.birth_date::timestamp))::integer end,
           (select count(*)::integer from unnest(p.interests) i
             where lower(i) in (select lower(x) from unnest(t.interests) x)),
           r.balance_reminded_at
    from public.participation_requests r
    join public.published_trips t on t.id = r.published_trip_id
    join public.profiles p on p.id = r.user_id
    join auth.users u on u.id = r.user_id
    where r.published_trip_id = p_published_trip_id and r.status <> 'reserved'
    order by r.created_at;
end;
$$;

-- Vista pubblica dell'agenzia con le condizioni di vendita (AG-12), in coda alle colonne esistenti.
create or replace view public.agency_profiles
with (security_invoker = false)
as
  select a.id, a.slug, a.display_name, a.description, a.logo_url, a.email, a.phone, a.website, a.city, a.country, a.created_at,
         coalesce((select array_agg(m.user_id order by m.accepted_at) from public.agency_members m
                   join public.profiles p on p.id = m.user_id
                   where m.agency_id = a.id and m.status = 'active' and m.role = 'coordinator' and p.role in ('coordinator', 'admin') and p.status = 'active'), '{}') as coordinator_ids,
         a.sale_terms
  from public.agencies a;

grant select on public.agency_profiles to anon, authenticated;

revoke all on function public.agency_staff(uuid, text[]) from public, anon;
revoke all on function public.agency_has_coordinator(uuid, uuid) from public, anon;
revoke all on function public.agency_staff_sees_trip(uuid, uuid) from public, anon;
revoke all on function public.add_agency_departure(uuid, date, date) from public, anon;
revoke all on function public.assign_departure_coordinator(uuid, uuid) from public, anon;
revoke all on function public.set_trip_umbrella(uuid, uuid, boolean) from public, anon;
revoke all on function public.set_member_umbrella_default(uuid, boolean) from public, anon;
revoke all on function public.trip_participants(uuid) from public, anon;
revoke all on function public.published_trips_agency_guard() from public, anon, authenticated;
grant execute on function public.agency_staff(uuid, text[]) to authenticated;
grant execute on function public.agency_has_coordinator(uuid, uuid) to authenticated;
grant execute on function public.agency_staff_sees_trip(uuid, uuid) to authenticated;
grant execute on function public.add_agency_departure(uuid, date, date) to authenticated;
grant execute on function public.assign_departure_coordinator(uuid, uuid) to authenticated;
grant execute on function public.set_trip_umbrella(uuid, uuid, boolean) to authenticated;
grant execute on function public.set_member_umbrella_default(uuid, boolean) to authenticated;
grant execute on function public.trip_participants(uuid) to authenticated;
