import { randomUUID } from 'node:crypto';
import { describeEntitlements, migrateItinerary, type AnalyticsEventKind, type SplitExpense, type SubscriptionPlan } from '@odys/domain';
import type { NewSplitExpense, SplitRepository } from '../../shared/split';
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
import { MemoryCreatorData, memoryCreator } from './memory-creator';
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
  type TripPricing,
  type CoordinatorAnalytics,
  POST_ATTRIBUTION_DAYS,
} from '../../shared/catalog';
import { holdsSeat, SEAT_RESERVATION_MINUTES } from '../../shared/community';
import type {
  Review,
  ReviewInput,
  SocialRepository,
  Payment,
  PaymentKind,
  PaymentMethod,
  AccountSummary,
  ContentReport,
  ReportAction,
  ReportInput,
  ReportReview,
  ReportsRepository,
  ReportStatus,
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
  /** Piani attivi (abbonamenti, licenze o assegnati dall'amministratore). */
  plans: SubscriptionPlan[];
}

interface MemoryPublished extends PublishedTrip {
  coordinatorId: string;
}

interface MemoryParticipation extends ParticipationRequest {
  userId: string;
  termsAcceptedAt?: string;
}

interface MemoryApplication extends CoordinatorApplication {
  userId: string;
  adminNote?: string;
}

export class MemoryDatabase {
  readonly trips = new Map<string, MemoryTrip>();
  readonly published = new Map<string, MemoryPublished>();
  readonly pricing = new Map<string, TripPricing>();
  readonly participations = new Map<string, MemoryParticipation>();
  readonly applications: MemoryApplication[] = [];
  readonly creator = new MemoryCreatorData();
  readonly reports: Array<ReportReview & { reporterId: string }> = [];
  readonly users = new Map<string, MemoryUser>();
  /** follower → coordinatori seguiti. */
  readonly follows = new Map<string, Set<string>>();
  readonly payments: Payment[] = [];
  readonly reviews: Array<Review & { authorId: string }> = [];
  readonly splitExpenses: Array<SplitExpense & { tripId: string; createdBy: string; deleted: boolean }> = [];
  /** Eventi dei viaggi (CP-05). */
  readonly events: Array<{ tripId: string; kind: AnalyticsEventKind; userId?: string; createdAt: string }> = [];
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
      plans: [],
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

/** Stessa regola della funzione SQL `published_trip_visible_to_me` (CB-05). */
function visibleTo(db: MemoryDatabase, trip: MemoryPublished, userId?: string): boolean {
  if (!isPublic(trip)) return false;
  if (trip.visibility === 'public' || trip.coordinatorId === userId) return true;
  return trip.visibility === 'followers' && !!userId && !!db.follows.get(userId)?.has(trip.coordinatorId);
}

/** Posti occupati: stessa regola di `published_trips_seats_taken`. */
function seatsTaken(db: MemoryDatabase, tripId: string, exceptId?: string): number {
  return [...db.participations.values()].filter((item) => item.tripId === tripId && item.id !== exceptId && holdsSeat(item)).length;
}

function card(db: MemoryDatabase, id: string) {
  const profile = db.users.get(id)?.profile;
  const trips = [...db.published.values()].filter((trip) => trip.coordinatorId === id);
  const reviews = db.reviews.filter((review) => trips.some((trip) => trip.id === review.tripId));
  const today = new Date().toISOString().slice(0, 10);
  return {
    id, displayName: displayName(profile?.firstName, profile?.lastName?.[0]), headline: profile?.publicHeadline, bio: profile?.bio, interests: profile?.interests ?? [],
    rating: reviews.length ? Math.round((reviews.reduce((sum, review) => sum + review.coordinatorRating, 0) / reviews.length) * 10) / 10 : undefined,
    reviewsCount: reviews.length,
    followers: [...db.follows.values()].filter((set) => set.has(id)).length,
    tripsCompleted: trips.filter((trip) => isPublic(trip) && !!trip.endDate && trip.endDate < today).length,
    // Come la vista SQL: lingue e badge dalla candidatura approvata più recente.
    languages: [...db.applications].reverse().find((item) => item.userId === id && item.status === 'approved')?.languages ?? [],
    verified: db.applications.some((item) => item.userId === id && item.status === 'approved'),
  };
}

function publicView(db: MemoryDatabase, trip: MemoryPublished): PublishedTrip {
  const { coordinatorId: _id, ...rest } = structuredClone(trip);
  // Come il trigger SQL: la durata deriva dalle date.
  const durationDays = rest.startDate && rest.endDate ? Math.round((Date.parse(rest.endDate) - Date.parse(rest.startDate)) / 86_400_000) + 1 : rest.durationDays;
  return { ...rest, durationDays, effectiveStatus: effectiveStatus(rest.status, rest.startDate, rest.endDate, rest.scheduledFor), coordinator: card(db, trip.coordinatorId) };
}

class MemoryCatalogRepository implements CatalogRepository {
  constructor(private readonly db: MemoryDatabase, private readonly userId?: string) {}
  private visible(trip: MemoryPublished | undefined): trip is MemoryPublished { return !!trip && visibleTo(this.db, trip, this.userId); }
  async list(filters: CatalogFilters) {
    return [...this.db.published.values()].filter((trip) => this.visible(trip))
      .filter((trip) => !filters.destination || trip.destination.toLowerCase().includes(filters.destination.toLowerCase()))
      .filter((trip) => !filters.coordinatorId || trip.coordinatorId === filters.coordinatorId)
      .filter((trip) => filters.maxPriceCents === undefined || (trip.priceCents ?? 0) <= filters.maxPriceCents)
      .map((trip) => publicView(this.db, trip))
      .filter((trip) => filters.includeCompleted || trip.effectiveStatus !== 'completed');
  }
  async get(id: string) {
    const trip = this.db.published.get(id);
    return this.visible(trip) ? publicView(this.db, trip) : null;
  }
  async getMany(ids: string[]) {
    return ids.map((id) => this.db.published.get(id)).filter((trip): trip is MemoryPublished => this.visible(trip)).map((trip) => publicView(this.db, trip));
  }
  async seatsTaken(ids: string[]) {
    return new Map(ids.map((id) => [id, seatsTaken(this.db, id)] as const).filter(([, taken]) => taken > 0));
  }
  async participantInitials(id: string) {
    const trip = this.db.published.get(id);
    if (!this.visible(trip)) return [];
    return [...this.db.participations.values()].filter((item) => item.tripId === id && ['pending', 'confirmed', 'balance_paid'].includes(item.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((item) => { const profile = this.db.user(item.userId).profile; return `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.toUpperCase(); });
  }
  async recordView(id: string) {
    const trip = this.db.published.get(id);
    if (!this.visible(trip) || trip.coordinatorId === this.userId) return;
    const today = new Date().toISOString().slice(0, 10);
    if (this.userId && this.db.events.some((event) => event.tripId === id && event.kind === 'view' && event.userId === this.userId && event.createdAt.startsWith(today))) return;
    this.db.events.push({ tripId: id, kind: 'view', userId: this.userId, createdAt: new Date().toISOString() });
  }
  async reviews(coordinatorId: string) {
    return this.db.reviews
      .map((review) => ({ review, trip: this.db.published.get(review.tripId) }))
      .filter((item) => item.trip?.coordinatorId === coordinatorId)
      .sort((a, b) => b.review.createdAt.localeCompare(a.review.createdAt))
      .map(({ review, trip }) => {
        const author = this.db.user(review.authorId).profile;
        return {
          id: review.id, tripId: trip!.id, tripTitle: trip!.title, tripDestination: trip!.destination, tripEnd: trip!.endDate,
          authorName: `${author.firstName} ${author.lastName[0] ?? ''}.`, authorInitials: `${author.firstName[0] ?? ''}${author.lastName[0] ?? ''}`.toUpperCase(),
          coordinatorRating: review.coordinatorRating, tripRating: review.tripRating, body: review.body, createdAt: review.createdAt,
        };
      });
  }
  async coordinator(id: string) {
    const profile = this.db.users.get(id)?.profile;
    return profile && (profile.role === 'coordinator' || profile.role === 'admin') ? card(this.db, id) : null;
  }
}

/** Campi svuotabili: stringa vuota o null tolgono il valore, come fa l'archivio reale. */
function normalizeInput(input: Partial<PublishedTripInput>): Partial<MemoryPublished> {
  const { balanceDueDate, ageMin, ageMax, ...rest } = structuredClone(input);
  const out: Partial<MemoryPublished> = rest;
  if (balanceDueDate !== undefined) out.balanceDueDate = balanceDueDate || undefined;
  if (ageMin !== undefined) out.ageMin = ageMin ?? undefined;
  if (ageMax !== undefined) out.ageMax = ageMax ?? undefined;
  for (const field of Object.keys(out) as Array<keyof MemoryPublished>) {
    if (out[field] === undefined && !['balanceDueDate', 'ageMin', 'ageMax'].includes(field)) delete out[field];
  }
  return out;
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
    if ((input.capacity ?? 0) > 12) throw new HttpError(422, 'Ogni viaggio ha al massimo 12 partecipanti.');
    const trip: MemoryPublished = { country: '', region: '', interests: [], visibility: 'public', ...normalizeInput(input), id: randomUUID(), coordinatorId: this.userId, status: 'draft', effectiveStatus: 'draft', currency: 'EUR', updatedAt: now, coordinator: card(this.db, this.userId) } as MemoryPublished;
    this.db.published.set(trip.id, trip);
    return publicView(this.db, trip);
  }
  async update(id: string, patch: Partial<PublishedTripInput>) {
    const trip = this.owned(id);
    if (!trip) return null;
    const next = { ...trip, ...normalizeInput(patch) };
    if ((next.capacity ?? 0) > 12) throw new HttpError(422, 'Ogni viaggio ha al massimo 12 partecipanti.');
    if (next.depositCents !== undefined && next.priceCents !== undefined && next.depositCents > next.priceCents) throw new HttpError(422, 'L’acconto non può superare la quota di partecipazione.');
    if (next.balanceDueDate && next.startDate && next.balanceDueDate > next.startDate) throw new HttpError(422, 'Il saldo va pagato entro la data di partenza.');
    Object.assign(trip, next, { updatedAt: new Date().toISOString() });
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
      // Valori provvisori, come nel trigger SQL: un quarto della quota, saldo 30 giorni prima.
      trip.depositCents ??= Math.min(trip.priceCents, Math.max(5000, Math.round(trip.priceCents * 0.25 / 1000) * 1000));
      const today = new Date().toISOString().slice(0, 10);
      const thirtyBefore = new Date(Date.parse(trip.startDate) - 30 * 86_400_000).toISOString().slice(0, 10);
      trip.balanceDueDate ??= thirtyBefore > today ? thirtyBefore : today;
    }
    Object.assign(trip, { status, scheduledFor: status === 'scheduled' ? scheduledFor : undefined, publishedAt: status === 'published' ? trip.publishedAt ?? new Date().toISOString() : trip.publishedAt });
    return publicView(this.db, trip);
  }
  async pricing(id: string) {
    if (!this.owned(id)) return null;
    const saved = this.db.pricing.get(id);
    return saved ? structuredClone(saved) : { costs: [], targetEarningsCents: null };
  }
  /** Stessi dati e stessa attribuzione di `coordinator_analytics()` (migrazione 0019). */
  async analytics(since: string): Promise<CoordinatorAnalytics> {
    const sinceMs = Date.parse(since);
    const mine = new Set([...this.db.published.values()].filter((trip) => trip.coordinatorId === this.userId).map((trip) => trip.id));
    const events = this.db.events
      .filter((event) => mine.has(event.tripId) && Date.parse(event.createdAt) >= sinceMs)
      .map((event) => ({ tripId: event.tripId, kind: event.kind, at: event.createdAt }));
    const payments = this.db.payments.flatMap((payment) => {
      const request = this.db.participations.get(payment.requestId);
      if (!request || !mine.has(request.tripId) || payment.status !== 'confirmed' || !payment.confirmedAt || Date.parse(payment.confirmedAt) < sinceMs) return [];
      return [{ tripId: request.tripId, kind: payment.kind, amountCents: payment.amountCents, currency: payment.currency, at: payment.confirmedAt }];
    });
    const creator = this.db.creator;
    const posts = [...creator.posts.values()].filter((post) => post.authorId === this.userId && !post.deleted && post.status === 'published');
    const window = POST_ATTRIBUTION_DAYS * 86_400_000;
    const attributed = new Map<string, number>();
    for (const booking of this.db.events.filter((event) => event.kind === 'booking_confirmed' && mine.has(event.tripId) && event.userId && Date.parse(event.createdAt) >= sinceMs)) {
      const at = Date.parse(booking.createdAt);
      const touch = creator.views
        .filter((view) => view.userId === booking.userId && Date.parse(view.at) <= at && Date.parse(view.at) >= at - window)
        .filter((view) => posts.some((post) => post.id === view.postId && post.publishedTripId === booking.tripId))
        .sort((a, b) => b.at.localeCompare(a.at))[0];
      if (touch) attributed.set(touch.postId, (attributed.get(touch.postId) ?? 0) + 1);
    }
    return {
      events,
      payments,
      posts: posts.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')).map((post) => ({
        postId: post.id, caption: post.caption.slice(0, 120), tripId: post.publishedTripId, publishedAt: post.publishedAt,
        views: creator.views.filter((view) => view.postId === post.id && Date.parse(view.at) >= sinceMs).length,
        saves: [...creator.saveTimes.entries()].filter(([key, at]) => key.endsWith(`|${post.id}`) && creator.saves.has(key) && Date.parse(at) >= sinceMs).length,
        bookings: attributed.get(post.id) ?? 0,
      })),
    };
  }

  async remindBalance(requestId: string) {
    const request = this.db.participations.get(requestId);
    if (!request || !this.owned(request.tripId)) throw new HttpError(404, 'Richiesta non trovata.');
    if (request.status !== 'confirmed') throw new HttpError(422, 'Si sollecita solo chi è confermato e non ha ancora pagato il saldo.');
    if (request.balanceRemindedAt && Date.parse(request.balanceRemindedAt) > Date.now() - 86_400_000) throw new HttpError(422, 'Hai già inviato un sollecito nelle ultime 24 ore.');
    request.balanceRemindedAt = new Date().toISOString();
    this.db.user(this.userId).audit.unshift({ action: 'participation.remind_balance', entity: 'participation_request', entityId: requestId, metadata: { trip: request.tripId }, createdAt: request.balanceRemindedAt });
    return request.balanceRemindedAt;
  }

  async savePricing(id: string, pricing: TripPricing) {
    if (!this.owned(id)) return null;
    const saved = { costs: structuredClone(pricing.costs), targetEarningsCents: pricing.targetEarningsCents, updatedAt: new Date().toISOString() };
    this.db.pricing.set(id, saved);
    return structuredClone(saved);
  }
}

class MemorySavedTripsRepository implements SavedTripsRepository {
  constructor(private readonly db: MemoryDatabase, private readonly userId: string) {}
  async listIds() { return [...this.db.user(this.userId).savedTrips]; }
  async save(id: string) {
    const trip = this.db.published.get(id);
    if (!trip || !visibleTo(this.db, trip, this.userId)) throw new HttpError(404, 'Elemento non trovato.');
    if (!this.db.user(this.userId).savedTrips.has(id)) this.db.events.push({ tripId: id, kind: 'save', userId: this.userId, createdAt: new Date().toISOString() });
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
  const { userId: _user, termsAcceptedAt: _terms, ...rest } = item;
  return { ...rest };
}

/** Stesse regole del trigger SQL `participation_requests_guard` e delle funzioni dei pagamenti. */
class MemoryParticipationRepository implements ParticipationRepository {
  constructor(private readonly db: MemoryDatabase, private readonly userId: string) {}

  private own(tripId: string) {
    return [...this.db.participations.values()].find((item) => item.tripId === tripId && item.userId === this.userId);
  }
  private mineById(id: string) {
    const item = this.db.participations.get(id);
    return item && item.userId === this.userId ? item : undefined;
  }

  async mine() {
    return [...this.db.participations.values()].filter((item) => item.userId === this.userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicRequest);
  }

  async get(id: string) {
    const item = this.mineById(id);
    return item ? publicRequest(item) : null;
  }

  async reserve(tripId: string) {
    const existing = this.own(tripId);
    if (existing && holdsSeat(existing)) return publicRequest(existing);
    if (existing?.status === 'declined') throw new HttpError(403, 'Operazione non consentita.');
    const trip = this.db.published.get(tripId);
    if (!trip || !visibleTo(this.db, trip, this.userId)) throw new HttpError(404, 'Elemento non trovato.');
    if (trip.coordinatorId === this.userId) throw new HttpError(422, 'Non puoi prenotare un viaggio che coordini.');
    const me = this.db.user(this.userId);
    if (me.profile.status !== 'active' || !describeEntitlements(me.profile.role, me.plans).entitlements.includes('trips.book')) throw new HttpError(403, 'Operazione non consentita.');
    if (effectiveStatus(trip.status, trip.startDate, trip.endDate, trip.scheduledFor) !== 'published') throw new HttpError(422, 'Le iscrizioni a questo viaggio sono chiuse.');
    const taken = seatsTaken(this.db, tripId, existing?.id);
    if (trip.capacity !== undefined && taken >= trip.capacity) throw new HttpError(422, 'I posti di questo viaggio sono esauriti.');
    if (trip.priceCents === undefined || trip.depositCents === undefined) throw new HttpError(422, 'Questo viaggio non è ancora prenotabile: manca la quota.');
    const reservation = {
      status: 'reserved' as const,
      reservedUntil: new Date(Date.now() + SEAT_RESERVATION_MINUTES * 60_000).toISOString(),
      seatNumber: taken + 1,
      priceCents: trip.priceCents,
      depositCents: trip.depositCents,
      currency: trip.currency,
      balanceDueDate: trip.balanceDueDate,
      decidedAt: undefined,
      termsAcceptedAt: undefined,
    };
    if (existing) {
      Object.assign(existing, reservation);
      return publicRequest(existing);
    }
    const created: MemoryParticipation = { id: randomUUID(), tripId, userId: this.userId, createdAt: new Date().toISOString(), ...reservation };
    this.db.participations.set(created.id, created);
    return publicRequest(created);
  }

  async withdraw(tripId: string) {
    const existing = this.own(tripId);
    if (!existing) return null;
    if (existing.status === 'balance_paid') throw new HttpError(403, 'Operazione non consentita.');
    if (['reserved', 'pending', 'confirmed'].includes(existing.status)) Object.assign(existing, { status: 'withdrawn', decidedAt: undefined, reservedUntil: undefined });
    return publicRequest(existing);
  }

  async startPayment(requestId: string, kind: PaymentKind, method: PaymentMethod, acceptTerms: boolean) {
    const request = this.mineById(requestId);
    if (!request) throw new HttpError(404, 'Elemento non trovato.');
    let amountCents: number | undefined;
    if (kind === 'deposit') {
      if (request.status !== 'reserved' || !holdsSeat(request)) throw new HttpError(422, 'Il tempo per bloccare il posto è scaduto: riprova dalla pagina del viaggio.');
      if (!acceptTerms) throw new HttpError(422, 'Per pagare l’acconto accetta le condizioni di partecipazione e la politica di cancellazione.');
      amountCents = request.depositCents;
      request.termsAcceptedAt = new Date().toISOString();
    } else {
      if (request.status !== 'confirmed') throw new HttpError(422, 'Il saldo si paga dopo la conferma del coordinatore.');
      amountCents = request.priceCents !== undefined && request.depositCents !== undefined ? request.priceCents - request.depositCents : undefined;
    }
    if (amountCents === undefined) throw new HttpError(422, 'Importo non disponibile per questa prenotazione.');
    const running = this.db.payments.find((payment) => payment.requestId === requestId && payment.kind === kind && payment.status !== 'failed');
    if (running) return { ...running };
    const payment: Payment = { id: randomUUID(), requestId, kind, amountCents, currency: request.currency, status: 'processing', provider: 'simulated', method, createdAt: new Date().toISOString() };
    this.db.payments.push(payment);
    return { ...payment };
  }

  async confirmSimulatedPayment(paymentId: string) {
    const payment = this.db.payments.find((item) => item.id === paymentId);
    const request = payment ? this.mineById(payment.requestId) : undefined;
    if (!payment || !request) throw new HttpError(404, 'Elemento non trovato.');
    if (payment.status === 'confirmed') return { ...payment };
    if (payment.status !== 'processing') throw new HttpError(422, 'Questo pagamento non è più in corso.');
    const now = new Date().toISOString();
    if (payment.kind === 'deposit') {
      if (request.status !== 'reserved') throw new HttpError(403, 'Operazione non consentita.');
      Object.assign(request, { status: 'pending', reservedUntil: undefined });
      this.db.events.push({ tripId: request.tripId, kind: 'request', userId: request.userId, createdAt: now });
    } else {
      if (request.status !== 'confirmed') throw new HttpError(403, 'Operazione non consentita.');
      request.status = 'balance_paid';
    }
    Object.assign(payment, { status: 'confirmed', confirmedAt: now });
    this.db.events.push({ tripId: request.tripId, kind: 'payment_confirmed', userId: request.userId, createdAt: now });
    this.db.user(this.userId).audit.unshift({ action: `payment.${payment.kind}`, entity: 'payment', entityId: payment.id, metadata: { amountCents: payment.amountCents, trip: request.tripId }, createdAt: now });
    return { ...payment };
  }

  async payments(requestId: string) {
    if (!this.mineById(requestId)) return [];
    return this.db.payments.filter((payment) => payment.requestId === requestId).map((payment) => ({ ...payment })).reverse();
  }

  private coordinated(tripId: string): MemoryPublished {
    const trip = this.db.published.get(tripId);
    if (!trip || trip.coordinatorId !== this.userId) throw new HttpError(403, 'Operazione non consentita.');
    return trip;
  }

  async participants(tripId: string): Promise<Participant[]> {
    const trip = this.coordinated(tripId);
    // Le riserve senza acconto non sono richieste: il coordinatore non le vede.
    return [...this.db.participations.values()].filter((item) => item.tripId === tripId && item.status !== 'reserved').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((item) => {
      const profile = this.db.user(item.userId).profile;
      const mine = new Set(profile.interests.map((interest) => interest.toLowerCase()));
      return {
        ...publicRequest(item), userId: item.userId, firstName: profile.firstName, lastName: profile.lastName,
        email: item.status === 'confirmed' || item.status === 'balance_paid' ? profile.email : undefined,
        sharedInterests: trip.interests.filter((interest) => mine.has(interest.toLowerCase())).length,
      };
    });
  }

  async decide(tripId: string, requestId: string, status: 'confirmed' | 'declined') {
    const trip = this.coordinated(tripId);
    const item = this.db.participations.get(requestId);
    if (!item || item.tripId !== tripId) return null;
    if (!['pending', 'confirmed', 'declined'].includes(item.status)) throw new HttpError(403, 'Operazione non consentita.');
    if (status === 'confirmed' && trip.capacity !== undefined && seatsTaken(this.db, tripId, item.id) >= trip.capacity) throw new HttpError(422, 'I posti di questo viaggio sono esauriti.');
    // Come il trigger SQL `participation_confirmed_event` (CP-01, CP-05).
    if (status === 'confirmed' && item.status !== 'confirmed') this.db.events.push({ tripId, kind: 'booking_confirmed', userId: item.userId, createdAt: new Date().toISOString() });
    Object.assign(item, { status, decidedAt: new Date().toISOString() });
    return publicRequest(item);
  }

  async counts(tripIds: string[]) {
    const counts = new Map<string, ParticipationCounts>();
    for (const item of this.db.participations.values()) {
      if (!tripIds.includes(item.tripId) || !['pending', 'confirmed', 'balance_paid'].includes(item.status)) continue;
      const current = counts.get(item.tripId) ?? { pending: 0, confirmed: 0, balanceDue: 0 };
      current[item.status === 'pending' ? 'pending' : 'confirmed'] += 1;
      if (item.status === 'confirmed') current.balanceDue += 1;
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

  private ownerOf(report: ReportInput): string | undefined {
    if (report.targetKind === 'post') return this.db.creator.posts.get(report.targetId)?.authorId;
    if (report.targetKind === 'published_trip') return this.db.published.get(report.targetId)?.coordinatorId;
    return report.targetId;
  }

  async listReports(status?: ReportStatus) {
    await this.guard();
    return this.db.reports.filter((report) => !status || report.status === status).map(({ reporterId: _r, ...report }) => ({
      ...report,
      reportsOnTarget: this.db.reports.filter((other) => other.targetKind === report.targetKind && other.targetId === report.targetId).length,
    }));
  }

  async resolveReport(id: string, action: ReportAction, note?: string) {
    await this.guard();
    const report = this.db.reports.find((item) => item.id === id);
    if (!report) return null;
    if (report.status !== 'open') throw new HttpError(422, 'Questa segnalazione è già stata valutata.');
    if (action === 'hidden') {
      if (report.targetKind === 'post') { const post = this.db.creator.posts.get(report.targetId); if (post) post.status = 'archived'; }
      else if (report.targetKind === 'published_trip') { const trip = this.db.published.get(report.targetId); if (trip) trip.status = 'archived'; }
      else throw new HttpError(422, 'Per un profilo usa la sospensione dell’account.');
    }
    if (action === 'suspended') {
      const owner = this.ownerOf(report);
      if (owner === this.userId) throw new HttpError(422, 'Non puoi sospendere il tuo account.');
      if (owner && this.db.users.has(owner)) this.db.user(owner).profile.status = 'suspended';
    }
    const now = new Date().toISOString();
    for (const item of this.db.reports) {
      if (item.targetKind === report.targetKind && item.targetId === report.targetId && item.status === 'open') {
        Object.assign(item, { status: action === 'dismiss' ? 'dismissed' : 'resolved', actionTaken: action === 'dismiss' ? 'none' : action, resolutionNote: note, decidedAt: now });
      }
    }
    this.db.user(this.userId).audit.unshift({ action: `report.${action}`, entity: report.targetKind, entityId: report.targetId, createdAt: now });
    return (await this.listReports()).find((item) => item.id === id) ?? null;
  }

  async listAccounts(query?: string) {
    await this.guard();
    const q = query?.trim().toLowerCase();
    return [...this.db.users.values()].map(({ profile, plans }): AccountSummary => ({ id: profile.id, email: profile.email, firstName: profile.firstName, lastName: profile.lastName, role: profile.role, status: profile.status, createdAt: profile.createdAt, plan: describeEntitlements(profile.role, plans).plan }))
      .filter((account) => !q || `${account.email} ${account.firstName} ${account.lastName}`.toLowerCase().includes(q));
  }

  async updateAccount(id: string, changes: { role?: AccountSummary['role']; status?: AccountSummary['status'] }) {
    await this.guard();
    if (id === this.userId) throw new HttpError(422, 'Non puoi modificare ruolo o stato del tuo account.');
    const user = this.db.users.get(id);
    if (!user) return null;
    Object.assign(user.profile, Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)));
    this.db.user(this.userId).audit.unshift({ action: 'account.update', entity: 'profile', entityId: id, metadata: changes, createdAt: new Date().toISOString() });
    return (await this.listAccounts()).find((account) => account.id === id) ?? null;
  }

  async setPlan(id: string, plan: SubscriptionPlan | null, note?: string) {
    await this.guard();
    const user = this.db.users.get(id);
    if (!user) return null;
    const from = describeEntitlements(user.profile.role, user.plans).plan;
    user.plans = plan ? [plan] : [];
    const to = describeEntitlements(user.profile.role, user.plans).plan;
    this.db.user(this.userId).audit.unshift({ action: 'account.plan', entity: 'profile', entityId: id, metadata: { from, to, note }, createdAt: new Date().toISOString() });
    return (await this.listAccounts()).find((account) => account.id === id) ?? null;
  }
}

/** Stesse regole delle funzioni SQL dello Split (0014). */
class MemorySplitRepository implements SplitRepository {
  constructor(private readonly db: MemoryDatabase, private readonly userId: string) {}
  private memberIds(tripId: string): string[] {
    const trip = this.db.published.get(tripId);
    if (!trip) return [];
    const ids = [...this.db.participations.values()].filter((item) => item.tripId === tripId && (item.status === 'confirmed' || item.status === 'balance_paid')).map((item) => item.userId);
    return [...new Set([trip.coordinatorId, ...ids])];
  }
  private guard(tripId: string): string[] {
    const ids = this.memberIds(tripId);
    if (!ids.includes(this.userId)) throw new HttpError(403, 'Non fai parte del gruppo di questo viaggio.');
    return ids;
  }
  async groups() {
    return [...this.db.published.values()].filter((trip) => this.memberIds(trip.id).includes(this.userId))
      .map((trip) => ({ tripId: trip.id, title: trip.title, destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate }))
      .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
  }
  async members(tripId: string) {
    const trip = this.db.published.get(tripId);
    return this.guard(tripId).map((id) => {
      const profile = this.db.user(id).profile;
      return { userId: id, displayName: `${profile.firstName} ${profile.lastName[0] ?? ''}.`, initials: `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.toUpperCase(), isCoordinator: id === trip?.coordinatorId };
    });
  }
  async expenses(tripId: string) {
    this.guard(tripId);
    return this.db.splitExpenses.filter((item) => item.tripId === tripId && !item.deleted).map(({ tripId: _t, createdBy: _c, deleted: _d, ...expense }) => structuredClone(expense)).reverse();
  }
  async add(tripId: string, input: NewSplitExpense) {
    const ids = this.guard(tripId);
    const me = this.db.user(this.userId);
    if (!describeEntitlements(me.profile.role, me.plans).entitlements.includes('split.use')) throw new HttpError(403, 'Lo Split è incluso in Traveller Premium.');
    if (!ids.includes(input.paidBy)) throw new HttpError(422, 'Chi ha pagato deve far parte del gruppo.');
    if (input.shares.reduce((sum, share) => sum + share.amountCents, 0) !== input.amountCents) throw new HttpError(422, 'Le quote non corrispondono all’importo.');
    if (input.shares.some((share) => !ids.includes(share.userId))) throw new HttpError(422, 'Si divide solo con chi fa parte del gruppo.');
    const expense = { ...structuredClone(input), id: randomUUID(), tripId, createdBy: this.userId, deleted: false, createdAt: new Date().toISOString() };
    this.db.splitExpenses.push(expense);
    const { tripId: _t, createdBy: _c, deleted: _d, ...out } = expense;
    return out;
  }
  async remove(expenseId: string) {
    const expense = this.db.splitExpenses.find((item) => item.id === expenseId && !item.deleted);
    if (!expense || expense.createdBy !== this.userId) throw new HttpError(403, 'Puoi eliminare solo le spese che hai inserito tu.');
    expense.deleted = true;
  }
}

/** Stesse regole del trigger SQL `trip_reviews_guard` e delle policy dei follower. */
class MemorySocialRepository implements SocialRepository {
  constructor(private readonly db: MemoryDatabase, private readonly userId: string) {}
  async isFollowing(coordinatorId: string) { return !!this.db.follows.get(this.userId)?.has(coordinatorId); }
  async follow(coordinatorId: string) {
    const profile = this.db.users.get(coordinatorId)?.profile;
    if (!profile || !['coordinator', 'admin'].includes(profile.role) || profile.status !== 'active') throw new HttpError(404, 'Elemento non trovato.');
    if (coordinatorId === this.userId) throw new HttpError(422, 'Non puoi seguire te stesso.');
    const set = this.db.follows.get(this.userId) ?? new Set<string>();
    set.add(coordinatorId);
    this.db.follows.set(this.userId, set);
  }
  async unfollow(coordinatorId: string) { this.db.follows.get(this.userId)?.delete(coordinatorId); }
  async myReview(tripId: string) {
    const found = this.db.reviews.find((review) => review.tripId === tripId && review.authorId === this.userId);
    if (!found) return null;
    const { authorId: _author, ...review } = found;
    return { ...review };
  }
  async saveReview(tripId: string, input: ReviewInput) {
    const took = [...this.db.participations.values()].some((item) => item.tripId === tripId && item.userId === this.userId && (item.status === 'confirmed' || item.status === 'balance_paid'));
    if (!took) throw new HttpError(403, 'Può recensire il viaggio solo chi vi ha partecipato.');
    const trip = this.db.published.get(tripId);
    if (!trip?.endDate || trip.endDate >= new Date().toISOString().slice(0, 10)) throw new HttpError(422, 'Potrai lasciare la recensione al rientro dal viaggio.');
    const existing = this.db.reviews.find((review) => review.tripId === tripId && review.authorId === this.userId);
    if (existing) Object.assign(existing, input);
    else this.db.reviews.push({ ...input, id: randomUUID(), tripId, authorId: this.userId, createdAt: new Date().toISOString() });
    return (await this.myReview(tripId))!;
  }
}

/** Stesse regole del trigger SQL `content_reports_guard`. */
class MemoryReportsRepository implements ReportsRepository {
  constructor(private readonly db: MemoryDatabase, private readonly userId: string) {}

  async create(input: ReportInput): Promise<ContentReport> {
    const post = input.targetKind === 'post' ? this.db.creator.posts.get(input.targetId) : undefined;
    const trip = input.targetKind === 'published_trip' ? this.db.published.get(input.targetId) : undefined;
    const profile = input.targetKind === 'profile' ? this.db.users.get(input.targetId)?.profile : undefined;
    const visible = (post && !post.deleted && (post.status === 'published' || (post.status === 'scheduled' && post.scheduledFor && Date.parse(post.scheduledFor) <= Date.now())))
      || (trip && isPublic(trip))
      || (profile && (profile.role === 'coordinator' || profile.role === 'admin'));
    if (!visible) throw new HttpError(404, 'Elemento non trovato.');
    if (input.targetKind === 'profile' && input.targetId === this.userId) throw new HttpError(422, 'Non puoi segnalare il tuo profilo.');
    if (this.db.reports.some((item) => item.reporterId === this.userId && item.targetKind === input.targetKind && item.targetId === input.targetId && item.status === 'open')) {
      throw new HttpError(409, 'Hai già segnalato questo contenuto: lo stiamo valutando.');
    }
    const report = { ...input, id: randomUUID(), reporterId: this.userId, status: 'open' as const, createdAt: new Date().toISOString(), reporterEmail: this.db.user(this.userId).profile.email, reportsOnTarget: 1 };
    this.db.reports.push(report);
    const { reporterId: _r, reporterEmail: _e, reportsOnTarget: _n, ...visibleReport } = report;
    return visibleReport;
  }
}

export function memoryDataStore(db: MemoryDatabase): DataStore {
  return {
    trips: (user) => new MemoryTripsRepository(db, user.id),
    account: (user) => new MemoryAccountRepository(db, user.id),
    catalog: (user) => new MemoryCatalogRepository(db, user?.id),
    coordinator: (user) => new MemoryCoordinatorRepository(db, user.id),
    saved: (user) => new MemorySavedTripsRepository(db, user.id),
    async entitlements(user) {
      const data = db.user(user.id);
      if (data.profile.status !== 'active') return { ...describeEntitlements('traveler', []), entitlements: [] };
      return describeEntitlements(data.profile.role, data.plans);
    },
    participation: (user) => new MemoryParticipationRepository(db, user.id),
    applications: (user) => new MemoryApplicationsRepository(db, user.id),
    admin: (user) => new MemoryAdminRepository(db, user.id),
    reports: (user) => new MemoryReportsRepository(db, user.id),
    social: (user) => new MemorySocialRepository(db, user.id),
    split: (user) => new MemorySplitRepository(db, user.id),
    ...memoryCreator(db, db.creator),
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
