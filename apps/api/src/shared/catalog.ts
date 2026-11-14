import { affinity, searchKey, sharesInterest, type Affinity, type CostItem, type Itinerary } from '@odys/domain';
import type { AuthUser } from './auth';
import type { StoredTrip } from './data';

/*
 * Contratti di catalogo (viaggi pubblicati dai coordinatori) e area coordinatore.
 * Requisiti: U-01…U-09, U-17, U-21, C-04, C-06…C-14, P-06, §11.2.
 */

export type PublishedTripStatus = 'draft' | 'scheduled' | 'published' | 'active' | 'completed' | 'cancelled' | 'archived';

/** Versione delle linee guida del coordinatore da accettare (C-04). */
export const COORDINATOR_GUIDELINES_VERSION = 'linee-guida-2026-10';

export interface CoordinatorCard {
  id: string;
  /** Nome e iniziale del cognome, es. "Giulia B." */
  displayName: string;
  headline?: string;
  bio?: string;
  interests: string[];
  avatarUrl?: string;
  memberSince?: string;
  /** Valutazione media e numero di recensioni (TB-12, CB-09). */
  rating?: number;
  reviewsCount?: number;
  followers?: number;
  /** Viaggi pubblicati e conclusi. */
  tripsCompleted?: number;
  /** Lingue dichiarate nella candidatura approvata (CB-09). */
  languages?: string[];
  /** Candidatura approvata dall'amministratore: badge «verificato» (CB-09). */
  verified?: boolean;
}

/** Recensione pubblica sul profilo del coordinatore (TB-12). */
export interface PublicReview {
  id: string;
  tripId: string;
  tripTitle: string;
  tripDestination: string;
  tripEnd?: string;
  authorName: string;
  authorInitials: string;
  coordinatorRating: number;
  tripRating: number;
  body: string;
  createdAt: string;
}

export interface PublishedTripSummary {
  id: string;
  status: PublishedTripStatus;
  /** Stato reale considerando le date: un viaggio pubblicato in corso è "active". */
  effectiveStatus: PublishedTripStatus;
  title: string;
  summary: string;
  destination: string;
  startDate?: string;
  endDate?: string;
  durationDays?: number;
  priceCents?: number;
  currency: string;
  capacity?: number;
  coverImageUrl?: string;
  publishedAt?: string;
  scheduledFor?: string;
  updatedAt: string;
  coordinator: CoordinatorCard;
  /** Paese e regione della meta: servono alla ricerca per intento (TB-02). */
  country: string;
  region: string;
  /** Interessi del viaggio, usati da filtri e affinità (CB-02, TB-03, TB-04). */
  interests: string[];
  /** Acconto per bloccare il posto e scadenza del saldo (CB-04, TB-09). */
  depositCents?: number;
  balanceDueDate?: string;
  visibility: TripVisibility;
  ageMin?: number;
  ageMax?: number;
  /** Posti liberi (capienza meno posti occupati), aggiunto dalle rotte pubbliche. */
  seatsLeft?: number;
  /** Affinità con gli interessi di chi guarda; assente senza accesso o senza interessi. */
  affinity?: Affinity;
}

export type TripVisibility = 'public' | 'followers' | 'invite';

/** Storia di un luogo del viaggio (TP-08): solo testo, scritta dal coordinatore. */
export interface PlaceStory {
  id: string;
  /** Giorno dell'itinerario a cui appartiene. */
  day: number;
  title: string;
  /** Frase d'apertura. */
  intro: string;
  /** Testo storico. */
  body: string;
  /** «La storia in 3 tappe»: date chiave. */
  milestones: Array<{ when: string; text: string }>;
  source: 'coordinator' | 'generated';
}

export interface PublishedTrip extends PublishedTripSummary {
  /** Storie dei luoghi: complete per chi ha il diritto `trips.insights`, altrimenti assenti. */
  placeStories?: PlaceStory[];
  /** Quante storie ha il viaggio (sempre presente nel dettaglio pubblico). */
  placeStoriesCount?: number;
  included: string[];
  excluded: string[];
  itinerary: Itinerary;
  sourceTripId?: string;
  /** Richieste ricevute, solo nell'area del coordinatore (C-15). */
  requests?: { pending: number; confirmed: number };
}

export interface CatalogFilters {
  q?: string;
  destination?: string;
  coordinatorId?: string;
  maxPriceCents?: number;
  sort?: 'upcoming' | 'price' | 'recent' | 'affinity';
  includeCompleted?: boolean;
  /** Almeno uno di questi interessi (TB-03). */
  interests?: string[];
  /** Mese di partenza, 1–12. */
  month?: number;
  minDays?: number;
  maxDays?: number;
  /** Solo partenze con posti liberi. */
  onlyAvailable?: boolean;
}

/** Lettura pubblica del catalogo (anche senza accesso, U-01). */
export interface CatalogRepository {
  list(filters: CatalogFilters): Promise<PublishedTripSummary[]>;
  get(id: string): Promise<PublishedTrip | null>;
  getMany(ids: string[]): Promise<PublishedTripSummary[]>;
  /** Posti occupati dei viaggi indicati (quelli senza richieste non compaiono). */
  seatsTaken(ids: string[]): Promise<Map<string, number>>;
  /** Iniziali di chi ha già un posto, per gli avatar del dettaglio (TB-06). */
  participantInitials(id: string): Promise<string[]>;
  /** Registra la visualizzazione del dettaglio (CP-05); non deve mai bloccare la pagina. */
  recordView(id: string): Promise<void>;
  coordinator(id: string): Promise<CoordinatorCard | null>;
  /** Recensioni pubbliche di un coordinatore, dalla più recente. */
  reviews(coordinatorId: string): Promise<PublicReview[]>;
}

export interface PublishedTripInput {
  title: string;
  summary: string;
  destination: string;
  startDate?: string;
  endDate?: string;
  priceCents?: number;
  capacity?: number;
  included: string[];
  excluded: string[];
  coverImageUrl?: string;
  itinerary: Itinerary;
  sourceTripId?: string;
  country?: string;
  region?: string;
  interests?: string[];
  depositCents?: number;
  /** Stringa vuota per toglierla. */
  balanceDueDate?: string;
  visibility?: TripVisibility;
  ageMin?: number | null;
  ageMax?: number | null;
  placeStories?: PlaceStory[];
}

/** Composizione del prezzo (CB-04): dati riservati al coordinatore del viaggio. */
export interface TripPricing {
  costs: CostItem[];
  targetEarningsCents: number | null;
  updatedAt?: string;
}

/** Operazioni del coordinatore sui propri viaggi pubblicati (C-09…C-14). */
export interface CoordinatorRepository {
  isCoordinator(): Promise<boolean>;
  hasAcceptedGuidelines(): Promise<boolean>;
  acceptGuidelines(): Promise<void>;
  list(): Promise<PublishedTrip[]>;
  get(id: string): Promise<PublishedTrip | null>;
  create(input: PublishedTripInput): Promise<PublishedTrip>;
  update(id: string, patch: Partial<PublishedTripInput>): Promise<PublishedTrip | null>;
  setStatus(id: string, status: PublishedTripStatus, scheduledFor?: string): Promise<PublishedTrip | null>;
  /** Voci di costo del viaggio; vuote se non ancora indicate. null se il viaggio non è del coordinatore. */
  pricing(id: string): Promise<TripPricing | null>;
  savePricing(id: string, pricing: TripPricing): Promise<TripPricing | null>;
}

/** Salvataggi e copie dei viaggi pubblicati per l'utente (U-08, U-21). */
export interface SavedTripsRepository {
  listIds(): Promise<string[]>;
  save(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  copy(id: string): Promise<StoredTrip>;
}

/** Avviso operativo nell'elenco «I miei viaggi» (CB-07). */
export interface CoordinatorAlert {
  kind: 'missing_fields' | 'balance_due' | 'requests_pending';
  tone: 'warning' | 'danger' | 'info';
  message: string;
}

/**
 * Avvisi per un viaggio del coordinatore (CB-07): campi che mancano prima di
 * pubblicare, saldi in sospeso (in rosso dopo la scadenza), richieste da confermare.
 */
export function coordinatorAlerts(
  trip: Pick<PublishedTrip, 'status' | 'effectiveStatus' | 'summary' | 'startDate' | 'endDate' | 'priceCents' | 'capacity' | 'interests' | 'country' | 'balanceDueDate'>,
  counts: { pending: number; balanceDue: number },
  today = new Date().toISOString().slice(0, 10),
): CoordinatorAlert[] {
  const alerts: CoordinatorAlert[] = [];
  if (trip.status === 'draft' || trip.status === 'scheduled') {
    const missing = [
      (trip.summary ?? '').trim().length < 20 && 'descrizione',
      (!trip.startDate || !trip.endDate) && 'date',
      trip.priceCents === undefined && 'quota',
      trip.capacity === undefined && 'posti',
      !trip.country?.trim() && 'paese',
      !trip.interests?.length && 'interessi',
    ].filter((item): item is string => Boolean(item));
    if (missing.length) alerts.push({ kind: 'missing_fields', tone: 'warning', message: `Da completare: ${missing.join(', ')}` });
  }
  if (counts.balanceDue > 0 && ['published', 'active'].includes(trip.effectiveStatus)) {
    const overdue = Boolean(trip.balanceDueDate && trip.balanceDueDate < today);
    const who = counts.balanceDue === 1 ? '1 saldo' : `${counts.balanceDue} saldi`;
    alerts.push({ kind: 'balance_due', tone: overdue ? 'danger' : 'warning', message: overdue ? `${who} scadut${counts.balanceDue === 1 ? 'o' : 'i'}` : `${who} in sospeso${trip.balanceDueDate ? ` · entro il ${trip.balanceDueDate.split('-').reverse().join('/')}` : ''}` });
  }
  if (counts.pending > 0) alerts.push({ kind: 'requests_pending', tone: 'info', message: counts.pending === 1 ? '1 richiesta da confermare' : `${counts.pending} richieste da confermare` });
  return alerts;
}

/** Un viaggio accetta richieste finché è pubblicato e non è ancora partito (§11.2). */
export function acceptsRequests(trip: Pick<PublishedTripSummary, 'effectiveStatus'>): boolean {
  return trip.effectiveStatus === 'published';
}

/** Stato effettivo di un viaggio pubblicato in base alle date (§11.2: attivo, concluso). */
export function effectiveStatus(status: PublishedTripStatus, startDate?: string, endDate?: string, scheduledFor?: string, today = new Date()): PublishedTripStatus {
  const day = today.toISOString().slice(0, 10);
  if (status === 'scheduled' && scheduledFor && Date.parse(scheduledFor) <= today.getTime()) status = 'published';
  if (status !== 'published') return status;
  if (endDate && endDate < day) return 'completed';
  if (startDate && startDate <= day) return 'active';
  return 'published';
}

export function displayName(firstName?: string, lastInitial?: string): string {
  const name = (firstName ?? '').trim();
  const initial = (lastInitial ?? '').trim().slice(0, 1).toUpperCase();
  return [name, initial ? `${initial}.` : ''].filter(Boolean).join(' ') || 'Coordinatore Odys';
}

/** Fabbrica del catalogo: con l'utente valgono anche i viaggi «Solo follower» di chi segue. */
export type CatalogFactory = (user?: AuthUser) => CatalogRepository;

function haystack(trip: PublishedTripSummary): string {
  return searchKey(`${trip.title} ${trip.destination} ${trip.region} ${trip.country} ${trip.summary}`);
}

/** Vero se il viaggio risponde alla ricerca libera (titolo, meta, regione, paese, descrizione). */
export function matchesQuery(trip: PublishedTripSummary, q: string | undefined): boolean {
  const term = q ? searchKey(q) : '';
  return !term || haystack(trip).includes(term);
}

/**
 * Filtri, affinità e ordinamento del catalogo (TB-03, TB-04), uguali per ogni archivio.
 * Ordinamento predefinito: affinità (se chi guarda ha interessi), poi data di partenza.
 */
export function refineCatalog(trips: PublishedTripSummary[], filters: CatalogFilters, seatsTaken: Map<string, number>, userInterests: readonly string[]): PublishedTripSummary[] {
  const enriched = trips
    .map((trip): PublishedTripSummary => ({
      ...trip,
      seatsLeft: trip.capacity === undefined ? undefined : Math.max(0, trip.capacity - (seatsTaken.get(trip.id) ?? 0)),
      affinity: affinity(userInterests, trip.interests) ?? undefined,
    }))
    .filter((trip) => matchesQuery(trip, filters.q))
    .filter((trip) => !filters.interests?.length || sharesInterest(filters.interests, trip.interests))
    .filter((trip) => !filters.month || (trip.startDate ? Number(trip.startDate.slice(5, 7)) === filters.month : false))
    .filter((trip) => filters.minDays === undefined || (trip.durationDays ?? 0) >= filters.minDays)
    .filter((trip) => filters.maxDays === undefined || (trip.durationDays !== undefined && trip.durationDays <= filters.maxDays))
    .filter((trip) => !filters.onlyAvailable || (acceptsRequests(trip) && trip.seatsLeft !== 0));
  const byDate = (a: PublishedTripSummary, b: PublishedTripSummary) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999');
  const sort = filters.sort ?? 'affinity';
  if (sort === 'price') return enriched.sort((a, b) => (a.priceCents ?? Infinity) - (b.priceCents ?? Infinity));
  if (sort === 'recent') return enriched.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  if (sort === 'upcoming') return enriched.sort(byDate);
  return enriched.sort((a, b) => (b.affinity?.percent ?? -1) - (a.affinity?.percent ?? -1) || byDate(a, b));
}

export interface PlaceSuggestion {
  kind: 'country' | 'region' | 'city';
  label: string;
  /** Per regioni e città: il paese, come contesto. */
  context?: string;
  trips: number;
}

/** Suggerimenti di paese, regione e città con il numero di viaggi (TB-02). */
export function suggestPlaces(trips: PublishedTripSummary[], q: string, limit = 8): PlaceSuggestion[] {
  const term = searchKey(q);
  if (term.length < 2) return [];
  const found = new Map<string, PlaceSuggestion>();
  const add = (kind: PlaceSuggestion['kind'], label: string, context?: string) => {
    if (!label || !searchKey(label).includes(term)) return;
    const id = `${kind}:${searchKey(label)}`;
    const current = found.get(id) ?? { kind, label, context, trips: 0 };
    current.trips += 1;
    found.set(id, current);
  };
  for (const trip of trips) {
    add('country', trip.country);
    add('region', trip.region, trip.country || undefined);
    add('city', trip.destination, trip.country || undefined);
  }
  const rank = { country: 0, region: 1, city: 2 } as const;
  return [...found.values()].sort((a, b) => rank[a.kind] - rank[b.kind] || b.trips - a.trips || a.label.localeCompare(b.label, 'it')).slice(0, limit);
}

/** «Chi cerca X guarda anche»: altri paesi con viaggi che condividono gli interessi dei risultati (TB-02). */
export function similarDestinations(trips: PublishedTripSummary[], q: string, limit = 4): Array<{ label: string; trips: number }> {
  const matches = trips.filter((trip) => matchesQuery(trip, q));
  if (!q.trim() || !matches.length) return [];
  const interests = [...new Set(matches.flatMap((trip) => trip.interests))];
  const excluded = new Set(matches.map((trip) => searchKey(trip.country)));
  const counts = new Map<string, number>();
  for (const trip of trips) {
    if (!trip.country || excluded.has(searchKey(trip.country)) || !sharesInterest(interests, trip.interests)) continue;
    counts.set(trip.country, (counts.get(trip.country) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, trips: count })).sort((a, b) => b.trips - a.trips || a.label.localeCompare(b.label, 'it')).slice(0, limit);
}
