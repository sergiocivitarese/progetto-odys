-- =============================================================================
-- Odys · moderazione e amministrazione degli account.
--
-- Requisiti: S-07, G-04 (segnalazioni degli utenti, code di revisione, decisioni
-- tracciate), G-03 (intervento su viaggi e contenuti segnalati: rimozione o
-- archiviazione), G-02 (ruoli e stato degli account con audit), S-06, G-06.
-- =============================================================================

create type public.report_target as enum ('post', 'published_trip', 'profile');
create type public.report_reason as enum ('spam', 'inappropriate', 'misleading', 'copyright', 'safety', 'other');
create type public.report_status as enum ('open', 'resolved', 'dismissed');

create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  target_kind public.report_target not null,
  target_id uuid not null,
  reason public.report_reason not null,
  details text check (char_length(details) <= 1000),
  status public.report_status not null default 'open',
  -- Esito: cosa è stato fatto sul contenuto e nota per il registro.
  action_taken text check (action_taken in ('none', 'hidden', 'suspended')),
  resolution_note text check (char_length(resolution_note) <= 1000),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- Una sola segnalazione aperta per utente e contenuto.
create unique index content_reports_open_idx on public.content_reports (reporter_id, target_kind, target_id) where status = 'open';
create index content_reports_queue_idx on public.content_reports (status, created_at);
create index content_reports_target_idx on public.content_reports (target_kind, target_id);

comment on table public.content_reports is 'Segnalazioni degli utenti su post, viaggi pubblicati e profili, con esito della revisione.';

-- Il contenuto segnalato deve esistere ed essere visibile a chi segnala.
create or replace function public.content_reports_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  new.reporter_id := auth.uid();
  new.status := 'open';
  new.action_taken := null;
  new.resolution_note := null;
  new.decided_by := null;
  new.decided_at := null;
  if not (
    (new.target_kind = 'post' and public.creator_post_visible(new.target_id))
    or (new.target_kind = 'published_trip' and exists (
      select 1 from public.published_trips t where t.id = new.target_id and public.published_trip_is_public(t.status, t.scheduled_for)))
    or (new.target_kind = 'profile' and exists (select 1 from public.coordinator_profiles c where c.id = new.target_id))
  ) then
    raise exception 'Contenuto non trovato.' using errcode = 'P0002';
  end if;
  if new.target_kind = 'profile' and new.target_id = auth.uid() then
    raise exception 'Non puoi segnalare il tuo profilo.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger content_reports_guard
  before insert on public.content_reports
  for each row execute function public.content_reports_guard();

-- Coda di revisione per l'amministratore, con un riepilogo del contenuto segnalato.
create or replace function public.admin_content_reports(p_status public.report_status default null)
returns table (
  id uuid, target_kind public.report_target, target_id uuid, reason public.report_reason, details text,
  status public.report_status, action_taken text, resolution_note text, decided_at timestamptz, created_at timestamptz,
  reporter_email text, target_title text, target_owner_id uuid, target_owner_name text, reports_on_target integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un amministratore può vedere le segnalazioni.' using errcode = '42501';
  end if;
  return query
    select r.id, r.target_kind, r.target_id, r.reason, r.details, r.status, r.action_taken, r.resolution_note, r.decided_at, r.created_at,
           u.email::text,
           case r.target_kind
             when 'post' then (select left(nullif(p.caption, ''), 120) from public.creator_posts p where p.id = r.target_id)
             when 'published_trip' then (select t.title from public.published_trips t where t.id = r.target_id)
             else (select trim(pr.first_name || ' ' || pr.last_name) from public.profiles pr where pr.id = r.target_id)
           end,
           o.owner_id,
           (select trim(pr.first_name || ' ' || pr.last_name) from public.profiles pr where pr.id = o.owner_id),
           (select count(*)::integer from public.content_reports x where x.target_kind = r.target_kind and x.target_id = r.target_id)
    from public.content_reports r
    join auth.users u on u.id = r.reporter_id
    cross join lateral (
      select case r.target_kind
        when 'post' then (select p.author_id from public.creator_posts p where p.id = r.target_id)
        when 'published_trip' then (select t.coordinator_id from public.published_trips t where t.id = r.target_id)
        else r.target_id
      end as owner_id
    ) o
    where p_status is null or r.status = p_status
    order by (r.status = 'open') desc, r.created_at;
end;
$$;

-- Decisione sulla segnalazione (G-03): archivia, nascondi il contenuto o sospendi l'account.
-- Chiude tutte le segnalazioni aperte sullo stesso contenuto e registra la decisione.
create or replace function public.admin_resolve_report(p_report_id uuid, p_action text, p_note text default null)
returns public.content_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.content_reports;
  v_owner uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un amministratore può valutare le segnalazioni.' using errcode = '42501';
  end if;
  if p_action not in ('dismiss', 'none', 'hidden', 'suspended') then
    raise exception 'Azione non valida.' using errcode = '22023';
  end if;
  select * into v_report from public.content_reports where id = p_report_id for update;
  if not found then
    raise exception 'Segnalazione non trovata.' using errcode = 'P0002';
  end if;
  if v_report.status <> 'open' then
    raise exception 'Questa segnalazione è già stata valutata.' using errcode = '23514';
  end if;

  if p_action = 'hidden' then
    if v_report.target_kind = 'post' then
      update public.creator_posts set status = 'archived', scheduled_for = null where id = v_report.target_id;
    elsif v_report.target_kind = 'published_trip' then
      update public.published_trips set status = 'archived', scheduled_for = null where id = v_report.target_id;
    else
      raise exception 'Per un profilo usa la sospensione dell’account.' using errcode = '23514';
    end if;
  elsif p_action = 'suspended' then
    v_owner := case v_report.target_kind
      when 'post' then (select author_id from public.creator_posts where id = v_report.target_id)
      when 'published_trip' then (select coordinator_id from public.published_trips where id = v_report.target_id)
      else v_report.target_id
    end;
    if v_owner = auth.uid() then
      raise exception 'Non puoi sospendere il tuo account.' using errcode = '23514';
    end if;
    update public.profiles set status = 'suspended' where id = v_owner;
  end if;

  update public.content_reports
    set status = case when p_action = 'dismiss' then 'dismissed' else 'resolved' end::public.report_status,
        action_taken = case when p_action = 'dismiss' then 'none' else p_action end,
        resolution_note = nullif(btrim(coalesce(p_note, '')), ''),
        decided_by = auth.uid(),
        decided_at = now()
    where target_kind = v_report.target_kind and target_id = v_report.target_id and status = 'open';

  insert into public.audit_log (actor_id, action, entity, entity_id, metadata)
    values (auth.uid(), 'report.' || p_action, v_report.target_kind::text, v_report.target_id::text,
            jsonb_build_object('report_id', v_report.id, 'reason', v_report.reason, 'note', nullif(btrim(coalesce(p_note, '')), '')));

  select * into v_report from public.content_reports where id = p_report_id;
  return v_report;
end;
$$;

-- ---------------------------------------------------------------------------
-- Gestione degli account (G-02): ricerca, ruolo e stato, con traccia nel registro.
-- ---------------------------------------------------------------------------
create or replace function public.admin_accounts(p_query text default null)
returns table (id uuid, email text, first_name text, last_name text, role public.user_role, status public.account_status, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Solo un amministratore può vedere gli account.' using errcode = '42501';
  end if;
  return query
    select p.id, u.email::text, p.first_name, p.last_name, p.role, p.status, p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where v_query is null
       or u.email ilike '%' || v_query || '%'
       or (p.first_name || ' ' || p.last_name) ilike '%' || v_query || '%'
    order by p.created_at desc
    limit 100;
end;
$$;

create or replace function public.admin_update_account(p_user_id uuid, p_role public.user_role default null, p_status public.account_status default null, p_note text default null)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.profiles;
  v_after public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Solo un amministratore può modificare ruolo o stato dell''account.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Non puoi modificare ruolo o stato del tuo account.' using errcode = '23514';
  end if;
  select * into v_before from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'Account non trovato.' using errcode = 'P0002';
  end if;
  update public.profiles
    set role = coalesce(p_role, role), status = coalesce(p_status, status)
    where id = p_user_id
    returning * into v_after;
  insert into public.audit_log (actor_id, action, entity, entity_id, metadata)
    values (auth.uid(), 'account.update', 'profile', p_user_id::text, jsonb_build_object(
      'role', jsonb_build_object('from', v_before.role, 'to', v_after.role),
      'status', jsonb_build_object('from', v_before.status, 'to', v_after.status),
      'note', nullif(btrim(coalesce(p_note, '')), '')));
  return v_after;
end;
$$;

-- =============================================================================
-- Regole di accesso
-- =============================================================================
alter table public.content_reports enable row level security;

create policy content_reports_insert on public.content_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));
create policy content_reports_select on public.content_reports for select to authenticated
  using (reporter_id = (select auth.uid()));

grant insert (target_kind, target_id, reason, details) on public.content_reports to authenticated;
-- Chi segnala vede l'esito, non la nota interna né chi ha deciso.
grant select (id, target_kind, target_id, reason, details, status, action_taken, decided_at, created_at) on public.content_reports to authenticated;

revoke execute on function public.content_reports_guard() from anon, authenticated, public;
revoke execute on function public.admin_content_reports(public.report_status) from anon, public;
revoke execute on function public.admin_resolve_report(uuid, text, text) from anon, public;
revoke execute on function public.admin_accounts(text) from anon, public;
revoke execute on function public.admin_update_account(uuid, public.user_role, public.account_status, text) from anon, public;
grant execute on function public.admin_content_reports(public.report_status) to authenticated;
grant execute on function public.admin_resolve_report(uuid, text, text) to authenticated;
grant execute on function public.admin_accounts(text) to authenticated;
grant execute on function public.admin_update_account(uuid, public.user_role, public.account_status, text) to authenticated;
