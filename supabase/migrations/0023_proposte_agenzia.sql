-- =============================================================================
-- Odys · proposte di viaggio da approvare (AG-05, AG-11).
--
-- Un viaggio del coordinatore coperto dall'agenzia (ombrello) si pubblica solo
-- con l'approvazione dell'agenzia. Il coordinatore lo invia («proposta»);
-- proprietario e amministratori lo approvano (e così lo pubblicano) o lo
-- rifiutano con una nota. Margine, punto di pareggio e valutazione li calcola
-- l'API dai costi del viaggio (published_trip_pricing) e dal profilo pubblico.
-- =============================================================================

alter table public.published_trips
  add column approval_status text check (approval_status in ('pending', 'approved', 'rejected')),
  add column approval_note text check (char_length(approval_note) <= 600),
  add column approval_requested_at timestamptz,
  add column approval_decided_at timestamptz;

grant select (approval_status, approval_note, approval_requested_at, approval_decided_at) on public.published_trips to authenticated;

-- Lo stato di approvazione lo cambiano solo le funzioni qui sotto.
create or replace function public.published_trips_approval_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and coalesce(current_setting('odys.agency_change', true), '') <> '1'
     and (new.approval_status is distinct from old.approval_status or new.approval_note is distinct from old.approval_note
          or new.approval_requested_at is distinct from old.approval_requested_at or new.approval_decided_at is distinct from old.approval_decided_at) then
    raise exception 'L’approvazione si chiede e si decide dall’apposita azione.' using errcode = '42501';
  end if;
  -- Se il coordinatore cambia i dati essenziali di una proposta in attesa, la proposta si ritira: va riproposta.
  if auth.uid() is not null and coalesce(current_setting('odys.agency_change', true), '') <> '1' and old.approval_status = 'pending'
     and (new.title, new.summary, new.price_cents, new.capacity, new.start_date, new.end_date) is distinct from
         (old.title, old.summary, old.price_cents, old.capacity, old.start_date, old.end_date) then
    new.approval_status := null;
    new.approval_requested_at := null;
  end if;
  return new;
end;
$$;

create trigger published_trips_approval_guard
  before update on public.published_trips
  for each row execute function public.published_trips_approval_guard();

-- Il coordinatore propone all'agenzia un suo viaggio coperto, in bozza.
create or replace function public.request_agency_approval(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.published_trips;
begin
  select * into v_trip from public.published_trips where id = p_trip_id for update;
  if not found or v_trip.coordinator_id is distinct from auth.uid() then
    raise exception 'Viaggio non trovato.' using errcode = 'P0002';
  end if;
  if v_trip.organizer <> 'agency' or v_trip.agency_owned then
    raise exception 'Solo i viaggi coperti dall’agenzia si propongono per l’approvazione.' using errcode = '23514';
  end if;
  if v_trip.status <> 'draft' then
    raise exception 'Si propone un viaggio in bozza.' using errcode = '23514';
  end if;
  if v_trip.approval_status = 'pending' then
    raise exception 'La proposta è già all’agenzia.' using errcode = '23505';
  end if;
  perform set_config('odys.agency_change', '1', true);
  update public.published_trips
    set approval_status = 'pending', approval_note = null, approval_requested_at = now(), approval_decided_at = null
    where id = p_trip_id;
  perform set_config('odys.agency_change', '', true);
  insert into public.audit_log (action, entity, entity_id, metadata)
    values ('agency.proposal_submit', 'published_trip', p_trip_id::text, jsonb_build_object('agency', v_trip.agency_id));
end;
$$;

-- Proprietario e amministratori decidono. Approvare pubblica il viaggio (con le validazioni di sempre).
create or replace function public.decide_agency_proposal(p_trip_id uuid, p_approve boolean, p_note text default null)
returns public.published_trip_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.published_trips;
begin
  select * into v_trip from public.published_trips where id = p_trip_id for update;
  if not found or v_trip.agency_owned or not public.agency_staff(v_trip.agency_id, array['owner', 'admin']) then
    raise exception 'Proposta non trovata.' using errcode = 'P0002';
  end if;
  if v_trip.approval_status is distinct from 'pending' then
    raise exception 'Questa proposta è già stata decisa o ritirata.' using errcode = '23514';
  end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Scrivi al coordinatore perché la proposta non va (almeno 5 caratteri).' using errcode = '23514';
  end if;
  perform set_config('odys.agency_change', '1', true);
  update public.published_trips
    set approval_status = case when p_approve then 'approved' else 'rejected' end,
        approval_note = nullif(btrim(coalesce(p_note, '')), ''), approval_decided_at = now()
    where id = p_trip_id;
  perform set_config('odys.agency_change', '', true);
  if p_approve then
    -- La pubblicazione la fa chi approva: il trigger dell'agenzia verifica che sia proprietario o amministratore.
    update public.published_trips set status = 'published' where id = p_trip_id;
  end if;
  insert into public.audit_log (action, entity, entity_id, metadata)
    values (case when p_approve then 'agency.proposal_approve' else 'agency.proposal_reject' end, 'published_trip', p_trip_id::text,
            jsonb_build_object('agency', v_trip.agency_id, 'coordinator', v_trip.coordinator_id));
  return case when p_approve then 'published'::public.published_trip_status else v_trip.status end;
end;
$$;

revoke all on function public.published_trips_approval_guard() from public, anon, authenticated;
revoke all on function public.request_agency_approval(uuid) from public, anon;
revoke all on function public.decide_agency_proposal(uuid, boolean, text) from public, anon;
grant execute on function public.request_agency_approval(uuid) to authenticated;
grant execute on function public.decide_agency_proposal(uuid, boolean, text) to authenticated;
