-- =============================================================================
-- Odys · Creator Studio: post dei coordinatori, media, like e salvataggi.
--
-- Requisiti: C-19…C-29 (post foto/video/caroselli, stati DRAFT/SCHEDULED/PUBLISHED,
-- bozze private, programmazione, bacheca e dettaglio, itinerario collegato),
-- U-05, U-19, U-20, U-21 (feed pubblico, like e salvataggi, post → itinerario),
-- M-01…M-07 (media multipli, versioni original/display/thumbnail, metadati,
-- stati e pulizia, diritti, accesso ai file, limiti), S-02 (bozze e programmati
-- visibili solo al proprietario), §11.1 (stati di un post).
--
-- La pubblicazione programmata non richiede processi esterni: un post SCHEDULED
-- diventa visibile quando `scheduled_for` è passato (come i viaggi pubblicati).
-- =============================================================================

create type public.creator_post_status as enum ('draft', 'scheduled', 'published', 'archived');
create type public.creator_media_kind as enum ('image', 'video');
create type public.creator_media_status as enum ('uploading', 'ready', 'failed');
create type public.creator_link_access as enum ('free', 'paid');

-- ---------------------------------------------------------------------------
-- Post
-- ---------------------------------------------------------------------------
create table public.creator_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  status public.creator_post_status not null default 'draft',
  caption text not null default '' check (char_length(caption) <= 2200),
  location_label text check (char_length(location_label) <= 160),
  location_latitude double precision check (location_latitude between -90 and 90),
  location_longitude double precision check (location_longitude between -180 and 180),
  location_osm_id text check (location_osm_id ~ '^(node|way|relation)/[0-9]+$'),
  -- Itinerario collegato (C-27, U-21): un viaggio pubblicato dall'autore.
  published_trip_id uuid references public.published_trips (id) on delete set null,
  link_access public.creator_link_access not null default 'free',
  -- Dichiarazione di diritti e consensi sui contenuti (M-05).
  rights_confirmed_at timestamptz,
  scheduled_for timestamptz,
  published_at timestamptz,
  -- Eliminazione morbida (§11.1 DELETED): esce da ogni vista, resta per la retention.
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index creator_posts_author_idx on public.creator_posts (author_id, updated_at desc);
create index creator_posts_feed_idx on public.creator_posts (status, published_at desc) where deleted_at is null;
create index creator_posts_trip_idx on public.creator_posts (published_trip_id) where published_trip_id is not null;

comment on table public.creator_posts is 'Post del Creator Studio (§11.1): bozze e programmati visibili solo all''autore.';

create trigger creator_posts_touch
  before update on public.creator_posts
  for each row execute function public.touch_updated_at();

-- Visibile al pubblico: pubblicato, oppure programmato e giunto all'ora (C-22).
create or replace function public.creator_post_is_public(p_status public.creator_post_status, p_scheduled_for timestamptz, p_deleted_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_deleted_at is null
     and (p_status = 'published' or (p_status = 'scheduled' and p_scheduled_for is not null and p_scheduled_for <= now()));
$$;

-- ---------------------------------------------------------------------------
-- Media (M-01…M-04): una riga per foto o video, in ordine.
-- ---------------------------------------------------------------------------
create table public.creator_post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.creator_posts (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind public.creator_media_kind not null,
  mime_type text not null check (mime_type ~ '^(image/(jpeg|png|webp|heic|heif)|video/(mp4|quicktime|webm))$'),
  width integer check (width between 1 and 10000),
  height integer check (height between 1 and 10000),
  duration_ms integer check (duration_ms between 0 and 90000),
  size_bytes bigint check (size_bytes between 1 and 104857600),
  sort_order integer not null default 0 check (sort_order between 0 and 9),
  -- Percorsi nel bucket `creator-media`: <autore>/<post>/<file>.
  original_key text not null,
  display_key text,
  thumbnail_key text,
  status public.creator_media_status not null default 'uploading',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index creator_post_media_post_idx on public.creator_post_media (post_id, sort_order);
create index creator_post_media_author_idx on public.creator_post_media (author_id);

create trigger creator_post_media_touch
  before update on public.creator_post_media
  for each row execute function public.touch_updated_at();

-- I file devono stare nella cartella dell'autore e del post (M-06).
create or replace function public.creator_post_media_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prefix text := new.author_id::text || '/' || new.post_id::text || '/';
begin
  if not exists (select 1 from public.creator_posts where id = new.post_id and author_id = new.author_id) then
    raise exception 'Operazione non consentita.' using errcode = '42501';
  end if;
  if left(new.original_key, length(v_prefix)) <> v_prefix
     or (new.display_key is not null and left(new.display_key, length(v_prefix)) <> v_prefix)
     or (new.thumbnail_key is not null and left(new.thumbnail_key, length(v_prefix)) <> v_prefix) then
    raise exception 'Percorso del file non valido.' using errcode = '23514';
  end if;
  if new.kind = 'video' and new.duration_ms is not null and new.duration_ms > 60000 then
    raise exception 'I video possono durare al massimo 60 secondi.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger creator_post_media_guard
  before insert or update on public.creator_post_media
  for each row execute function public.creator_post_media_guard();

-- Regole del post: solo coordinatori; validazioni prima di programmare o pubblicare (C-20…C-23).
create or replace function public.creator_posts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ready integer;
  v_pending integer;
begin
  if tg_op = 'UPDATE' and (new.author_id is distinct from old.author_id) then
    raise exception 'Operazione non consentita.' using errcode = '42501';
  end if;
  if new.published_trip_id is not null and not exists (
    select 1 from public.published_trips where id = new.published_trip_id and coordinator_id = new.author_id
  ) then
    raise exception 'Puoi collegare solo uno dei tuoi viaggi pubblicati.' using errcode = '23514';
  end if;
  if (new.location_latitude is null) <> (new.location_longitude is null) then
    raise exception 'Posizione incompleta.' using errcode = '23514';
  end if;

  if new.status in ('scheduled', 'published') and (tg_op = 'INSERT' or old.status is distinct from new.status or old.scheduled_for is distinct from new.scheduled_for) then
    select count(*) filter (where status = 'ready'), count(*) filter (where status <> 'ready')
      into v_ready, v_pending
      from public.creator_post_media where post_id = new.id;
    if v_pending > 0 then
      raise exception 'Attendi il caricamento di tutti i media prima di pubblicare.' using errcode = '23514';
    end if;
    if v_ready = 0 then
      raise exception 'Aggiungi almeno una foto o un video prima di pubblicare.' using errcode = '23514';
    end if;
    if new.rights_confirmed_at is null then
      raise exception 'Conferma di avere i diritti e i consensi per i contenuti pubblicati.' using errcode = '23514';
    end if;
    if new.status = 'scheduled' and (new.scheduled_for is null or new.scheduled_for <= now()) then
      raise exception 'Scegli una data e un’ora di pubblicazione future.' using errcode = '23514';
    end if;
  end if;

  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at := now();
    new.scheduled_for := null;
  elsif new.status = 'scheduled' then
    -- Pubblicato all'ora indicata: la data di pubblicazione coincide con la programmazione.
    new.published_at := new.scheduled_for;
  elsif new.status = 'draft' then
    new.published_at := null;
    new.scheduled_for := null;
  end if;
  return new;
end;
$$;

create trigger creator_posts_guard
  before insert or update on public.creator_posts
  for each row execute function public.creator_posts_guard();

-- ---------------------------------------------------------------------------
-- Like e salvataggi (U-20): solo utenti autenticati, solo su post pubblici.
-- I commenti restano fuori finché non c'è una moderazione adeguata.
-- ---------------------------------------------------------------------------
create table public.creator_post_likes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  post_id uuid not null references public.creator_posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index creator_post_likes_post_idx on public.creator_post_likes (post_id);

create table public.creator_post_saves (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  post_id uuid not null references public.creator_posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index creator_post_saves_post_idx on public.creator_post_saves (post_id);

-- Un post è visibile a chi lo legge (pubblico, oppure dell'autore).
create or replace function public.creator_post_visible(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.creator_posts p
    where p.id = p_post_id
      and (public.creator_post_is_public(p.status, p.scheduled_for, p.deleted_at)
           or (p.author_id = (select auth.uid()) and p.deleted_at is null))
  );
$$;

-- Numero di like visibile a tutti (senza esporre chi ha messo like).
create or replace function public.creator_post_like_counts(p_post_ids uuid[])
returns table (post_id uuid, likes integer)
language sql
stable
security definer
set search_path = ''
as $$
  select l.post_id, count(*)::integer
  from public.creator_post_likes l
  join public.creator_posts p on p.id = l.post_id
  where l.post_id = any (p_post_ids)
    and public.creator_post_is_public(p.status, p.scheduled_for, p.deleted_at)
  group by l.post_id;
$$;

-- =============================================================================
-- Regole di accesso (S-01, S-02)
-- =============================================================================
alter table public.creator_posts enable row level security;
alter table public.creator_post_media enable row level security;
alter table public.creator_post_likes enable row level security;
alter table public.creator_post_saves enable row level security;

create policy creator_posts_public_select on public.creator_posts for select to anon, authenticated
  using (public.creator_post_is_public(status, scheduled_for, deleted_at));
create policy creator_posts_owner_select on public.creator_posts for select to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));
create policy creator_posts_insert on public.creator_posts for insert to authenticated
  with check (author_id = (select auth.uid()) and (select public.is_coordinator()));
create policy creator_posts_update on public.creator_posts for update to authenticated
  using ((author_id = (select auth.uid()) and (select public.is_coordinator())) or (select public.is_admin()))
  with check ((author_id = (select auth.uid()) and (select public.is_coordinator())) or (select public.is_admin()));

create policy creator_post_media_select on public.creator_post_media for select to anon, authenticated
  using (public.creator_post_visible(post_id));
create policy creator_post_media_insert on public.creator_post_media for insert to authenticated
  with check (author_id = (select auth.uid()) and (select public.is_coordinator()));
create policy creator_post_media_update on public.creator_post_media for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy creator_post_media_delete on public.creator_post_media for delete to authenticated
  using (author_id = (select auth.uid()));

create policy creator_post_likes_own on public.creator_post_likes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.creator_post_visible(post_id));
create policy creator_post_saves_own on public.creator_post_saves for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.creator_post_visible(post_id));

grant select on public.creator_posts to anon, authenticated;
grant insert, update on public.creator_posts to authenticated;
grant select on public.creator_post_media to anon, authenticated;
grant insert, update, delete on public.creator_post_media to authenticated;
grant select, insert, delete on public.creator_post_likes to authenticated;
grant select, insert, delete on public.creator_post_saves to authenticated;
grant execute on function public.creator_post_is_public(public.creator_post_status, timestamptz, timestamptz) to anon, authenticated;
revoke execute on function public.creator_post_visible(uuid) from public;
grant execute on function public.creator_post_visible(uuid) to anon, authenticated;
revoke execute on function public.creator_post_like_counts(uuid[]) from public;
grant execute on function public.creator_post_like_counts(uuid[]) to anon, authenticated;
revoke execute on function public.creator_posts_guard() from anon, authenticated, public;

-- =============================================================================
-- Archivio dei file (M-02, M-06, M-07): bucket privato `creator-media`.
-- Scrittura solo nella propria cartella; lettura dei file dei post visibili.
-- Il browser riceve URL firmati a scadenza, mai l'indirizzo diretto del bucket.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creator-media', 'creator-media', false, 104857600,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy creator_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'creator-media' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.is_coordinator()));
create policy creator_media_update on storage.objects for update to authenticated
  using (bucket_id = 'creator-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy creator_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'creator-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy creator_media_select on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'creator-media' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1 from public.creator_post_media m
        where m.post_id::text = (storage.foldername(name))[2]
          and name in (m.original_key, m.display_key, m.thumbnail_key)
          and public.creator_post_visible(m.post_id)
      )
    )
  );
