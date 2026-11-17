import { randomUUID } from 'node:crypto';
import { agencyCan, describeEntitlements, isValidAgencySlug, type AgencyAction, type AgencyLinkType, type AgencyMemberStatus, type AgencyRole, type BillingCycle } from '@odys/domain';
import type { Agency, AgencyDashboardData, AgencyMember, AgencyProfileInput, AgencyRepository, AgencyStore, MyAgency } from '../../shared/agency';
import type { CoordinatorCard, PublishedTrip, PublishedTripSummary } from '../../shared/catalog';
import { HttpError } from '../../shared/http';
import type { MemoryDatabase } from './memory-store';

export type MemoryAgency = Agency & { ownerId: string };
export interface MemoryAgencyMember {
  id: string;
  agencyId: string;
  userId: string;
  role: AgencyRole;
  linkType?: AgencyLinkType;
  status: AgencyMemberStatus;
  licensed: boolean;
  umbrellaDefault?: boolean;
  createdAt: string;
  acceptedAt?: string;
}

/** Ruolo attivo di un utente in un'agenzia (come `agency_role_of`). */
export function agencyRoleOf(db: MemoryDatabase, userId: string, agencyId: string): AgencyRole | null {
  return [...db.agencyMembers.values()].find((member) => member.agencyId === agencyId && member.userId === userId && member.status === 'active')?.role ?? null;
}

type TripView = (db: MemoryDatabase, id: string) => PublishedTrip | null;

/** Stesse regole delle funzioni SQL della migrazione 0020. */
class MemoryAgencyRepository implements AgencyRepository {
  constructor(private readonly db: MemoryDatabase, private readonly userId: string, private readonly tripView: TripView) {}

  private roleIn(agencyId: string): AgencyRole | null {
    return [...this.db.agencyMembers.values()].find((member) => member.agencyId === agencyId && member.userId === this.userId && member.status === 'active')?.role ?? null;
  }

  private require(agencyId: string, action: AgencyAction, message = 'Operazione non consentita.'): MemoryAgency {
    const agency = this.db.agencies.get(agencyId);
    if (!agency || !agencyCan(this.roleIn(agencyId), action)) throw new HttpError(403, message);
    return agency;
  }

  private member(memberId: string, action: AgencyAction): MemoryAgencyMember {
    const member = this.db.agencyMembers.get(memberId);
    if (!member || !agencyCan(this.roleIn(member.agencyId), action)) throw new HttpError(403, 'Operazione non consentita.');
    return member;
  }

  private audit(action: string, entityId: string, metadata: Record<string, unknown> = {}) {
    this.db.user(this.userId).audit.unshift({ action, entity: 'agency', entityId, metadata, createdAt: new Date().toISOString() });
  }

  private view(agency: MemoryAgency): Agency {
    const { ownerId: _owner, ...rest } = structuredClone(agency);
    return rest;
  }

  async mine(): Promise<MyAgency[]> {
    return [...this.db.agencyMembers.values()]
      .filter((member) => member.userId === this.userId && member.status === 'active')
      .flatMap((member) => {
        const agency = this.db.agencies.get(member.agencyId);
        return agency ? [{ agency: this.view(agency), role: member.role, memberId: member.id, linkType: member.linkType }] : [];
      });
  }

  async create(input: { legalName: string; displayName: string; slug: string }): Promise<Agency> {
    const me = this.db.user(this.userId);
    if (!describeEntitlements(me.profile.role, me.plans).entitlements.includes('agency.team')) throw new HttpError(403, 'Questa funzione è inclusa nel piano Agenzia.');
    if ([...this.db.agencies.values()].some((agency) => agency.ownerId === this.userId)) throw new HttpError(409, 'Hai già un’agenzia.');
    if (!isValidAgencySlug(input.slug)) throw new HttpError(422, 'Indirizzo non valido.');
    if ([...this.db.agencies.values()].some((agency) => agency.slug === input.slug)) throw new HttpError(409, 'Questo indirizzo è già usato da un’altra agenzia.');
    const now = new Date().toISOString();
    const agency: MemoryAgency = { id: randomUUID(), ownerId: this.userId, legalName: input.legalName, displayName: input.displayName, slug: input.slug, description: '', licenseSeats: 0, billingCycle: 'monthly', saleTerms: '', createdAt: now };
    this.db.agencies.set(agency.id, agency);
    const owner: MemoryAgencyMember = { id: randomUUID(), agencyId: agency.id, userId: this.userId, role: 'owner', status: 'active', licensed: false, createdAt: now, acceptedAt: now };
    this.db.agencyMembers.set(owner.id, owner);
    this.audit('agency.create', agency.id);
    return this.view(agency);
  }

  async updateProfile(agencyId: string, patch: AgencyProfileInput): Promise<Agency> {
    const agency = this.require(agencyId, 'profile.edit');
    if (patch.slug !== undefined && patch.slug !== agency.slug) {
      if (!isValidAgencySlug(patch.slug)) throw new HttpError(422, 'Indirizzo non valido.');
      if ([...this.db.agencies.values()].some((other) => other.slug === patch.slug)) throw new HttpError(409, 'Questo indirizzo è già usato da un’altra agenzia.');
    }
    for (const [key, value] of Object.entries(patch) as Array<[keyof AgencyProfileInput, string | undefined]>) {
      if (value === undefined) continue;
      (agency as unknown as Record<string, unknown>)[key] = value || (key === 'description' ? '' : undefined);
    }
    return this.view(agency);
  }

  async team(agencyId: string): Promise<AgencyMember[]> {
    this.require(agencyId, 'team.view');
    const today = new Date().toISOString().slice(0, 10);
    const order: Record<AgencyRole, number> = { owner: 0, admin: 1, operator: 2, coordinator: 3 };
    return [...this.db.agencyMembers.values()]
      .filter((member) => member.agencyId === agencyId && (member.status === 'invited' || member.status === 'active'))
      .sort((a, b) => order[a.role] - order[b.role] || a.createdAt.localeCompare(b.createdAt))
      .map((member) => {
        const profile = this.db.user(member.userId).profile;
        const trips = [...this.db.published.values()].filter((trip) => trip.coordinatorId === member.userId && trip.status === 'published');
        return {
          id: member.id, userId: member.userId, firstName: profile.firstName, lastName: profile.lastName, email: profile.email,
          role: member.role, linkType: member.linkType, status: member.status, licensed: member.licensed, umbrellaDefault: member.umbrellaDefault ?? false, createdAt: member.createdAt, acceptedAt: member.acceptedAt,
          isCoordinator: profile.role === 'coordinator' || profile.role === 'admin',
          verified: this.db.applications.some((item) => item.userId === member.userId && item.status === 'approved'),
          tripsOnSale: trips.filter((trip) => !trip.startDate || trip.startDate > today).length,
          tripsRunning: trips.filter((trip) => trip.startDate && trip.startDate <= today && (!trip.endDate || trip.endDate >= today)).length,
        };
      });
  }

  async invite(agencyId: string, email: string, role: AgencyRole): Promise<string> {
    this.require(agencyId, 'team.invite');
    if (role === 'owner') throw new HttpError(422, 'Il proprietario è uno solo e non si invita.');
    const target = [...this.db.users.values()].find((user) => (user.profile.email ?? '').toLowerCase() === email.trim().toLowerCase() && user.profile.status === 'active');
    if (!target) throw new HttpError(404, 'Nessun account Odys attivo con questa email: chiedi alla persona di registrarsi.');
    const existing = [...this.db.agencyMembers.values()].find((member) => member.agencyId === agencyId && member.userId === target.profile.id);
    if (existing && (existing.status === 'invited' || existing.status === 'active')) throw new HttpError(409, 'Questa persona fa già parte del team o ha un invito in attesa.');
    const member: MemoryAgencyMember = existing ?? { id: randomUUID(), agencyId, userId: target.profile.id, role, status: 'invited', licensed: false, createdAt: '' };
    Object.assign(member, { role, linkType: role === 'coordinator' ? 'associated' : undefined, status: 'invited', licensed: false, createdAt: new Date().toISOString(), acceptedAt: undefined });
    this.db.agencyMembers.set(member.id, member);
    this.audit('agency.invite', member.id, { agency: agencyId, role });
    return member.id;
  }

  async invites() {
    return [...this.db.agencyMembers.values()]
      .filter((member) => member.userId === this.userId && member.status === 'invited')
      .map((member) => {
        const agency = this.db.agencies.get(member.agencyId);
        return { id: member.id, agencyId: member.agencyId, agencyName: agency?.displayName ?? 'Agenzia', agencySlug: agency?.slug ?? '', role: member.role, linkType: member.linkType, createdAt: member.createdAt };
      });
  }

  async respond(memberId: string, accept: boolean): Promise<AgencyMemberStatus> {
    const member = this.db.agencyMembers.get(memberId);
    if (!member || member.userId !== this.userId || member.status !== 'invited') throw new HttpError(404, 'Invito non trovato.');
    member.status = accept ? 'active' : 'declined';
    member.acceptedAt = accept ? new Date().toISOString() : undefined;
    this.audit(accept ? 'agency.invite_accept' : 'agency.invite_decline', memberId);
    return member.status;
  }

  async assignLicense(memberId: string): Promise<void> {
    const member = this.member(memberId, 'licenses.assign');
    if (member.role !== 'coordinator' || member.status !== 'active') throw new HttpError(422, 'La licenza si assegna a un coordinatore che ha accettato l’invito.');
    if (member.licensed) throw new HttpError(409, 'Questo coordinatore ha già una licenza.');
    const agency = this.db.agencies.get(member.agencyId)!;
    const used = [...this.db.agencyMembers.values()].filter((item) => item.agencyId === agency.id && item.status === 'active' && item.licensed).length;
    if (used >= agency.licenseSeats) throw new HttpError(422, 'Non hai licenze libere: aumentane il numero.');
    // Come la riga di `subscriptions` con source `agency_license`.
    this.db.user(member.userId).plans.push('coordinator_premium');
    Object.assign(member, { licensed: true, linkType: 'licensed' });
    this.audit('agency.license_assign', memberId, { agency: agency.id, user: member.userId });
  }

  async revokeLicense(memberId: string): Promise<void> {
    const member = this.member(memberId, 'licenses.assign');
    if (!member.licensed) throw new HttpError(422, 'Questo coordinatore non ha una licenza.');
    const plans = this.db.user(member.userId).plans;
    const index = plans.indexOf('coordinator_premium');
    if (index >= 0) plans.splice(index, 1);
    Object.assign(member, { licensed: false, linkType: 'associated' });
    this.audit('agency.license_revoke', memberId, { agency: member.agencyId, user: member.userId });
  }

  async remove(memberId: string): Promise<void> {
    const member = this.member(memberId, 'team.remove');
    if (member.role === 'owner') throw new HttpError(422, 'Il proprietario non si rimuove dal team.');
    if (member.licensed) await this.revokeLicense(memberId);
    member.status = 'removed';
    this.audit('agency.member_remove', memberId, { agency: member.agencyId });
  }

  async setSeats(agencyId: string, seats: number, cycle: BillingCycle): Promise<Agency> {
    const agency = this.require(agencyId, 'licenses.seats', 'Solo il proprietario gestisce le licenze acquistate.');
    const used = [...this.db.agencyMembers.values()].filter((item) => item.agencyId === agencyId && item.status === 'active' && item.licensed).length;
    if (seats < used) throw new HttpError(422, `Hai ${used} licenze assegnate: revocane qualcuna prima di scendere a ${seats}.`);
    Object.assign(agency, { licenseSeats: seats, billingCycle: cycle });
    this.audit('agency.license_seats', agencyId, { seats, billingCycle: cycle });
    return this.view(agency);
  }

  private staff(agencyId: string | undefined, roles: AgencyRole[] = ['owner', 'admin', 'operator']): boolean {
    return Boolean(agencyId && roles.includes(this.roleIn(agencyId) as AgencyRole));
  }

  private hasCoordinator(agencyId: string, userId: string): boolean {
    const profile = this.db.users.get(userId)?.profile;
    return [...this.db.agencyMembers.values()].some((member) => member.agencyId === agencyId && member.userId === userId && member.status === 'active' && member.role === 'coordinator')
      && Boolean(profile && ['coordinator', 'admin'].includes(profile.role) && profile.status === 'active');
  }

  async catalog(agencyId: string) {
    this.require(agencyId, 'team.view');
    const views = (ids: string[]) => ids.map((id) => this.tripView(this.db, id)).filter((trip): trip is PublishedTrip => Boolean(trip)) as PublishedTripSummary[];
    const all = [...this.db.published.values()];
    const coordinators = [...this.db.agencyMembers.values()].filter((member) => member.agencyId === agencyId && member.status === 'active' && member.role === 'coordinator').map((member) => member.userId);
    return {
      trips: views(all.filter((trip) => trip.agencyId === agencyId && trip.agencyOwned).map((trip) => trip.id)),
      coordinatorTrips: this.staff(agencyId, ['owner', 'admin'])
        ? views(all.filter((trip) => !trip.agencyOwned && coordinators.includes(trip.coordinatorId)).map((trip) => trip.id))
        : [],
    };
  }

  async addDeparture(tripId: string, startDate: string, endDate: string): Promise<string> {
    const trip = this.db.published.get(tripId);
    if (!trip || !trip.agencyOwned || !this.staff(trip.agencyId)) throw new HttpError(404, 'Viaggio non trovato.');
    if (!startDate || !endDate || endDate < startDate) throw new HttpError(422, 'Indica date di partenza e rientro valide.');
    trip.seriesId ??= trip.id;
    const copy = structuredClone(trip);
    const id = randomUUID();
    Object.assign(copy, { id, coordinatorId: '', status: 'draft', effectiveStatus: 'draft', startDate, endDate, balanceDueDate: undefined, publishedAt: undefined, scheduledFor: undefined, updatedAt: new Date().toISOString() });
    this.db.published.set(id, copy);
    this.audit('agency.departure_add', id, { agency: trip.agencyId, series: trip.seriesId });
    return id;
  }

  async assignCoordinator(tripId: string, userId: string | null): Promise<void> {
    const trip = this.db.published.get(tripId);
    if (!trip || !trip.agencyOwned || !this.staff(trip.agencyId)) throw new HttpError(404, 'Viaggio non trovato.');
    if (userId && !this.hasCoordinator(trip.agencyId!, userId)) throw new HttpError(422, 'Scegli un coordinatore del team dell’agenzia.');
    if (!userId && (trip.status === 'published' || trip.status === 'scheduled')) throw new HttpError(422, 'Una partenza pubblicata ha sempre un coordinatore: scegline un altro invece di toglierlo.');
    trip.coordinatorId = userId ?? '';
    this.audit('agency.departure_coordinator', tripId, { agency: trip.agencyId, coordinator: userId });
  }

  async setUmbrella(agencyId: string, tripId: string, on: boolean): Promise<void> {
    if (!this.staff(agencyId, ['owner', 'admin'])) throw new HttpError(403, 'Operazione non consentita.');
    const trip = this.db.published.get(tripId);
    if (!trip || trip.agencyOwned || !trip.coordinatorId || !this.hasCoordinator(agencyId, trip.coordinatorId)) throw new HttpError(404, 'Viaggio non trovato.');
    if (trip.agencyId && trip.agencyId !== agencyId) throw new HttpError(422, 'Questo viaggio è già coperto da un’altra agenzia.');
    if ((trip.organizer === 'agency') === on) return;
    const paid = this.db.payments.some((payment) => payment.status === 'confirmed' && this.db.participations.get(payment.requestId)?.tripId === tripId);
    if (paid) throw new HttpError(422, 'Il viaggio ha già pagamenti confermati: la copertura non si cambia.');
    Object.assign(trip, { agencyId: on ? agencyId : undefined, organizer: on ? 'agency' : 'coordinator' });
    this.audit(on ? 'agency.umbrella_on' : 'agency.umbrella_off', tripId, { agency: agencyId, coordinator: trip.coordinatorId });
  }

  /** Stessi dati di `agency_dashboard_data()` (migrazione 0022). */
  async dashboardData(agencyId: string, since: string): Promise<AgencyDashboardData> {
    if (!this.staff(agencyId, ['owner', 'admin'])) throw new HttpError(403, 'I dati dell’agenzia li vedono proprietario e amministratori.');
    const sinceMs = Date.parse(since);
    const trips = [...this.db.published.values()].filter((trip) => trip.agencyId === agencyId);
    const ids = new Set(trips.map((trip) => trip.id));
    const requests = [...this.db.participations.values()];
    const confirmed = this.db.payments.flatMap((payment) => {
      const request = this.db.participations.get(payment.requestId) as (typeof requests)[number] & { channel?: 'odys' | 'direct' } | undefined;
      if (!request || !ids.has(request.tripId) || payment.status !== 'confirmed' || !payment.confirmedAt || Date.parse(payment.confirmedAt) < sinceMs) return [];
      return [{ payment, request }];
    });
    return {
      trips: trips.map((trip) => ({
        id: trip.id, title: trip.title, coordinatorId: trip.coordinatorId || null, status: trip.status, startDate: trip.startDate, endDate: trip.endDate, capacity: trip.capacity,
        sold: requests.filter((request) => request.tripId === trip.id && ['confirmed', 'balance_paid'].includes(request.status)).length,
      })),
      payments: confirmed.map(({ payment, request }) => ({ tripId: request.tripId, amountCents: payment.amountCents, at: payment.confirmedAt! })),
      bookings: confirmed.filter(({ payment }) => payment.kind === 'deposit').map(({ payment, request }) => ({ tripId: request.tripId, channel: request.channel ?? 'odys', at: payment.confirmedAt! })),
      coordinators: [...this.db.agencyMembers.values()]
        .filter((member) => member.agencyId === agencyId && member.status === 'active' && member.role === 'coordinator')
        .map((member) => { const profile = this.db.user(member.userId).profile; return { userId: member.userId, name: `${profile.firstName} ${profile.lastName.slice(0, 1)}.`, licensed: member.licensed }; }),
    };
  }

  async setUmbrellaDefault(memberId: string, on: boolean): Promise<void> {
    const member = this.db.agencyMembers.get(memberId);
    if (!member || !this.staff(member.agencyId, ['owner', 'admin'])) throw new HttpError(403, 'Operazione non consentita.');
    if (member.role !== 'coordinator' || member.status !== 'active') throw new HttpError(422, 'L’ombrello predefinito vale per i coordinatori del team.');
    member.umbrellaDefault = on;
    this.audit('agency.umbrella_default', memberId, { agency: member.agencyId, on });
  }
}

export function memoryAgency(db: MemoryDatabase, card: (db: MemoryDatabase, id: string) => CoordinatorCard, tripView: TripView): AgencyStore {
  return {
    agency: (user) => new MemoryAgencyRepository(db, user.id, tripView),
    async agencyBySlug(slug: string) {
      const agency = [...db.agencies.values()].find((item) => item.slug === slug);
      if (!agency) return null;
      const coordinators = [...db.agencyMembers.values()]
        .filter((member) => member.agencyId === agency.id && member.status === 'active' && member.role === 'coordinator')
        .filter((member) => ['coordinator', 'admin'].includes(db.user(member.userId).profile.role))
        .map((member) => card(db, member.userId));
      const { ownerId: _owner, legalName: _legal, licenseSeats: _seats, billingCycle: _cycle, createdAt: _created, saleTerms: _terms, ...rest } = agency;
      return { ...structuredClone(rest), coordinators };
    },
  };
}
