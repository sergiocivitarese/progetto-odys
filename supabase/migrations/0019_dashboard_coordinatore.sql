-- =============================================================================
-- Odys · dashboard del Coordinatore Premium (CP-01…CP-06).
--
-- Ogni numero viene da eventi registrati dal server, mai dal client:
--  * `booking_confirmed`: il coordinatore conferma una richiesta (la data
--    della conferma non si perde quando il viaggiatore paga il saldo);
--  * `creator_post_views`: visualizzazioni del dettaglio di un post;
--  * `coordinator_analytics()`: aggregati per il coordinatore che ha il
--    diritto `analytics.coordinator`, senza dati personali dei viaggiatori.
-- «Sollecita» (CP-03) segna sulla richiesta la data dell'ultimo promemoria del
-- saldo: il viaggiatore lo vede in Prossimo viaggio.
-- =============================================================================

alter type public.trip_event_kind add value if not exists 'booking_confirmed';

-- Conferma del coordinatore → evento.
create or replace function public.participation_confirmed_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    insert into public.trip_events (published_trip_id, kind, user_id) values (new.published_trip_id, 'booking_confirmed', new.user_id);
  end if;
  return new;
end;
$$;

create trigger participation_confirmed_event
  after update of status on public.participation_requests
  for each row execute function public.participation_confirmed_event();

-- -----------------------------------------------------------------------------
-- Visualizzazioni dei post (CP-06): una al giorno per utente collegato; l'autore non conta.
-- -----------------------------------------------------------------------------
create table public.creator_post_views (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.creator_posts (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index creator_post_views_post_idx on public.creator_post_views (post_id, created_at desc);
create index creator_post_views_user_idx on public.creator_post_views (user_id, created_at desc) where user_id is not null;
comment on table public.creator_post_views is 'Visualizzazioni del dettaglio dei post (CP-06): scritte solo da record_post_view().';

alter table public.creator_post_views enable row level security; -- nessuna policy: solo funzioni del server
revoke all on public.creator_post_views from anon, authenticated;

create or replace function public.record_post_view(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.creator_posts
  where id = p_post_id and deleted_at is null and status = 'published';
  if not found or v_author = auth.uid() then
    return;
  end if;
  if auth.uid() is not null and exists (
    select 1 from public.creator_post_views v
    where v.post_id = p_post_id and v.user_id = auth.uid() and v.created_at >= date_trunc('day', now())
  ) then
    return;
  end if;
  insert into public.creator_post_views (post_id, user_id) values (p_post_id, auth.uid());
end;
$$;

-- -----------------------------------------------------------------------------
-- Sollecito del saldo (CP-03).
-- -----------------------------------------------------------------------------
alter table public.participation_requests add column balance_reminded_at timestamptz;

create or replace function public.remind_balance(p_request_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.participation_requests;
  v_coordinator uuid;
begin
  select r.* into v_request from public.participation_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'Richiesta non trovata.' using errcode = 'P0002';
  end if;
  select coordinator_id into v_coordinator from public.published_trips where id = v_request.published_trip_id;
  if v_coordinator is distinct from auth.uid() then
    raise exception 'Richiesta non trovata.' using errcode = 'P0002';
  end if;
  if v_request.status <> 'confirmed' then
    raise exception 'Si sollecita solo chi è confermato e non ha ancora pagato il saldo.' using errcode = '23514';
  end if;
  if v_request.balance_reminded_at is not null and v_request.balance_reminded_at > now() - interval '24 hours' then
    raise exception 'Hai già inviato un sollecito nelle ultime 24 ore.' using errcode = '23514';
  end if;
  update public.participation_requests set balance_reminded_at = now() where id = p_request_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, metadata)
    values (auth.uid(), 'participation.remind_balance', 'participation_request', p_request_id::text, jsonb_build_object('trip', v_request.published_trip_id));
  return now();
end;
$$;

-- Il coordinatore vede quando ha sollecitato ciascun partecipante.
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
    where t.id = p_published_trip_id and (t.coordinator_id = auth.uid() or public.is_admin())
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

revoke execute on function public.trip_participants(uuid) from anon, public;
grant execute on function public.trip_participants(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Dati della dashboard: eventi e pagamenti dei propri viaggi, statistiche dei propri post.
-- Attribuzione provvisoria (punto aperto del cliente): una prenotazione confermata va al
-- post dell'autore, collegato a quel viaggio, visto per ultimo da chi prenota nei 30 giorni prima.
-- -----------------------------------------------------------------------------
create or replace function public.coordinator_analytics(p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_entitlement('analytics.coordinator') then
    raise exception 'Questa funzione è inclusa in un piano superiore.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('tripId', e.published_trip_id, 'kind', e.kind, 'at', e.created_at) order by e.created_at, e.id)
      from public.trip_events e join public.published_trips t on t.id = e.published_trip_id
      where t.coordinator_id = v_uid and e.created_at >= p_since
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('tripId', r.published_trip_id, 'kind', p.kind, 'amountCents', p.amount_cents, 'currency', p.currency, 'at', p.confirmed_at) order by p.confirmed_at)
      from public.payments p
      join public.participation_requests r on r.id = p.request_id
      join public.published_trips t on t.id = r.published_trip_id
      where t.coordinator_id = v_uid and p.status = 'confirmed' and p.confirmed_at >= p_since
    ), '[]'::jsonb),
    'posts', coalesce((
      with mine as (
        select p.id, p.caption, p.published_trip_id, p.published_at from public.creator_posts p
        where p.author_id = v_uid and p.deleted_at is null and p.status = 'published'
      ),
      bookings as (
        select e.published_trip_id, e.user_id, e.created_at from public.trip_events e
        join public.published_trips t on t.id = e.published_trip_id
        where t.coordinator_id = v_uid and e.kind = 'booking_confirmed' and e.created_at >= p_since and e.user_id is not null
      ),
      touches as (
        select distinct on (b.published_trip_id, b.user_id, b.created_at) m.id as post_id
        from bookings b
        join mine m on m.published_trip_id = b.published_trip_id
        join public.creator_post_views v on v.post_id = m.id and v.user_id = b.user_id
          and v.created_at between b.created_at - interval '30 days' and b.created_at
        order by b.published_trip_id, b.user_id, b.created_at, v.created_at desc
      )
      select jsonb_agg(jsonb_build_object(
        'postId', m.id,
        'caption', left(m.caption, 120),
        'tripId', m.published_trip_id,
        'publishedAt', m.published_at,
        'views', (select count(*) from public.creator_post_views v where v.post_id = m.id and v.created_at >= p_since),
        'saves', (select count(*) from public.creator_post_saves s where s.post_id = m.id and s.created_at >= p_since),
        'bookings', (select count(*) from touches x where x.post_id = m.id)
      ) order by m.published_at desc nulls last)
      from mine m
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.record_post_view(uuid) from public;
grant execute on function public.record_post_view(uuid) to anon, authenticated;
revoke all on function public.remind_balance(uuid) from public, anon;
grant execute on function public.remind_balance(uuid) to authenticated;
revoke all on function public.coordinator_analytics(timestamptz) from public, anon;
grant execute on function public.coordinator_analytics(timestamptz) to authenticated;
revoke all on function public.participation_confirmed_event() from public, anon, authenticated;
