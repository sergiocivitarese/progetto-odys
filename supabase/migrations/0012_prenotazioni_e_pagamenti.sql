-- =============================================================================
-- Odys · prenotazione con acconto e pagamenti (specifiche per ruolo).
--
-- Requisiti: TB-08 (blocca il posto), TB-09 (checkout acconto: riepilogo,
-- accettazione delle condizioni, posto riservato con timer, conferma solo lato
-- server), TB-10 (Prossimo viaggio: richiesta inviata → confermata → saldo
-- pagato), CB-08 (richieste con acconto pagato), elementi trasversali
-- («Stati di una prenotazione», «Pagamenti»).
--
-- Stati della prenotazione (tabella `participation_requests`):
--   reserved      posto riservato per 15 minuti mentre si paga l'acconto;
--   pending       richiesta inviata: acconto confermato dal fornitore;
--   confirmed     confermata dal coordinatore;
--   balance_paid  saldata: saldo confermato dal fornitore;
--   declined / withdrawn  rifiutata o annullata.
--
-- Il passaggio a `pending` e `balance_paid` avviene solo dentro
-- `confirm_payment()`: nessun client lo può scrivere direttamente.
-- =============================================================================

-- Durata della riserva del posto nel checkout (valore provvisorio).
create or replace function public.seat_reservation_minutes()
returns integer language sql immutable set search_path = '' as $$ select 15 $$;

alter table public.participation_requests
  add column reserved_until timestamptz,
  add column seat_number integer,
  -- Importi fissati quando si riserva il posto: un cambio di prezzo non tocca chi sta già pagando.
  add column price_cents integer check (price_cents >= 0),
  add column deposit_cents integer check (deposit_cents >= 0),
  add column currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  add column balance_due_date date,
  add column terms_accepted_at timestamptz;

comment on column public.participation_requests.reserved_until is 'Scadenza del posto riservato durante il checkout: oltre, il posto torna libero.';

-- Vero se la prenotazione occupa un posto: riserva non scaduta, richiesta inviata, confermata o saldata.
create or replace function public.participation_holds_seat(p_status public.participation_status, p_reserved_until timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status in ('pending', 'confirmed', 'balance_paid')
      or (p_status = 'reserved' and p_reserved_until is not null and p_reserved_until > now());
$$;

-- ---------------------------------------------------------------------------
-- Pagamenti: prezzi in centesimi con valuta esplicita; vale solo la conferma
-- del fornitore, mai la risposta del client.
-- ---------------------------------------------------------------------------
create type public.payment_kind as enum ('deposit', 'balance');
create type public.payment_status as enum ('processing', 'confirmed', 'failed');

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.participation_requests (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.payment_kind not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status public.payment_status not null default 'processing',
  -- `simulated` finché il cliente non sceglie il fornitore reale.
  provider text not null default 'simulated',
  provider_ref text,
  method text not null default 'card' check (method in ('card', 'wallet')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

-- Un solo pagamento in corso o riuscito per prenotazione e tipo.
create unique index payments_one_per_kind_idx on public.payments (request_id, kind) where status in ('processing', 'confirmed');
create index payments_user_idx on public.payments (user_id, created_at desc);

comment on table public.payments is 'Acconti e saldi delle prenotazioni. Lo stato lo cambia solo confirm_payment().';

-- ---------------------------------------------------------------------------
-- Regole della prenotazione: sostituisce il trigger di 0005.
-- Valgono per gli utenti dell'app; dalla dashboard (nessun utente) non si applicano.
-- ---------------------------------------------------------------------------
create or replace function public.participation_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.published_trips;
  v_actor uuid := auth.uid();
  v_taken integer;
  v_open boolean;
  v_from_payment boolean := coalesce(current_setting('odys.payment_confirmation', true), '') = '1';
  v_reserving boolean;
begin
  if v_actor is null and not v_from_payment then
    return new;
  end if;

  select * into v_trip from public.published_trips where id = new.published_trip_id for update;
  if not found or not public.published_trip_is_public(v_trip.status, v_trip.scheduled_for) then
    raise exception 'Viaggio non trovato.' using errcode = 'P0002';
  end if;
  -- Un viaggio si prenota solo nello stato «In vendita»: pubblicato e non ancora partito.
  v_open := v_trip.status in ('published', 'scheduled') and v_trip.start_date is not null and v_trip.start_date > current_date;
  select count(*) into v_taken from public.participation_requests r
    where r.published_trip_id = v_trip.id and r.id is distinct from new.id
      and public.participation_holds_seat(r.status, r.reserved_until);

  -- Riserva del posto: nuova prenotazione, oppure ripresa dopo una riserva scaduta o un ritiro.
  v_reserving := tg_op = 'INSERT'
    or (new.status = 'reserved' and v_actor = old.user_id
        and (old.status = 'withdrawn' or (old.status = 'reserved' and (old.reserved_until is null or old.reserved_until <= now()))));

  if v_reserving and not v_from_payment then
    if tg_op = 'INSERT' then
      new.user_id := v_actor;
      new.decided_at := null;
      if exists (select 1 from public.participation_requests r where r.published_trip_id = new.published_trip_id and r.user_id = v_actor) then
        raise exception 'Hai già una prenotazione per questo viaggio.' using errcode = '23505';
      end if;
    elsif not public.published_trip_visible_to_me(v_trip) then
      raise exception 'Viaggio non trovato.' using errcode = 'P0002';
    end if;
    if tg_op = 'INSERT' and not public.published_trip_visible_to_me(v_trip) then
      raise exception 'Viaggio non trovato.' using errcode = 'P0002';
    end if;
    if v_trip.coordinator_id = v_actor then
      raise exception 'Non puoi prenotare un viaggio che coordini.' using errcode = '23514';
    end if;
    if not public.has_entitlement('trips.book') then
      raise exception 'Il tuo profilo non può prenotare viaggi.' using errcode = '42501';
    end if;
    if not v_open then
      raise exception 'Le iscrizioni a questo viaggio sono chiuse.' using errcode = '23514';
    end if;
    if v_trip.capacity is not null and v_taken >= v_trip.capacity then
      raise exception 'I posti di questo viaggio sono esauriti.' using errcode = '23514';
    end if;
    if v_trip.price_cents is null or v_trip.deposit_cents is null then
      raise exception 'Questo viaggio non è ancora prenotabile: manca la quota.' using errcode = '23514';
    end if;
    new.status := 'reserved';
    new.reserved_until := now() + make_interval(mins => public.seat_reservation_minutes());
    new.seat_number := v_taken + 1;
    new.price_cents := v_trip.price_cents;
    new.deposit_cents := v_trip.deposit_cents;
    new.currency := v_trip.currency;
    new.balance_due_date := v_trip.balance_due_date;
    new.terms_accepted_at := null;
    new.decided_at := null;
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

  if v_from_payment then
    -- Conferma del fornitore: acconto → richiesta inviata; saldo → saldata.
    if not ((old.status = 'reserved' and new.status = 'pending') or (old.status = 'confirmed' and new.status = 'balance_paid')) then
      raise exception 'Operazione non consentita.' using errcode = '42501';
    end if;
    new.reserved_until := null;
    return new;
  elsif new.status in ('pending', 'balance_paid', 'reserved') then
    raise exception 'Lo stato della prenotazione cambia solo con la conferma del pagamento.' using errcode = '42501';
  elsif public.is_admin() then
    null;
  elsif v_actor = old.user_id then
    -- Il viaggiatore annulla la prenotazione (il rimborso segue la politica del viaggio).
    if not (new.status = 'withdrawn' and old.status in ('reserved', 'pending', 'confirmed')) then
      raise exception 'Operazione non consentita.' using errcode = '42501';
    end if;
  elsif v_actor = v_trip.coordinator_id then
    -- Il coordinatore conferma o rifiuta una richiesta con acconto pagato; può correggere una decisione già presa.
    if not (new.status in ('confirmed', 'declined') and old.status in ('pending', 'confirmed', 'declined')) then
      raise exception 'Operazione non consentita.' using errcode = '42501';
    end if;
  else
    raise exception 'Operazione non consentita.' using errcode = '42501';
  end if;

  if new.status = 'confirmed' and v_trip.capacity is not null and v_taken >= v_trip.capacity then
    raise exception 'I posti di questo viaggio sono esauriti.' using errcode = '23514';
  end if;
  new.reserved_until := null;
  new.decided_at := case when new.status in ('confirmed', 'declined') then now() else null end;
  return new;
end;
$$;

-- Posti occupati: contano anche le riserve in corso e le richieste con acconto pagato.
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
    and public.participation_holds_seat(r.status, r.reserved_until)
    and public.published_trip_is_public(t.status, t.scheduled_for)
  group by r.published_trip_id;
$$;

create or replace function public.published_trip_confirmed_count(p_published_trip_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select taken from public.published_trips_seats_taken(array[p_published_trip_id])), 0);
$$;

-- Iniziali di chi ha già un posto (richiesta inviata, confermata o saldata), per
-- gli avatar del dettaglio (TB-06). Solo iniziali: nessun nome esce da qui.
create or replace function public.published_trip_participant_initials(p_published_trip_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(upper(left(p.first_name, 1) || left(p.last_name, 1)) order by r.created_at), '{}')
  from public.participation_requests r
  join public.profiles p on p.id = r.user_id
  join public.published_trips t on t.id = r.published_trip_id
  where r.published_trip_id = p_published_trip_id
    and r.status in ('pending', 'confirmed', 'balance_paid')
    and public.published_trip_visible_to_me(t);
$$;

-- ---------------------------------------------------------------------------
-- Avvio di un pagamento: l'importo lo calcola il server dalla prenotazione.
-- ---------------------------------------------------------------------------
create or replace function public.start_payment(p_request_id uuid, p_kind public.payment_kind, p_method text default 'card', p_accept_terms boolean default false)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.participation_requests;
  v_payment public.payments;
  v_amount integer;
begin
  select * into v_request from public.participation_requests where id = p_request_id and user_id = auth.uid() for update;
  if not found then
    raise exception 'Prenotazione non trovata.' using errcode = 'P0002';
  end if;
  if p_method not in ('card', 'wallet') then
    raise exception 'Metodo di pagamento non valido.' using errcode = '22023';
  end if;

  if p_kind = 'deposit' then
    if v_request.status <> 'reserved' or v_request.reserved_until is null or v_request.reserved_until <= now() then
      raise exception 'Il tempo per bloccare il posto è scaduto: riprova dalla pagina del viaggio.' using errcode = '23514';
    end if;
    if not p_accept_terms then
      raise exception 'Per pagare l’acconto accetta le condizioni di partecipazione e la politica di cancellazione.' using errcode = '23514';
    end if;
    v_amount := v_request.deposit_cents;
    update public.participation_requests set terms_accepted_at = now() where id = v_request.id;
  else
    if v_request.status <> 'confirmed' then
      raise exception 'Il saldo si paga dopo la conferma del coordinatore.' using errcode = '23514';
    end if;
    v_amount := v_request.price_cents - v_request.deposit_cents;
  end if;
  if v_amount is null then
    raise exception 'Importo non disponibile per questa prenotazione.' using errcode = '23514';
  end if;

  -- Un pagamento già avviato si riprende, non si duplica.
  select * into v_payment from public.payments where request_id = v_request.id and kind = p_kind and status in ('processing', 'confirmed');
  if found then
    return v_payment;
  end if;
  insert into public.payments (request_id, user_id, kind, amount_cents, currency, method)
    values (v_request.id, v_request.user_id, p_kind, v_amount, v_request.currency, p_method)
    returning * into v_payment;
  return v_payment;
end;
$$;

-- Conferma del fornitore: l'unico punto in cui la prenotazione avanza per un pagamento.
-- Non è richiamabile dai client: la usa il server (webhook del fornitore reale).
create or replace function public.confirm_payment(p_payment_id uuid, p_provider_ref text default null)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_request public.participation_requests;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'Pagamento non trovato.' using errcode = 'P0002';
  end if;
  if v_payment.status = 'confirmed' then
    return v_payment; -- il fornitore può notificare due volte lo stesso pagamento
  end if;
  if v_payment.status <> 'processing' then
    raise exception 'Questo pagamento non è più in corso.' using errcode = '23514';
  end if;
  select * into v_request from public.participation_requests where id = v_payment.request_id for update;

  perform set_config('odys.payment_confirmation', '1', true);
  if v_payment.kind = 'deposit' then
    update public.participation_requests set status = 'pending' where id = v_request.id;
    insert into public.trip_events (published_trip_id, kind, user_id) values (v_request.published_trip_id, 'request', v_request.user_id);
  else
    update public.participation_requests set status = 'balance_paid' where id = v_request.id;
  end if;
  perform set_config('odys.payment_confirmation', '', true);

  update public.payments set status = 'confirmed', confirmed_at = now(), provider_ref = coalesce(p_provider_ref, provider_ref)
    where id = p_payment_id returning * into v_payment;
  insert into public.trip_events (published_trip_id, kind, user_id) values (v_request.published_trip_id, 'payment_confirmed', v_request.user_id);
  insert into public.audit_log (actor_id, action, entity, entity_id, metadata)
    values (v_request.user_id, 'payment.' || v_payment.kind, 'payment', v_payment.id::text,
            jsonb_build_object('amount_cents', v_payment.amount_cents, 'currency', v_payment.currency, 'provider', v_payment.provider, 'trip', v_request.published_trip_id));
  return v_payment;
end;
$$;

-- Fornitore simulato: chi paga conferma il proprio pagamento di prova.
-- DA RIMUOVERE con il fornitore reale: lì la conferma arriva solo dal webhook (confirm_payment).
create or replace function public.confirm_simulated_payment(p_payment_id uuid)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.payments where id = p_payment_id and user_id = auth.uid() and provider = 'simulated') then
    raise exception 'Pagamento non trovato.' using errcode = 'P0002';
  end if;
  return public.confirm_payment(p_payment_id, 'sim_' || replace(p_payment_id::text, '-', ''));
end;
$$;

-- Partecipanti per il coordinatore (CB-08): acconto pagato, saldo e contatto dopo la conferma.
drop function public.trip_participants(uuid);
create function public.trip_participants(p_published_trip_id uuid)
returns table (
  id uuid, user_id uuid, status public.participation_status, message text,
  created_at timestamptz, decided_at timestamptz, first_name text, last_name text, email text,
  seat_number integer, price_cents integer, deposit_cents integer, currency text, balance_due_date date,
  age integer, shared_interests integer
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
             where lower(i) in (select lower(x) from unnest(t.interests) x))
    from public.participation_requests r
    join public.published_trips t on t.id = r.published_trip_id
    join public.profiles p on p.id = r.user_id
    join auth.users u on u.id = r.user_id
    -- Le riserve senza acconto non sono richieste: il coordinatore non le vede.
    where r.published_trip_id = p_published_trip_id and r.status <> 'reserved'
    order by r.created_at;
end;
$$;

-- =============================================================================
-- Regole di accesso
-- =============================================================================
alter table public.payments enable row level security;

-- I pagamenti li vede chi li ha fatti, il coordinatore del viaggio e l'amministratore; nessuno li scrive direttamente.
create policy payments_select on public.payments for select to authenticated
  using (
    user_id = (select auth.uid()) or public.is_admin()
    or exists (
      select 1 from public.participation_requests r
      join public.published_trips t on t.id = r.published_trip_id
      where r.id = request_id and t.coordinator_id = (select auth.uid()))
  );

grant select on public.payments to authenticated;

revoke execute on function public.seat_reservation_minutes() from public;
revoke execute on function public.participation_holds_seat(public.participation_status, timestamptz) from public;
revoke execute on function public.published_trip_participant_initials(uuid) from public;
revoke execute on function public.start_payment(uuid, public.payment_kind, text, boolean) from anon, public;
revoke execute on function public.confirm_payment(uuid, text) from anon, authenticated, public;
revoke execute on function public.confirm_simulated_payment(uuid) from anon, public;
revoke execute on function public.trip_participants(uuid) from anon, public;
grant execute on function public.seat_reservation_minutes() to anon, authenticated;
grant execute on function public.participation_holds_seat(public.participation_status, timestamptz) to anon, authenticated;
grant execute on function public.published_trip_participant_initials(uuid) to anon, authenticated;
grant execute on function public.start_payment(uuid, public.payment_kind, text, boolean) to authenticated;
grant execute on function public.confirm_payment(uuid, text) to service_role;
grant execute on function public.confirm_simulated_payment(uuid) to authenticated;
grant execute on function public.trip_participants(uuid) to authenticated;
