-- =============================================================================
-- Odys · moduli a piano dell'agenzia (AG-08).
--
-- Il piano Agenzia ha tre livelli (valori provvisori, punto aperto del
-- cliente; stessi valori di AGENCY_TIER_MODULES in packages/domain):
--   start     → fino a 5 membri oltre al proprietario, dati di base;
--   pro       → fino a 20 membri, dati avanzati (canali e classifica);
--   business  → membri illimitati, dati avanzati e automazioni.
-- Automazioni (business): quando un coordinatore accetta l'invito, ombrello
-- predefinito e licenza Coordinatore Premium se ce n'è una libera.
-- Il livello lo sceglie il proprietario; l'acquisto è simulato.
-- =============================================================================

alter table public.agencies
  add column tier text not null default 'start' check (tier in ('start', 'pro', 'business')),
  add column auto_umbrella_new boolean not null default false,
  add column auto_license_new boolean not null default false;

create or replace function public.agency_tier_max_members(p_tier text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_tier when 'start' then 5 when 'pro' then 20 else null end;
$$;

create or replace function public.agency_tier_has(p_tier text, p_module text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_module
    when 'advanced_analytics' then p_tier in ('pro', 'business')
    when 'automations' then p_tier = 'business'
    else false end;
$$;

-- Livello del piano: solo il proprietario. Scendendo, le automazioni si spengono se il livello non le include.
create or replace function public.set_agency_tier(p_agency_id uuid, p_tier text)
returns public.agencies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency public.agencies;
  v_members integer;
  v_max integer := public.agency_tier_max_members(p_tier);
begin
  if public.agency_role_of(p_agency_id) is distinct from 'owner' then
    raise exception 'Il piano dell’agenzia lo sceglie il proprietario.' using errcode = '42501';
  end if;
  if p_tier not in ('start', 'pro', 'business') then
    raise exception 'Piano non valido.' using errcode = '22023';
  end if;
  select count(*) into v_members from public.agency_members m
    where m.agency_id = p_agency_id and m.role <> 'owner' and m.status in ('invited', 'active');
  if v_max is not null and v_members > v_max then
    raise exception 'Il team ha % membri: il piano scelto ne prevede al massimo %.', v_members, v_max using errcode = '23514';
  end if;
  update public.agencies
    set tier = p_tier,
        auto_umbrella_new = auto_umbrella_new and public.agency_tier_has(p_tier, 'automations'),
        auto_license_new = auto_license_new and public.agency_tier_has(p_tier, 'automations')
    where id = p_agency_id returning * into v_agency;
  insert into public.audit_log (action, entity, entity_id, metadata)
    values ('agency.tier', 'agency', p_agency_id::text, jsonb_build_object('tier', p_tier));
  return v_agency;
end;
$$;

create or replace function public.set_agency_automations(p_agency_id uuid, p_umbrella boolean, p_license boolean)
returns public.agencies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency public.agencies;
begin
  if not public.agency_staff(p_agency_id, array['owner', 'admin']) then
    raise exception 'Operazione non consentita.' using errcode = '42501';
  end if;
  select * into v_agency from public.agencies where id = p_agency_id;
  if (p_umbrella or p_license) and not public.agency_tier_has(v_agency.tier, 'automations') then
    raise exception 'Le automazioni sono incluse nel piano Business.' using errcode = '42501';
  end if;
  update public.agencies set auto_umbrella_new = p_umbrella, auto_license_new = p_license where id = p_agency_id returning * into v_agency;
  insert into public.audit_log (action, entity, entity_id, metadata)
    values ('agency.automations', 'agency', p_agency_id::text, jsonb_build_object('umbrella', p_umbrella, 'license', p_license));
  return v_agency;
end;
$$;

-- Invito con il limite di membri del piano.
create or replace function public.invite_agency_member(p_agency_id uuid, p_email text, p_role public.agency_role)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_member public.agency_members;
  v_tier text;
  v_members integer;
begin
  if coalesce(public.agency_role_of(p_agency_id)::text, '') not in ('owner', 'admin') then
    raise exception 'Operazione non consentita.' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'Il proprietario è uno solo e non si invita.' using errcode = '23514';
  end if;
  select tier into v_tier from public.agencies where id = p_agency_id;
  select count(*) into v_members from public.agency_members m
    where m.agency_id = p_agency_id and m.role <> 'owner' and m.status in ('invited', 'active');
  if public.agency_tier_max_members(v_tier) is not null and v_members >= public.agency_tier_max_members(v_tier) then
    raise exception 'Il piano % prevede al massimo % membri nel team: passa a un piano superiore per invitarne altri.',
      initcap(v_tier), public.agency_tier_max_members(v_tier) using errcode = '23514';
  end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null or not exists (select 1 from public.profiles where id = v_user and status = 'active') then
    raise exception 'Nessun account Odys attivo con questa email: chiedi alla persona di registrarsi.' using errcode = 'P0002';
  end if;
  select * into v_member from public.agency_members where agency_id = p_agency_id and user_id = v_user;
  if found and v_member.status in ('invited', 'active') then
    raise exception 'Questa persona fa già parte del team o ha un invito in attesa.' using errcode = '23505';
  end if;
  if found then
    update public.agency_members
      set role = p_role, link_type = case when p_role = 'coordinator' then 'associated'::public.agency_link_type end,
          status = 'invited', invited_by = auth.uid(), created_at = now(), accepted_at = null, removed_at = null, license_subscription_id = null
      where id = v_member.id returning * into v_member;
  else
    insert into public.agency_members (agency_id, user_id, role, link_type, status, invited_by)
      values (p_agency_id, v_user, p_role, case when p_role = 'coordinator' then 'associated'::public.agency_link_type end, 'invited', auth.uid())
      returning * into v_member;
  end if;
  insert into public.audit_log (action, entity, entity_id, metadata)
    values ('agency.invite', 'agency_member', v_member.id::text, jsonb_build_object('agency', p_agency_id, 'role', p_role));
  return v_member.id;
end;
$$;

-- Accettazione con le automazioni del piano Business.
create or replace function public.respond_agency_invite(p_member_id uuid, p_accept boolean)
returns public.agency_member_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.agency_members;
  v_agency public.agencies;
  v_used integer;
  v_subscription uuid;
begin
  select * into v_member from public.agency_members where id = p_member_id and user_id = auth.uid() for update;
  if not found or v_member.status <> 'invited' then
    raise exception 'Invito non trovato.' using errcode = 'P0002';
  end if;
  update public.agency_members
    set status = case when p_accept then 'active' else 'declined' end::public.agency_member_status,
        accepted_at = case when p_accept then now() end
    where id = p_member_id returning * into v_member;
  insert into public.audit_log (action, entity, entity_id, metadata)
    values (case when p_accept then 'agency.invite_accept' else 'agency.invite_decline' end, 'agency_member', p_member_id::text, jsonb_build_object('agency', v_member.agency_id));

  if p_accept and v_member.role = 'coordinator' then
    select * into v_agency from public.agencies where id = v_member.agency_id for update;
    if public.agency_tier_has(v_agency.tier, 'automations') then
      if v_agency.auto_umbrella_new then
        update public.agency_members set umbrella_default = true where id = p_member_id;
        insert into public.audit_log (actor_id, action, entity, entity_id, metadata)
          values (v_agency.owner_id, 'agency.umbrella_default', 'agency_member', p_member_id::text, jsonb_build_object('agency', v_agency.id, 'on', true, 'automatic', true));
      end if;
      if v_agency.auto_license_new then
        select count(*) into v_used from public.agency_members m where m.agency_id = v_agency.id and m.status = 'active' and m.link_type = 'licensed';
        if v_used < v_agency.license_seats then
          insert into public.subscriptions (user_id, plan, status, source, created_by)
            values (v_member.user_id, 'coordinator_premium', 'active', 'agency_license', v_agency.owner_id) returning id into v_subscription;
          update public.agency_members set link_type = 'licensed', license_subscription_id = v_subscription where id = p_member_id;
          insert into public.audit_log (actor_id, action, entity, entity_id, metadata)
            values (v_agency.owner_id, 'agency.license_assign', 'agency_member', p_member_id::text, jsonb_build_object('agency', v_agency.id, 'user', v_member.user_id, 'automatic', true));
        end if;
      end if;
    end if;
  end if;
  return v_member.status;
end;
$$;

revoke all on function public.set_agency_tier(uuid, text) from public, anon;
revoke all on function public.set_agency_automations(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_agency_tier(uuid, text) to authenticated;
grant execute on function public.set_agency_automations(uuid, boolean, boolean) to authenticated;
grant execute on function public.agency_tier_max_members(text) to authenticated;
grant execute on function public.agency_tier_has(text, text) to authenticated;
