-- =============================================================================
-- Odys · composizione del prezzo di un viaggio pubblicato (CB-04).
--
-- Le voci di costo e il compenso desiderato sono dati economici del
-- coordinatore: stanno in una tabella a parte, che legge e scrive solo chi
-- coordina il viaggio (mai i viaggiatori, nemmeno da viaggio pubblicato).
-- Punto di pareggio e guadagno li calcola packages/domain/src/lib/tripPricing.ts.
-- =============================================================================

create table public.published_trip_pricing (
  published_trip_id uuid primary key references public.published_trips (id) on delete cascade,
  cost_items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(cost_items) = 'array' and jsonb_array_length(cost_items) <= 40),
  target_earnings_cents integer check (target_earnings_cents is null or target_earnings_cents between 0 and 100000000),
  updated_at timestamptz not null default now()
);

comment on table public.published_trip_pricing is 'Voci di costo e compenso desiderato del coordinatore per un viaggio pubblicato (CB-04). Riservata al coordinatore.';

-- Chi coordina il viaggio (security definer: non dipende dalla visibilità del viaggio).
create or replace function public.coordinates_published_trip(p_published_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.published_trips t where t.id = p_published_trip_id and t.coordinator_id = auth.uid());
$$;

create or replace function public.touch_published_trip_pricing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger published_trip_pricing_touch before update on public.published_trip_pricing
  for each row execute function public.touch_published_trip_pricing();

alter table public.published_trip_pricing enable row level security;

create policy published_trip_pricing_owner_select on public.published_trip_pricing for select to authenticated
  using (public.coordinates_published_trip(published_trip_id));
create policy published_trip_pricing_owner_insert on public.published_trip_pricing for insert to authenticated
  with check (public.coordinates_published_trip(published_trip_id));
create policy published_trip_pricing_owner_update on public.published_trip_pricing for update to authenticated
  using (public.coordinates_published_trip(published_trip_id))
  with check (public.coordinates_published_trip(published_trip_id));
create policy published_trip_pricing_owner_delete on public.published_trip_pricing for delete to authenticated
  using (public.coordinates_published_trip(published_trip_id));

revoke all on public.published_trip_pricing from anon, authenticated;
grant select, insert, update, delete on public.published_trip_pricing to authenticated;
revoke all on function public.coordinates_published_trip(uuid) from public, anon;
grant execute on function public.coordinates_published_trip(uuid) to authenticated;
revoke all on function public.touch_published_trip_pricing() from public, anon, authenticated;
