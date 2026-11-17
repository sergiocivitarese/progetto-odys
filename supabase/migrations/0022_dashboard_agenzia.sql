-- =============================================================================
-- Odys · dashboard dell'agenzia (AG-07).
--
-- * Canale della prenotazione: `odys` (community Odys) o `direct` (canali
--   diretti dell'agenzia o del coordinatore). Regola provvisoria: è diretto chi
--   arriva dal link condiviso fuori da Odys (kit social, `?canale=diretto`) e
--   ogni prenotazione di un viaggio «Su invito».
-- * `agency_dashboard_data()`: viaggi, pagamenti e prenotazioni dei viaggi
--   dell'agenzia (catalogo e ombrello) per proprietario e amministratori, senza
--   dati personali dei viaggiatori. Gli aggregati li calcola
--   packages/domain/src/lib/agencyDashboard.ts.
-- =============================================================================

alter table public.participation_requests add column channel text not null default 'odys' check (channel in ('odys', 'direct'));

create or replace function public.participation_channel_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.published_trips t where t.id = new.published_trip_id and t.visibility = 'invite') then
    new.channel := 'direct';
  end if;
  return new;
end;
$$;

create trigger participation_channel_guard
  before insert on public.participation_requests
  for each row execute function public.participation_channel_guard();

create or replace function public.agency_dashboard_data(p_agency_id uuid, p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.agency_staff(p_agency_id, array['owner', 'admin']) then
    raise exception 'I dati dell’agenzia li vedono proprietario e amministratori.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'trips', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'coordinatorId', t.coordinator_id, 'status', t.status, 'startDate', t.start_date, 'endDate', t.end_date,
        'scheduledFor', t.scheduled_for, 'capacity', t.capacity,
        'sold', (select count(*) from public.participation_requests r where r.published_trip_id = t.id and r.status in ('confirmed', 'balance_paid'))
      ) order by t.start_date nulls last)
      from public.published_trips t where t.agency_id = p_agency_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('tripId', r.published_trip_id, 'amountCents', p.amount_cents, 'at', p.confirmed_at) order by p.confirmed_at)
      from public.payments p
      join public.participation_requests r on r.id = p.request_id
      join public.published_trips t on t.id = r.published_trip_id
      where t.agency_id = p_agency_id and p.status = 'confirmed' and p.confirmed_at >= p_since
    ), '[]'::jsonb),
    -- Prenotazione = acconto confermato, con il canale da cui è arrivata.
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object('tripId', r.published_trip_id, 'channel', r.channel, 'at', p.confirmed_at) order by p.confirmed_at)
      from public.payments p
      join public.participation_requests r on r.id = p.request_id
      join public.published_trips t on t.id = r.published_trip_id
      where t.agency_id = p_agency_id and p.kind = 'deposit' and p.status = 'confirmed' and p.confirmed_at >= p_since
    ), '[]'::jsonb),
    'coordinators', coalesce((
      select jsonb_agg(jsonb_build_object('userId', m.user_id, 'name', p.first_name || ' ' || left(p.last_name, 1) || '.', 'licensed', m.link_type = 'licensed') order by p.first_name)
      from public.agency_members m join public.profiles p on p.id = m.user_id
      where m.agency_id = p_agency_id and m.status = 'active' and m.role = 'coordinator'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.participation_channel_guard() from public, anon, authenticated;
revoke all on function public.agency_dashboard_data(uuid, timestamptz) from public, anon;
grant execute on function public.agency_dashboard_data(uuid, timestamptz) to authenticated;
