-- =============================================================================
-- Odys · richieste di partecipazione e candidature a coordinatore.
--
-- Requisiti: U-14, U-16 (richiesta di partecipazione tracciabile, stato chiaro),
-- C-15 (partecipanti e stato delle richieste), C-01, C-02 (candidatura con
-- requisiti minimi), G-01 (revisione dell'amministratore con note interne),
-- S-01, S-06 (accesso per ruolo e proprietà, decisioni tracciate).
--
-- Il pagamento (U-15, U-18) resta fuori: la richiesta non blocca denaro, il
-- posto è garantito solo dalla conferma del coordinatore.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Richieste di partecipazione
-- ---------------------------------------------------------------------------
create type public.participation_status as enum ('pending', 'confirmed', 'declined', 'withdrawn');

create table public.participation_requests (
  id uuid primary key default gen_random_uuid(),
  published_trip_id uuid not null references public.published_trips (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  status public.participation_status not null default 'pending',
  message text check (char_length(message) <= 600),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (published_trip_id, user_id)
);

create index participation_requests_user_idx on public.participation_requests (user_id, created_at desc);
create index participation_requests_trip_idx on public.participation_requests (published_trip_id, status);

comment on table public.participation_requests is 'Richieste di partecipazione ai viaggi pubblicati: una per utente e viaggio.';

create trigger participation_requests_touch
  before update on public.participation_requests
  for each row execute function public.touch_updated_at();

-- Regole della richiesta: chi può aprirla, chi può cambiarne lo stato e quando.
-- Valgono per gli utenti dell'app; dalla dashboard (nessun utente) non si applicano.
create or replace function public.participation_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.published_trips;
  v_actor uuid := auth.uid();
  v_confirmed integer;
  v_open boolean;
begin
  if v_actor is null then
    return new;
  end if;

  select * into v_trip from public.published_trips where id = new.published_trip_id for update;
  if not found or not public.published_trip_is_public(v_trip.status, v_trip.scheduled_for) then
    raise exception 'Viaggio non trovato.' using errcode = 'P0002';
  end if;
  v_open := v_trip.status in ('published', 'scheduled') and v_trip.start_date is not null and v_trip.start_date > current_date;
  select count(*) into v_confirmed from public.participation_requests
    where published_trip_id = v_trip.id and status = 'confirmed' and id is distinct from new.id;

  if tg_op = 'INSERT' then
    new.user_id := v_actor;
    new.status := 'pending';
    new.decided_at := null;
    if v_trip.coordinator_id = v_actor then
      raise exception 'Non puoi chiedere di partecipare a un viaggio che coordini.' using errcode = '23514';
    end if;
    if not v_open then
      raise exception 'Le iscrizioni a questo viaggio sono chiuse.' using errcode = '23514';
    end if;
    if v_trip.capacity is not null and v_confirmed >= v_trip.capacity then
      raise exception 'I posti di questo viaggio sono esauriti.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.published_trip_id is distinct from old.published_trip_id or new.user_id is distinct from old.user_id then
    raise exception 'Operazione non consentita.' using errcode = '42501';
  end if;
  if v_actor is distinct from old.user_id then
    new.message := old.message;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;

  if public.is_admin() then
    null;
  elsif v_actor = old.user_id then
    -- Il viaggiatore ritira la richiesta o la riapre dopo averla ritirata.
    if new.status = 'withdrawn' and old.status in ('pending', 'confirmed') then
      null;
    elsif new.status = 'pending' and old.status = 'withdrawn' then
      if not v_open then
        raise exception 'Le iscrizioni a questo viaggio sono chiuse.' using errcode = '23514';
      end if;
    else
      raise exception 'Operazione non consentita.' using errcode = '42501';
    end if;
  elsif v_actor = v_trip.coordinator_id then
    -- Il coordinatore conferma o rifiuta; può correggere una decisione già presa.
    if not (new.status in ('confirmed', 'declined') and old.status in ('pending', 'confirmed', 'declined')) then
      raise exception 'Operazione non consentita.' using errcode = '42501';
    end if;
  else
    raise exception 'Operazione non consentita.' using errcode = '42501';
  end if;

  if new.status = 'confirmed' and v_trip.capacity is not null and v_confirmed >= v_trip.capacity then
    raise exception 'I posti di questo viaggio sono esauriti.' using errcode = '23514';
  end if;
  new.decided_at := case when new.status in ('confirmed', 'declined') then now() else null end;
  return new;
end;
$$;

create trigger participation_requests_guard
  before insert or update on public.participation_requests
  for each row execute function public.participation_requests_guard();

-- Posti confermati di un viaggio visibile: serve al pubblico per i posti rimasti (U-06).
create or replace function public.published_trip_confirmed_count(p_published_trip_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.participation_requests r
  join public.published_trips t on t.id = r.published_trip_id
  where r.published_trip_id = p_published_trip_id
    and r.status = 'confirmed'
    and public.published_trip_is_public(t.status, t.scheduled_for);
$$;

-- Partecipanti di un viaggio per il suo coordinatore (C-15). Minimizzazione dei
-- dati (S-04): nome e messaggio sempre, il contatto email solo dopo la conferma.
create or replace function public.trip_participants(p_published_trip_id uuid)
returns table (
  id uuid, user_id uuid, status public.participation_status, message text,
  created_at timestamptz, decided_at timestamptz, first_name text, last_name text, email text
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
           case when r.status = 'confirmed' then u.email::text end
    from public.participation_requests r
    join public.profiles p on p.id = r.user_id
    join auth.users u on u.id = r.user_id
    where r.published_trip_id = p_published_trip_id
    order by r.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Candidature a coordinatore (C-01, C-02, G-01)
-- ---------------------------------------------------------------------------
create type public.application_status as enum ('pending', 'approved', 'rejected');

create table public.coordinator_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  status public.application_status not null default 'pending',
  motivation text not null check (char_length(btrim(motivation)) between 40 and 1200),
  experience text not null check (char_length(btrim(experience)) between 20 and 1200),
  trips_led integer not null default 0 check (trips_led between 0 and 500),
  languages text[] not null default '{}',
  links text[] not null default '{}',
  guidelines_version text not null,
  -- Messaggio per il candidato (facoltativo) e nota interna, mai visibile al candidato.
  reviewer_message text check (char_length(reviewer_message) <= 600),
  admin_note text check (char_length(admin_note) <= 1000),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Una sola candidatura in attesa per utente.
create unique index coordinator_applications_pending_idx on public.coordinator_applications (user_id) where status = 'pending';
create index coordinator_applications_status_idx on public.coordinator_applications (status, created_at);

comment on table public.coordinator_applications is 'Candidature al ruolo di coordinatore, valutate da un amministratore.';

create trigger coordinator_applications_touch
  before update on public.coordinator_applications
  for each row execute function public.touch_updated_at();

-- Requisiti minimi della candidatura (C-02): account viaggiatore attivo e profilo completo.
create or replace function public.coordinator_applications_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then
    return new;
  end if;
  new.user_id := auth.uid();
  new.status := 'pending';
  new.reviewer_message := null;
  new.admin_note := null;
  new.decided_by := null;
  new.decided_at := null;
  select * into v_profile from public.profiles where id = new.user_id;
  if v_profile.status <> 'active' then
    raise exception 'Il tuo account non è attivo.' using errcode = '23514';
  end if;
  if v_profile.role <> 'traveler' then
    raise exception 'Il tuo account ha già un ruolo professionale.' using errcode = '23514';
  end if;
  if btrim(v_profile.first_name) = '' or btrim(v_profile.last_name) = '' or char_length(btrim(coalesce(v_profile.bio, ''))) < 40 then
    raise exception 'Completa il profilo prima di candidarti: nome, cognome e una presentazione di almeno 40 caratteri.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger coordinator_applications_guard
  before insert on public.coordinator_applications
  for each row execute function public.coordinator_applications_guard();

-- Elenco delle candidature per l'amministratore (G-01), con i dati del profilo.
create or replace function public.admin_coordinator_applications(p_status public.application_status default null)
returns table (
  id uuid, user_id uuid, status public.application_status, motivation text, experience text, trips_led integer,
  languages text[], links text[], reviewer_message text, admin_note text, decided_at timestamptz, created_at timestamptz,
  first_name text, last_name text, email text, bio text, interests text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un amministratore può vedere le candidature.' using errcode = '42501';
  end if;
  return query
    select a.id, a.user_id, a.status, a.motivation, a.experience, a.trips_led, a.languages, a.links,
           a.reviewer_message, a.admin_note, a.decided_at, a.created_at,
           p.first_name, p.last_name, u.email::text, p.bio, p.interests
    from public.coordinator_applications a
    join public.profiles p on p.id = a.user_id
    join auth.users u on u.id = a.user_id
    where p_status is null or a.status = p_status
    order by (a.status = 'pending') desc, a.created_at desc;
end;
$$;

-- Decisione dell'amministratore: approva (e attiva il ruolo) o rifiuta, con traccia nel registro.
create or replace function public.admin_decide_coordinator_application(
  p_application_id uuid, p_approve boolean, p_admin_note text default null, p_reviewer_message text default null
)
returns public.coordinator_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application public.coordinator_applications;
begin
  if not public.is_admin() then
    raise exception 'Solo un amministratore può valutare le candidature.' using errcode = '42501';
  end if;
  select * into v_application from public.coordinator_applications where id = p_application_id for update;
  if not found then
    raise exception 'Candidatura non trovata.' using errcode = 'P0002';
  end if;
  if v_application.status <> 'pending' then
    raise exception 'Questa candidatura è già stata valutata.' using errcode = '23514';
  end if;
  update public.coordinator_applications
    set status = case when p_approve then 'approved' else 'rejected' end::public.application_status,
        admin_note = nullif(btrim(coalesce(p_admin_note, '')), ''),
        reviewer_message = nullif(btrim(coalesce(p_reviewer_message, '')), ''),
        decided_by = auth.uid(),
        decided_at = now()
    where id = p_application_id
    returning * into v_application;
  if p_approve then
    update public.profiles set role = 'coordinator' where id = v_application.user_id and role = 'traveler';
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, metadata)
    values (auth.uid(), case when p_approve then 'coordinator_application.approve' else 'coordinator_application.reject' end,
            'coordinator_application', v_application.id::text, jsonb_build_object('user_id', v_application.user_id));
  return v_application;
end;
$$;

-- =============================================================================
-- Regole di accesso
-- =============================================================================
alter table public.participation_requests enable row level security;
alter table public.coordinator_applications enable row level security;

-- Richieste: le vede chi le ha fatte, il coordinatore del viaggio e l'amministratore.
create policy participation_requests_select on public.participation_requests for select to authenticated
  using (
    user_id = auth.uid() or public.is_admin()
    or exists (select 1 from public.published_trips t where t.id = published_trip_id and t.coordinator_id = auth.uid())
  );
create policy participation_requests_insert on public.participation_requests for insert to authenticated
  with check (user_id = auth.uid());
create policy participation_requests_update on public.participation_requests for update to authenticated
  using (
    user_id = auth.uid() or public.is_admin()
    or exists (select 1 from public.published_trips t where t.id = published_trip_id and t.coordinator_id = auth.uid())
  );

-- Candidature: ognuno vede e invia le proprie; la valutazione passa dalle funzioni admin.
create policy coordinator_applications_select on public.coordinator_applications for select to authenticated
  using (user_id = auth.uid());
create policy coordinator_applications_insert on public.coordinator_applications for insert to authenticated
  with check (user_id = auth.uid());

grant select, insert on public.participation_requests to authenticated;
grant update (status, message) on public.participation_requests to authenticated;
-- La nota interna dell'amministratore non è tra le colonne leggibili dal candidato.
grant select (id, user_id, status, motivation, experience, trips_led, languages, links, guidelines_version, reviewer_message, decided_at, created_at, updated_at)
  on public.coordinator_applications to authenticated;
grant insert (motivation, experience, trips_led, languages, links, guidelines_version) on public.coordinator_applications to authenticated;

revoke execute on function public.published_trip_confirmed_count(uuid) from public;
revoke execute on function public.trip_participants(uuid) from anon, public;
revoke execute on function public.admin_coordinator_applications(public.application_status) from anon, public;
revoke execute on function public.admin_decide_coordinator_application(uuid, boolean, text, text) from anon, public;
revoke execute on function public.participation_requests_guard() from anon, authenticated, public;
revoke execute on function public.coordinator_applications_guard() from anon, authenticated, public;
grant execute on function public.published_trip_confirmed_count(uuid) to anon, authenticated;
grant execute on function public.trip_participants(uuid) to authenticated;
grant execute on function public.admin_coordinator_applications(public.application_status) to authenticated;
grant execute on function public.admin_decide_coordinator_application(uuid, boolean, text, text) to authenticated;
