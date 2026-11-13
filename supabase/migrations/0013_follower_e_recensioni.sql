-- =============================================================================
-- Odys · recensioni a fine viaggio e numeri del profilo coordinatore.
--
-- Requisiti: TB-11 (profilo coordinatore: viaggi fatti, recensioni, follower,
-- pulsante Segui — la tabella dei follower è in 0010), TB-12 (a viaggio
-- concluso il traveller valuta coordinatore e viaggio; la recensione compare
-- sul profilo del coordinatore), CB-09 (valutazione media e numero di recensioni).
-- =============================================================================

create table public.trip_reviews (
  id uuid primary key default gen_random_uuid(),
  published_trip_id uuid not null references public.published_trips (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  coordinator_rating integer not null check (coordinator_rating between 1 and 5),
  trip_rating integer not null check (trip_rating between 1 and 5),
  body text not null default '' check (char_length(body) <= 800),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (published_trip_id, author_id)
);

create index trip_reviews_trip_idx on public.trip_reviews (published_trip_id, created_at desc);

comment on table public.trip_reviews is 'Recensioni dei partecipanti a viaggio concluso (TB-12).';

create trigger trip_reviews_touch
  before update on public.trip_reviews
  for each row execute function public.touch_updated_at();

-- Recensisce solo chi ha partecipato (posto confermato o saldato) e solo dopo il rientro.
create or replace function public.trip_reviews_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  new.author_id := auth.uid();
  if tg_op = 'UPDATE' and new.published_trip_id is distinct from old.published_trip_id then
    raise exception 'Operazione non consentita.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.participation_requests r
    where r.published_trip_id = new.published_trip_id and r.user_id = auth.uid() and r.status in ('confirmed', 'balance_paid')
  ) then
    raise exception 'Può recensire il viaggio solo chi vi ha partecipato.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.published_trips t where t.id = new.published_trip_id and t.end_date < current_date) then
    raise exception 'Potrai lasciare la recensione al rientro dal viaggio.' using errcode = '23514';
  end if;
  new.body := btrim(new.body);
  return new;
end;
$$;

create trigger trip_reviews_guard
  before insert or update on public.trip_reviews
  for each row execute function public.trip_reviews_guard();

-- Recensioni pubbliche di un coordinatore, con nome e iniziale dell'autore.
create or replace function public.coordinator_reviews(p_coordinator_id uuid, p_limit integer default 20)
returns table (id uuid, published_trip_id uuid, trip_title text, trip_destination text, trip_end date,
               author_name text, author_initials text, coordinator_rating integer, trip_rating integer, body text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, t.id, t.title, t.destination, t.end_date,
         p.first_name || ' ' || left(p.last_name, 1) || '.', upper(left(p.first_name, 1) || left(p.last_name, 1)),
         v.coordinator_rating, v.trip_rating, v.body, v.created_at
  from public.trip_reviews v
  join public.published_trips t on t.id = v.published_trip_id
  join public.profiles p on p.id = v.author_id
  where t.coordinator_id = p_coordinator_id and p.status = 'active'
  order by v.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- Profilo pubblico con i numeri del coordinatore (TB-11, CB-09). Le colonne nuove vanno in fondo.
create or replace view public.coordinator_profiles
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
    p.created_at,
    (select round(avg(v.coordinator_rating)::numeric, 1) from public.trip_reviews v join public.published_trips t on t.id = v.published_trip_id where t.coordinator_id = p.id) as rating,
    (select count(*)::integer from public.trip_reviews v join public.published_trips t on t.id = v.published_trip_id where t.coordinator_id = p.id) as reviews_count,
    (select count(*)::integer from public.coordinator_follows f where f.coordinator_id = p.id) as followers,
    (select count(*)::integer from public.published_trips t where t.coordinator_id = p.id and t.status in ('published', 'active', 'completed') and t.end_date < current_date) as trips_completed
  from public.profiles p
  where p.role in ('coordinator', 'admin') and p.status = 'active';

-- =============================================================================
-- Regole di accesso
-- =============================================================================
alter table public.trip_reviews enable row level security;

-- Le recensioni le legge chiunque (sono pubbliche sul profilo); l'autore scrive e modifica la propria.
create policy trip_reviews_select on public.trip_reviews for select to anon, authenticated using (true);
create policy trip_reviews_insert on public.trip_reviews for insert to authenticated with check (author_id = (select auth.uid()));
create policy trip_reviews_update on public.trip_reviews for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));

grant select (id, published_trip_id, coordinator_rating, trip_rating, body, created_at) on public.trip_reviews to anon, authenticated;
grant select (author_id) on public.trip_reviews to authenticated;
grant insert (published_trip_id, coordinator_rating, trip_rating, body), update (coordinator_rating, trip_rating, body) on public.trip_reviews to authenticated;
grant select on public.coordinator_profiles to anon, authenticated;

revoke execute on function public.trip_reviews_guard() from anon, authenticated, public;
revoke execute on function public.coordinator_reviews(uuid, integer) from public;
grant execute on function public.coordinator_reviews(uuid, integer) to anon, authenticated;
