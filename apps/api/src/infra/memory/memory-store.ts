import { randomUUID } from 'node:crypto';
import { migrateItinerary } from '@odys/domain';
import type { AuthProvider } from '../../shared/auth';
import type {
  AccountRepository,
  AuditEntry,
  DataStore,
  Preferences,
  Profile,
  SaveTripInput,
  StoredTrip,
  TripsRepository,
  TripVersion,
} from '../../shared/data';
import { HttpError } from '../../shared/http';
import {
  COORDINATOR_GUIDELINES_VERSION,
  displayName,
  effectiveStatus,
  type CatalogFilters,
  type CatalogRepository,
  type CoordinatorRepository,
  type PublishedTrip,
  type PublishedTripInput,
  type PublishedTripStatus,
  type SavedTripsRepository,
} from '../../shared/catalog';
import type {
  AdminRepository,
  ApplicationReview,
  ApplicationsRepository,
  ApplicationStatus,
  CoordinatorApplication,
  CoordinatorApplicationInput,
  Participant,
  ParticipationCounts,
  ParticipationRepository,
  ParticipationRequest,
} from '../../shared/community';

/*
 * Archivio in memoria con lo stesso comportamento di Supabase (storico,
 * eliminazione morbida, isolamento per utente). Usato dai test dell'API.
 */

interface MemoryTrip extends StoredTrip {
  ownerId: string;
  legacyId?: string;
  deleted: boolean;
  versions: TripVersion[];
}

interface MemoryUser {
  profile: Profile;
  preferences: Preferences;
  ideas: Set<string>;
  savedTrips: Set<string>;
  consents: Set<string>;
  audit: AuditEntry[];
}

interface MemoryPublished extends PublishedTrip {
  coordinatorId: string;
}

interface MemoryParticipation extends ParticipationRequest {
  userId: string;
}

interface MemoryApplication extends CoordinatorApplication {
  userId: string;
  adminNote?: string;
}

export class MemoryDatabase {
  readonly trips = new Map<string, MemoryTrip>();
  readonly published = new Map<string, MemoryPublished>();
  readonly participations = new Map<string, MemoryParticipation>();
  readonly applications: MemoryApplication[] = [];
  readonly users = new Map<string, MemoryUser>();
  /** token → utente, per simulare l'autenticazione nei test. */
  readonly tokens = new Map<string, { id: string; email: string }>();

  addUser(token: string, id = randomUUID(), email = `${id}@example.com`): string {
    this.tokens.set(token, { id, email });
    this.users.set(id, {
      profile: { id, email, firstName: 'Utente', lastName: 'Test', interests: [], role: 'traveler', status: 'active', createdAt: new Date().toISOString() },
      preferences: { theme: 'light' },
      ideas: new Set(),
      savedTrips: new Set(),
      consents: new Set(),
      audit: [],
    });
    return id;
  }

  user(id: string): MemoryUser {
    const user = this.users.get(id);
    if (!user) throw new HttpError(401, 'Accedi per continuare.');
    return user;
  }
}

function publicTrip(trip: MemoryTrip): StoredTrip {
  const { ownerId: _owner, legacyId: _legacy, deleted: _deleted, versions: _versions, ...rest } = trip;
  return structuredClone(rest);
}

class MemoryTripsRepository implements TripsRepository {
  constructor(private readonly db: MemoryDatabase, private readonly userId: string) {}

  private owned(id: string): MemoryTrip | undefined {
    const trip = this.db.trips.get(id);
    return trip && trip.ownerId === this.userId ? trip : undefined;
  }

  async list() {
    return [...this.db.trips.values()]
      .filter((trip) => trip.ownerId === this.userId && !trip.deleted)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .map(publicTrip);
  }

  async get(id: string) {
    const trip = this.owned(id);
    return trip && !trip.deleted ? publicTrip(trip) : null;
  }

  async findByLegacyId(legacyId: string) {
    const trip = [...this.db.trips.values()].find((item) => item.ownerId === this.userId && item.legacyId === legacyId);
    return trip ? publicTrip(trip) : null;
  }

  async save(input: SaveTripInput) {
    const now = new Date().toISOString();
    const itinerary = migrateItinerary(input.itinerary);
    let trip = input.tripId ? this.owned(input.tripId) : undefined;
    if (input.tripId && !trip) throw new HttpError(404, 'Elemento non trovato.');
    if (!trip) {
      trip = { id: randomUUID(), ownerId: this.userId, title: input.title?.trim() || itinerary.destination || 'Viaggio', itinerary, createdAt: now, updatedAt: now, planVersion: 5, currentVersion: 1, legacyId: input.legacyId, deleted: false, versions: [] };
      this.db.trips.set(trip.id, trip);
    } else {
      const record = input.recordVersion ?? true;
      Object.assign(trip, { title: input.title?.trim() || trip.title, itinerary, updatedAt: now, deleted: false, currentVersion: record ? trip.currentVersion + 1 : trip.currentVersion });
      if (!record) return publicTrip(trip);
    }
    trip.versions.unshift({ version: trip.currentVersion, changeKind: input.changeKind, summary: input.summary, createdAt: now, itinerary: structuredClone(itinerary) });
    return publicTrip(trip);
  }

  async rename(id: string, title: string) {
    const trip = this.owned(id);
    if (!trip || trip.deleted) return null;
    trip.title = title;
    trip.updatedAt = new Date().toISOString();
    return publicTrip(trip);
  }

  async softDelete(id: string) {
    const trip = this.owned(id);
    if (!trip || trip.deleted) return false;
    trip.deleted = true;
    return true;
  }

  async listVersions(id: string) {
    return (this.owned(id)?.versions ?? []).map(({ itinerary: _itinerary, ...summary }) => summary);
  }

  async getVersion(id: string, version: number) {
    const found = this.owned(id)?.versions.find((item) => item.version === version);
    return found ? structuredClone(found) : null;
  }
}

class MemoryAccountRepository implements AccountRepository {
  constructor(private readonly db: MemoryDatabase, private readonly userId: string) {}
  private get data() { return this.db.user(this.userId); }

  async getProfile() { return structuredClone(this.data.profile); }
  async updateProfile(patch: Partial<Profile>) {
    Object.assign(this.data.profile, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)));
    return structuredClone(this.data.profile);
  }
  async getPreferences() { return { ...this.data.preferences }; }
  async updatePreferences(patch: Partial<Preferences>) {
    Object.assign(this.data.preferences, patch);
    return { ...this.data.preferences };
  }
  async listSavedIdeas() { return [...this.data.ideas]; }
  async saveIdea(id: string) { this.data.ideas.add(id); }
  async removeIdea(id: string) { this.data.ideas.delete(id); }
  async record(entry: AuditEntry) { this.data.audit.unshift({ ...entry, createdAt: new Date().toISOString() }); }
  async listActivity(limit = 50) { return this.data.audit.slice(0, limit); }
}

function isPublic(trip: MemoryPublished): boolean {
  return ['published', 'active', 'completed'].includes(trip.status)
    || (trip.status === 'scheduled' && !!trip.scheduledFor && Date.parse(trip.scheduledFor) <= Date.now());
}

function card(db: MemoryDatabase, id: string) {
  const profile = db.users.get(id)?.profile;
  return { id, displayName: displayName(profile?.firstName, profile?.lastName?.[0]), headline: profile?.publicHeadline, bio: profile?.bio, interests: profile?.interests ?? [] };
}

function publicView(db: MemoryDatabase, trip: MemoryPublished): PublishedTrip {
  const { coordinatorId: _id, ...rest } = structuredClone(trip);
  return { ...rest, effectiveStatus: effectiveStatus(rest.status, rest.startDate, rest.endDate, rest.scheduledFor), coordinator: card(db, trip.coordinatorId) };
}

class MemoryCatalogRepository implements CatalogRepository {
  constructor(private readonly db: MemoryDatabase) {}
  async list(filters: CatalogFilters) {
    const q = filters.q?.toLowerCase();
    return [...this.db.published.values()].filter(isPublic)
      .filter((trip) => !q || `${trip.title} ${trip.destination} ${trip.summary}`.toLowerCase().includes(q))
      .filter((trip) => !filters.destination || trip.destination.toLowerCase().includes(filters.destination.toLowerCase()))
      .filter((trip) => !filters.coordinatorId || trip.coordinatorId === filters.coordinatorId)
      .filter((trip) => filters.maxPriceCents === undefined || (trip.priceCents ?? 0) <= filters.maxPriceCents)
      .map((trip) => publicView(this.db, trip))
      .filter((trip) => filters.includeCompleted || trip.effectiveStatus !== 'completed');
  }
  async get(id: string) {
    const trip = this.db.published.get(id);
    return trip && isPublic(trip) ? publicView(this.db, trip) : null;
  }
  async getMany(ids: string[]) {
    return ids.map((id) => this.db.published.get(id)).filter((trip): trip is MemoryPublished => !!trip && isPublic(trip)).map((trip) => publicView(this.db, trip));
  }
  async confirmedCount(id: string) {
    return [...this.db.participations.values()].filter((item) => item.tripId === id && item.status === 'confirmed').length;
  }
  async coordinator(id: string) {
    const profile = this.db.users.get(id)?.profile;
    return profile && (profile.role === 'coordinator' || profile.role === 'admin') ? card(this.db, id) : null;
  }
}

class MemoryCoordinatorRepository implements CoordinatorRepository {
  constructor(private readonly db: MemoryDatabase, private readonly userId: string) {}
  private owned(id: string) {
    const trip = this.db.published.get(id);
    return trip && trip.coordinatorId === this.userId ? trip : undefined;
  }
  async isCoordinator() { const role = this.db.user(this.userId).profile.role; return role === 'coordinator' || role === 'admin'; }
  async hasAcceptedGuidelines() { return this.db.user(this.userId).consents.has(COORDINATOR_GUIDELINES_VERSION); }
  async acceptGuidelines() { this.db.user(this.userId).consents.add(COORDINATOR_GUIDELINES_VERSION); }
  async list() { return [...this.db.published.values()].filter((trip) => trip.coordinatorId === this.userId).map((trip) => publicView(this.db, trip)); }
  async get(id: string) { const trip = this.owned(id); return trip ? publicView(this.db, trip) : null; }
  async create(input: PublishedTripInput) {
    if (!(await this.isCoordinator())) throw new HttpError(403, 'Operazione non consentita.');
    const now = new Date().toISOString();
    const trip: MemoryPublished = { ...structuredClone(input), id: randomUUID(), coordinatorId: this.userId, status: 'draft', effectiveStatus: 'draft', currency: 'EUR', updatedAt: now, coordinator: card(this.db, this.userId) };
    this.db.published.set(trip.id, trip);
    return publicView(this.db, trip);
  }
  async update(id: string, patch: Partial<PublishedTripInput>) {
    const trip = this.owned(id);
    if (!trip) return null;
    Object.assign(trip, structuredClone(patch), { updatedAt: new Date().toISOString() });
    return publicView(this.db, trip);
  }
  async setStatus(id: string, status: PublishedTripStatus, scheduledFor?: string) {
    const trip = this.owned(id);
    if (!trip) return null;
    if (status === 'published' || status === 'scheduled') {
      // Stesse validazioni della funzione SQL (C-13).
      if ((trip.summary ?? '').trim().length < 20) throw new HttpError(422, 'Aggiungi una descrizione di almeno 20 caratteri prima di pubblicare.');
      if (!trip.startDate || !trip.endDate || trip.endDate < trip.startDate) throw new HttpError(422, 'Indica date di partenza e rientro valide.');
      if (trip.capacity === undefined) throw new HttpError(422, 'Indica il numero di posti disponibili.');
      if (trip.priceCents === undefined) throw new HttpError(422, 'Indica la quota di partecipazione.');
    }
    Object.assign(trip, { status, scheduledFor: status === 'scheduled' ? scheduledFor : undefined, publishedAt: status === 'published' ? trip.publishedAt ?? new Date().toISOString() : trip.publishedAt });
    return publicView(this.db, trip);
  }
}

class MemorySavedTripsRepository implements SavedTripsRepository {
  constructor(private readonly db: MemoryDatabase, private readonly userId: string) {}
  async listIds() { return [...this.db.user(this.userId).savedTrips]; }
  async save(id: string) {
    const trip = this.db.published.get(id);
    if (!trip || !isPublic(trip)) throw new HttpError(404, 'Elemento non trovato.');
    this.db.user(this.userId).savedTrips.add(id);
  }
  async remove(id: string) { this.db.user(this.userId).savedTrips.delete(id); }
  async copy(id: string) {
    const trip = this.db.published.get(id);
    if (!trip || !isPublic(trip)) throw new HttpError(404, 'Elemento non trovato.');
    return new MemoryTripsRepository(this.db, this.userId).save({ itinerary: trip.itinerary, title: trip.title, changeKind: 'copied', summary: 'Creato a partire da un viaggio pubblicato' });
  }
}

function publicRequest(item: MemoryParticipation): ParticipationRequest {
  const { userId: _user, ...rest } = item;
  return { ...rest };
}

/** Stesse regole del trigger SQL `participation_requests_guard`. */
class MemoryParticipationRepository implements ParticipationRepository {
  constructor(private readonly db: MemoryDatabase, private readonly userId: string) {}

  private own(tripId: string) {
    return [...this.db.participations.values()].find((item) => item.tripId === tripId && item.userId === this.userId);
  }
  private confirmed(tripId: string, exceptId?: string) {
    return [...this.db.participations.values()].filter((item) => item.tripId === tripId && item.status === 'confirmed' && item.id !== exceptId).length;
  }
  private openTrip(tripId: string): MemoryPublished {
    const trip = this.db.published.get(tripId);
    if (!trip || !isPublic(trip)) throw new HttpError(404, 'Elemento non trovato.');
    if (effectiveStatus(trip.status, trip.startDate, trip.endDate, trip.scheduledFor) !== 'published') throw new HttpError(422, 'Le iscrizioni a questo viaggio sono chiuse.');
    return trip;
  }

  async mine() {
    return [...this.db.participations.values()].filter((item) => item.userId === this.userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicRequest);
  }

  async request(tripId: string, message?: string) {
    const existing = this.own(tripId);
    if (existing && existing.status !== 'withdrawn') return publicRequest(existing);
    const trip = this.openTrip(tripId);
    if (trip.coordinatorId === this.userId) throw new HttpError(422, 'Non puoi chiedere di partecipare a un viaggio che coordini.');
    if (existing) {
      Object.assign(existing, { status: 'pending', message, decidedAt: undefined });
      return publicRequest(existing);
    }
    if (trip.capacity !== undefined && this.confirmed(tripId) >= trip.capacity) throw new HttpError(422, 'I posti di questo viaggio sono esauriti.');
    const created: MemoryParticipation = { id: randomUUID(), tripId, userId: this.userId, status: 'pending', message, createdAt: new Date().toISOString() };
    this.db.participations.set(created.id, created);
    return publicRequest(created);
  }

  async withdraw(tripId: string) {
    const existing = this.own(tripId);
    if (!existing) return null;
    if (existing.status === 'pending' || existing.status === 'confirmed') Object.assign(existing, { status: 'withdrawn', decidedAt: undefined });
    return publicRequest(existing);
  }

  private coordinated(tripId: string): MemoryPublished {
    const trip = this.db.published.get(tripId);
    if (!trip || trip.coordinatorId !== this.userId) throw new HttpError(403, 'Operazione non consentita.');
    return trip;
  }

  async participants(tripId: string): Promise<Participant[]> {
    this.coordinated(tripId);
    return [...this.db.participations.values()].filter((item) => item.tripId === tripId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((item) => {
      const profile = this.db.user(item.userId).profile;
      return { ...publicRequest(item), userId: item.userId, firstName: profile.firstName, lastName: profile.lastName, email: item.status === 'confirmed' ? profile.email : undefined };
    });
  }

  async decide(tripId: string, requestId: string, status: 'confirmed' | 'declined') {
    const trip = this.coordinated(tripId);
    const item = this.db.participations.get(requestId);
    if (!item || item.tripId !== tripId) return null;
    if (item.status === 'withdrawn') throw new HttpError(403, 'Operazione non consentita.');
    if (status === 'confirmed' && trip.capacity !== undefined && this.confirmed(tripId, item.id) >= trip.capacity) throw new HttpError(422, 'I posti di questo viaggio sono esauriti.');
    Object.assign(item, { status, decidedAt: new Date().toISOString() });
    return publicRequest(item);
  }

  async counts(tripIds: string[]) {
    const counts = new Map<string, ParticipationCounts>();
    for (const item of this.db.participations.values()) {
      if (!tripIds.includes(item.tripId) || (item.status !== 'pending' && item.status !== 'confirmed')) continue;
      const current = counts.get(item.tripId) ?? { pending: 0, confirmed: 0 };
      current[item.status] += 1;
      counts.set(item.tripId, current);
    }
    return counts;
  }
}

function publicApplication(item: MemoryApplication): CoordinatorApplication {
  const { userId: _user, adminNote: _note, ...rest } = item;
  return structuredClone(rest);
}

function review(db: MemoryDatabase, item: MemoryApplication): ApplicationReview {
  const profile = db.user(item.userId).profile;
  return { ...publicApplication(item), userId: item.userId, adminNote: item.adminNote, firstName: profile.firstName, lastName: profile.lastName, email: profile.email, bio: profile.bio, interests: profile.interests };
}

/** Stesse regole del trigger SQL `coordinator_applications_guard`. */
class MemoryApplicationsRepository implements ApplicationsRepository {
  constructor(private readonly db: MemoryDatabase, private readonly userId: string) {}
  private mine() { return this.db.applications.filter((item) => item.userId === this.userId); }
  async latest() { const last = this.mine().at(-1); return last ? publicApplication(last) : null; }
  async submit(input: CoordinatorApplicationInput) {
    const profile = this.db.user(this.userId).profile;
    if (profile.role !== 'traveler') throw new HttpError(422, 'Il tuo account ha già un ruolo professionale.');
    if (!profile.firstName.trim() || !profile.lastName.trim() || (profile.bio ?? '').trim().length < 40) {
      throw new HttpError(422, 'Completa il profilo prima di candidarti: nome, cognome e una presentazione di almeno 40 caratteri.');
    }
    if (this.mine().some((item) => item.status === 'pending')) throw new HttpError(409, 'Esiste già una richiesta in corso.');
    const created: MemoryApplication = { ...structuredClone(input), id: randomUUID(), userId: this.userId, status: 'pending', createdAt: new Date().toISOString() };
    this.db.applications.push(created);
    return publicApplication(created);
  }
}

class MemoryAdminRepository implements AdminRepository {
  constructor(private readonly db: MemoryDatabase, private readonly userId: string) {}
  async isAdmin() { return this.db.user(this.userId).profile.role === 'admin'; }
  private async guard() { if (!(await this.isAdmin())) throw new HttpError(403, 'Operazione non consentita.'); }
  async listApplications(status?: ApplicationStatus) {
    await this.guard();
    return this.db.applications.filter((item) => !status || item.status === status).map((item) => review(this.db, item)).reverse();
  }
  async decideApplication(id: string, approve: boolean, adminNote?: string, reviewerMessage?: string) {
    await this.guard();
    const item = this.db.applications.find((candidate) => candidate.id === id);
    if (!item) return null;
    if (item.status !== 'pending') throw new HttpError(422, 'Questa candidatura è già stata valutata.');
    Object.assign(item, { status: approve ? 'approved' : 'rejected', adminNote, reviewerMessage, decidedAt: new Date().toISOString() });
    if (approve) this.db.user(item.userId).profile.role = 'coordinator';
    return review(this.db, item);
  }
}

export function memoryDataStore(db: MemoryDatabase): DataStore {
  return {
    trips: (user) => new MemoryTripsRepository(db, user.id),
    account: (user) => new MemoryAccountRepository(db, user.id),
    catalog: () => new MemoryCatalogRepository(db),
    coordinator: (user) => new MemoryCoordinatorRepository(db, user.id),
    saved: (user) => new MemorySavedTripsRepository(db, user.id),
    participation: (user) => new MemoryParticipationRepository(db, user.id),
    applications: (user) => new MemoryApplicationsRepository(db, user.id),
    admin: (user) => new MemoryAdminRepository(db, user.id),
  };
}

export function memoryAuthProvider(db: MemoryDatabase): AuthProvider {
  return {
    configured: true,
    async verify(token) {
      return db.tokens.get(token) ?? null;
    },
    async deleteUser(userId) {
      db.users.delete(userId);
      for (const [token, user] of db.tokens) if (user.id === userId) db.tokens.delete(token);
      for (const [id, trip] of db.trips) if (trip.ownerId === userId) db.trips.delete(id);
    },
  };
}
