-- =============================================================================
-- Odys · Split delle spese (TP-09): cassa comune del viaggio di gruppo.
--
-- Il gruppo è quello di un viaggio pubblicato: il coordinatore e chi ha il
-- posto confermato o saldato. Usare la cassa richiede il diritto `split.use`
-- (Traveller Premium e coordinatori): punto aperto del cliente se estenderla
-- ai Base invitati in un gruppo con un Premium.
-- Le quote le calcola il server (packages/domain/src/lib/split.ts); il database
-- verifica che tornino con l'importo e che siano tutte di membri del gruppo.
-- =============================================================================

-- Membri del gruppo di un viaggio.
create or replace function public.split_members(p_published_trip_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select t.coordinator_id from public.published_trips t where t.id = p_published_trip_id
    union
    select r.user_id from public.participation_requests r
    where r.published_trip_id = p_published_trip_id and r.status in ('confirmed', 'balance_paid')
  );
$$;

create or replace function public.split_is_member(p_published_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() = any(public.split_members(p_published_trip_id));
$$;

create table public.split_expenses (
  id uuid primary key default gen_random_uuid(),
  published_trip_id uuid not null references public.published_trips (id) on delete cascade,
  paid_by uuid not null references public.profiles (id) on delete cascade,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  description text not null check (char_length(btrim(description)) between 1 and 120),
  category text not null check (category in ('food', 'transport', 'activities', 'lodging', 'other', 'settlement')),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 10000000),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index split_expenses_trip_idx on public.split_expenses (published_trip_id, created_at desc) where deleted_at is null;

create table public.split_shares (
  expense_id uuid not null references public.split_expenses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  primary key (expense_id, user_id)
);

comment on table public.split_expenses is 'Spese della cassa comune di un viaggio (TP-09). Si scrivono solo con add_split_expense().';

-- Aggiunge una spesa (o un rimborso) con le quote già calcolate dal server.
create or replace function public.add_split_expense(
  p_published_trip_id uuid, p_description text, p_category text, p_amount_cents integer, p_paid_by uuid, p_shares jsonb
)
returns public.split_expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_members uuid[] := public.split_members(p_published_trip_id);
  v_expense public.split_expenses;
  v_sum integer;
  v_share record;
begin
  if not (auth.uid() = any(v_members)) then
    raise exception 'Non fai parte del gruppo di questo viaggio.' using errcode = '42501';
  end if;
  if not public.has_entitlement('split.use') then
    raise exception 'Lo Split è incluso in Traveller Premium.' using errcode = '42501';
  end if;
  if not (p_paid_by = any(v_members)) then
    raise exception 'Chi ha pagato deve far parte del gruppo.' using errcode = '23514';
  end if;
  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'Scegli almeno una persona con cui dividere la spesa.' using errcode = '23514';
  end if;
  select coalesce(sum((item ->> 'amountCents')::integer), 0) into v_sum from jsonb_array_elements(p_shares) item;
  if v_sum <> p_amount_cents then
    raise exception 'Le quote non corrispondono all’importo.' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(p_shares) item where not ((item ->> 'userId')::uuid = any(v_members))) then
    raise exception 'Si divide solo con chi fa parte del gruppo.' using errcode = '23514';
  end if;

  insert into public.split_expenses (published_trip_id, paid_by, description, category, amount_cents, currency)
    select p_published_trip_id, p_paid_by, btrim(p_description), p_category, p_amount_cents, t.currency
    from public.published_trips t where t.id = p_published_trip_id
    returning * into v_expense;
  for v_share in select (item ->> 'userId')::uuid as user_id, (item ->> 'amountCents')::integer as amount from jsonb_array_elements(p_shares) item loop
    insert into public.split_shares (expense_id, user_id, amount_cents) values (v_expense.id, v_share.user_id, v_share.amount);
  end loop;
  return v_expense;
end;
$$;

-- Elimina una spesa: solo chi l'ha inserita (resta nello storico come eliminata).
create or replace function public.delete_split_expense(p_expense_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.split_expenses set deleted_at = now()
    where id = p_expense_id and created_by = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'Puoi eliminare solo le spese che hai inserito tu.' using errcode = '42501';
  end if;
  return true;
end;
$$;

-- Membri con nome per la schermata (nome e iniziale del cognome).
create or replace function public.split_group(p_published_trip_id uuid)
returns table (user_id uuid, display_name text, initials text, is_coordinator boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.split_is_member(p_published_trip_id) then
    raise exception 'Non fai parte del gruppo di questo viaggio.' using errcode = '42501';
  end if;
  return query
    select p.id, p.first_name || ' ' || left(p.last_name, 1) || '.', upper(left(p.first_name, 1) || left(p.last_name, 1)),
           p.id = t.coordinator_id
    from public.profiles p
    join public.published_trips t on t.id = p_published_trip_id
    where p.id = any(public.split_members(p_published_trip_id))
    order by p.id = t.coordinator_id desc, p.first_name;
end;
$$;

-- =============================================================================
-- Regole di accesso: lettura per i membri del gruppo, scrittura solo dalle funzioni.
-- =============================================================================
alter table public.split_expenses enable row level security;
alter table public.split_shares enable row level security;

create policy split_expenses_select on public.split_expenses for select to authenticated
  using (deleted_at is null and public.split_is_member(published_trip_id));
create policy split_shares_select on public.split_shares for select to authenticated
  using (exists (select 1 from public.split_expenses e where e.id = expense_id and e.deleted_at is null and public.split_is_member(e.published_trip_id)));

grant select on public.split_expenses, public.split_shares to authenticated;

revoke execute on function public.split_members(uuid) from anon, authenticated, public;
revoke execute on function public.split_is_member(uuid) from anon, public;
revoke execute on function public.add_split_expense(uuid, text, text, integer, uuid, jsonb) from anon, public;
revoke execute on function public.delete_split_expense(uuid) from anon, public;
revoke execute on function public.split_group(uuid) from anon, public;
grant execute on function public.split_is_member(uuid) to authenticated;
grant execute on function public.add_split_expense(uuid, text, text, integer, uuid, jsonb) to authenticated;
grant execute on function public.delete_split_expense(uuid) to authenticated;
grant execute on function public.split_group(uuid) to authenticated;
