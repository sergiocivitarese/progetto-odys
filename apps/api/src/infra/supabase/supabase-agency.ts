import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AgencyLinkType, AgencyMemberStatus, AgencyRole, BillingCycle } from '@odys/domain';
import type { AppConfig } from '../../config/env';
import type { Agency, AgencyDashboardData, AgencyInvite, AgencyMember, AgencyProfileInput, AgencyPublicProfile, AgencyRepository, AgencyStore, MyAgency } from '../../shared/agency';
import type { AuthUser } from '../../shared/auth';
import { HttpError } from '../../shared/http';
import { dbError, userClient } from './client';
import { coordinatorCardsById, summariesOf, SUMMARY_COLUMNS_FOR_AGENCY } from './supabase-catalog';
import type { PublishedTripSummary } from '../../shared/catalog';

interface AgencyRow {
  id: string; legal_name: string; display_name: string; slug: string; description: string; logo_url: string | null; email: string | null;
  phone: string | null; website: string | null; city: string | null; country: string | null; license_seats: number; billing_cycle: BillingCycle; sale_terms: string | null; created_at: string;
}

const AGENCY_COLUMNS = 'id, legal_name, display_name, slug, description, logo_url, email, phone, website, city, country, license_seats, billing_cycle, sale_terms, created_at';

function toAgency(row: AgencyRow): Agency {
  return {
    id: row.id, legalName: row.legal_name, displayName: row.display_name, slug: row.slug, description: row.description,
    logoUrl: row.logo_url ?? undefined, email: row.email ?? undefined, phone: row.phone ?? undefined, website: row.website ?? undefined,
    city: row.city ?? undefined, country: row.country ?? undefined, licenseSeats: row.license_seats, billingCycle: row.billing_cycle, saleTerms: row.sale_terms ?? '', createdAt: row.created_at,
  };
}

/** I messaggi delle funzioni dell'agenzia sono già leggibili: si conservano anche per 404 e 403. */
function agencyError(error: { code?: string; message?: string }): HttpError {
  if (error.code === 'P0002' && error.message) return new HttpError(404, error.message);
  if (error.code === '42501' && error.message && !error.message.includes('permission denied')) return new HttpError(403, error.message);
  if (error.code === '23505' && error.message?.includes('agencies_slug_key')) return new HttpError(409, 'Questo indirizzo è già usato da un’altra agenzia.');
  return dbError(error);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

class SupabaseAgencyRepository implements AgencyRepository {
  constructor(private readonly db: SupabaseClient, private readonly user: AuthUser) {}

  private async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(name, args);
    if (error) throw agencyError(error);
    return data as T;
  }

  async mine(): Promise<MyAgency[]> {
    const { data, error } = await this.db.from('agency_members').select('id, agency_id, role, link_type').eq('user_id', this.user.id).eq('status', 'active');
    if (error) throw dbError(error);
    const members = data as Array<{ id: string; agency_id: string; role: AgencyRole; link_type: AgencyLinkType | null }>;
    if (!members.length) return [];
    const agencies = await this.db.from('agencies').select(AGENCY_COLUMNS).in('id', members.map((member) => member.agency_id));
    if (agencies.error) throw dbError(agencies.error);
    return members.flatMap((member) => {
      const row = (agencies.data as AgencyRow[]).find((item) => item.id === member.agency_id);
      return row ? [{ agency: toAgency(row), role: member.role, memberId: member.id, linkType: member.link_type ?? undefined }] : [];
    });
  }

  async create(input: { legalName: string; displayName: string; slug: string }): Promise<Agency> {
    return toAgency(await this.call<AgencyRow>('create_agency', { p_legal_name: input.legalName, p_display_name: input.displayName, p_slug: input.slug }));
  }

  async updateProfile(agencyId: string, patch: AgencyProfileInput): Promise<Agency> {
    if (!isUuid(agencyId)) throw new HttpError(404, 'Agenzia non trovata.');
    const row: Record<string, unknown> = {};
    const map: Record<keyof AgencyProfileInput, string> = { legalName: 'legal_name', displayName: 'display_name', slug: 'slug', description: 'description', logoUrl: 'logo_url', email: 'email', phone: 'phone', website: 'website', city: 'city', country: 'country', saleTerms: 'sale_terms' };
    for (const [key, column] of Object.entries(map) as Array<[keyof AgencyProfileInput, string]>) if (patch[key] !== undefined) row[column] = patch[key] || (key === 'description' || key === 'saleTerms' ? '' : null);
    const { data, error } = await this.db.from('agencies').update(row).eq('id', agencyId).select(AGENCY_COLUMNS).maybeSingle();
    if (error) throw agencyError(error);
    if (!data) throw new HttpError(403, 'Operazione non consentita.');
    return toAgency(data as AgencyRow);
  }

  async team(agencyId: string): Promise<AgencyMember[]> {
    if (!isUuid(agencyId)) throw new HttpError(404, 'Agenzia non trovata.');
    const rows = await this.call<Array<Record<string, unknown>>>('agency_team', { p_agency_id: agencyId });
    return rows.map((row) => ({
      id: String(row['id']), userId: String(row['user_id']), firstName: String(row['first_name'] ?? ''), lastName: String(row['last_name'] ?? ''),
      email: (row['email'] as string | null) ?? undefined, role: row['role'] as AgencyRole, linkType: (row['link_type'] as AgencyLinkType | null) ?? undefined,
      status: row['status'] as AgencyMemberStatus, licensed: Boolean(row['licensed']), umbrellaDefault: Boolean(row['umbrella_default']), createdAt: String(row['created_at']),
      acceptedAt: (row['accepted_at'] as string | null) ?? undefined, isCoordinator: Boolean(row['is_coordinator']), verified: Boolean(row['verified']),
      tripsOnSale: Number(row['trips_on_sale'] ?? 0), tripsRunning: Number(row['trips_running'] ?? 0),
    }));
  }

  async invite(agencyId: string, email: string, role: AgencyRole): Promise<string> {
    return String(await this.call('invite_agency_member', { p_agency_id: agencyId, p_email: email, p_role: role }));
  }

  async invites(): Promise<AgencyInvite[]> {
    const { data, error } = await this.db.from('agency_members').select('id, agency_id, role, link_type, created_at').eq('user_id', this.user.id).eq('status', 'invited');
    if (error) throw dbError(error);
    const rows = data as Array<{ id: string; agency_id: string; role: AgencyRole; link_type: AgencyLinkType | null; created_at: string }>;
    if (!rows.length) return [];
    // Il nome dell'agenzia arriva dal profilo pubblico: l'invitato non è ancora membro.
    const profiles = await this.db.from('agency_profiles').select('id, slug, display_name').in('id', rows.map((row) => row.agency_id));
    if (profiles.error) throw dbError(profiles.error);
    return rows.map((row) => {
      const profile = (profiles.data as Array<{ id: string; slug: string; display_name: string }>).find((item) => item.id === row.agency_id);
      return { id: row.id, agencyId: row.agency_id, agencyName: profile?.display_name ?? 'Agenzia', agencySlug: profile?.slug ?? '', role: row.role, linkType: row.link_type ?? undefined, createdAt: row.created_at };
    });
  }

  async respond(memberId: string, accept: boolean): Promise<AgencyMemberStatus> {
    if (!isUuid(memberId)) throw new HttpError(404, 'Invito non trovato.');
    return this.call<AgencyMemberStatus>('respond_agency_invite', { p_member_id: memberId, p_accept: accept });
  }

  async assignLicense(memberId: string): Promise<void> {
    if (!isUuid(memberId)) throw new HttpError(404, 'Membro non trovato.');
    await this.call('assign_agency_license', { p_member_id: memberId });
  }

  async revokeLicense(memberId: string): Promise<void> {
    if (!isUuid(memberId)) throw new HttpError(404, 'Membro non trovato.');
    await this.call('revoke_agency_license', { p_member_id: memberId });
  }

  async remove(memberId: string): Promise<void> {
    if (!isUuid(memberId)) throw new HttpError(404, 'Membro non trovato.');
    await this.call('remove_agency_member', { p_member_id: memberId });
  }

  async catalog(agencyId: string): Promise<{ trips: PublishedTripSummary[]; coordinatorTrips: PublishedTripSummary[] }> {
    if (!isUuid(agencyId)) throw new HttpError(404, 'Agenzia non trovata.');
    const team = await this.team(agencyId);
    const coordinators = team.filter((member) => member.role === 'coordinator' && member.status === 'active').map((member) => member.userId);
    const own = await this.db.from('published_trips').select(SUMMARY_COLUMNS_FOR_AGENCY).eq('agency_id', agencyId).eq('agency_owned', true).order('start_date', { ascending: true, nullsFirst: false });
    if (own.error) throw dbError(own.error);
    // I viaggi dei coordinatori li vedono proprietario e amministratori (regola di accesso `agency_staff_sees_trip`).
    const theirs = coordinators.length
      ? await this.db.from('published_trips').select(SUMMARY_COLUMNS_FOR_AGENCY).in('coordinator_id', coordinators).eq('agency_owned', false).order('start_date', { ascending: true, nullsFirst: false })
      : { data: [], error: null };
    if (theirs.error) throw dbError(theirs.error);
    return { trips: await summariesOf(this.db, own.data ?? []), coordinatorTrips: await summariesOf(this.db, theirs.data ?? []) };
  }

  async addDeparture(tripId: string, startDate: string, endDate: string): Promise<string> {
    if (!isUuid(tripId)) throw new HttpError(404, 'Viaggio non trovato.');
    return String(await this.call('add_agency_departure', { p_trip_id: tripId, p_start: startDate, p_end: endDate }));
  }

  async assignCoordinator(tripId: string, userId: string | null): Promise<void> {
    if (!isUuid(tripId) || (userId !== null && !isUuid(userId))) throw new HttpError(404, 'Viaggio non trovato.');
    await this.call('assign_departure_coordinator', { p_trip_id: tripId, p_user_id: userId });
  }

  async setUmbrella(agencyId: string, tripId: string, on: boolean): Promise<void> {
    if (!isUuid(agencyId) || !isUuid(tripId)) throw new HttpError(404, 'Viaggio non trovato.');
    await this.call('set_trip_umbrella', { p_trip_id: tripId, p_agency_id: agencyId, p_on: on });
  }

  async setUmbrellaDefault(memberId: string, on: boolean): Promise<void> {
    if (!isUuid(memberId)) throw new HttpError(404, 'Membro non trovato.');
    await this.call('set_member_umbrella_default', { p_member_id: memberId, p_on: on });
  }

  async proposals(agencyId: string): Promise<PublishedTripSummary[]> {
    if (!isUuid(agencyId)) throw new HttpError(404, 'Agenzia non trovata.');
    const { data, error } = await this.db.from('published_trips').select(SUMMARY_COLUMNS_FOR_AGENCY)
      .eq('agency_id', agencyId).eq('agency_owned', false).eq('approval_status', 'pending').order('approval_requested_at', { ascending: true });
    if (error) throw dbError(error);
    return summariesOf(this.db, data ?? []);
  }

  async decideProposal(tripId: string, approve: boolean, note?: string): Promise<void> {
    if (!isUuid(tripId)) throw new HttpError(404, 'Proposta non trovata.');
    await this.call('decide_agency_proposal', { p_trip_id: tripId, p_approve: approve, p_note: note ?? null });
  }

  async dashboardData(agencyId: string, since: string): Promise<AgencyDashboardData> {
    if (!isUuid(agencyId)) throw new HttpError(404, 'Agenzia non trovata.');
    const raw = await this.call<Partial<AgencyDashboardData>>('agency_dashboard_data', { p_agency_id: agencyId, p_since: since });
    return { trips: (raw.trips ?? []).map((trip) => ({ ...trip, sold: Number(trip.sold) })), payments: raw.payments ?? [], bookings: raw.bookings ?? [], coordinators: raw.coordinators ?? [] };
  }

  async setSeats(agencyId: string, seats: number, cycle: BillingCycle): Promise<Agency> {
    if (!isUuid(agencyId)) throw new HttpError(404, 'Agenzia non trovata.');
    return toAgency(await this.call<AgencyRow>('set_agency_license_seats', { p_agency_id: agencyId, p_seats: seats, p_billing_cycle: cycle }));
  }
}

export function supabaseAgency(config: AppConfig): AgencyStore {
  const anon = config.supabase.url && config.supabase.anonKey
    ? createClient(config.supabase.url, config.supabase.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    : null;
  return {
    agency: (user) => new SupabaseAgencyRepository(userClient(config, user.accessToken), user),
    async agencyBySlug(slug: string): Promise<AgencyPublicProfile | null> {
      if (!anon) throw dbError({ code: 'not_configured' });
      const { data, error } = await anon.from('agency_profiles').select('*').eq('slug', slug).maybeSingle();
      if (error) throw dbError(error);
      if (!data) return null;
      const row = data as AgencyRow & { coordinator_ids: string[] };
      const cards = await coordinatorCardsById(anon, row.coordinator_ids ?? []);
      return {
        id: row.id, slug: row.slug, displayName: row.display_name, description: row.description, logoUrl: row.logo_url ?? undefined,
        email: row.email ?? undefined, phone: row.phone ?? undefined, website: row.website ?? undefined, city: row.city ?? undefined, country: row.country ?? undefined,
        coordinators: (row.coordinator_ids ?? []).flatMap((id) => (cards.get(id) ? [cards.get(id)!] : [])),
      };
    },
  };
}
