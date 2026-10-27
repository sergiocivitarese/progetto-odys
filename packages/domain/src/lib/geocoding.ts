import type { Activity, GeoStatus, Itinerary, LocationNode, PlaceMetadata } from '../types/travel';
import { ensureLocationNode, nodeIdForActivity, nodeIdForLabel } from './routeModel';

export const GEOAPIFY_PROVIDER = 'Geoapify';
export const GEOAPIFY_SOURCE = 'Geoapify · OpenStreetMap';
export const GEO_CACHE_KEY = 'travel_companion_geocoding_v1';
export const MIN_GEOCODING_QUERY_LENGTH = 3;
export const GEOCODING_DEBOUNCE_MS = 450;
export const GEOCODING_MIN_INTERVAL_MS = 500;

export interface GeocodingRequest {
  query: string;
  city?: string;
  country?: string;
  area?: string;
  language?: string;
  type?: LocationNode['type'];
}

export interface GeocodingResult {
  status: GeoStatus | 'AMBIGUOUS' | 'CITY_MISMATCH';
  node?: LocationNode;
  candidates: LocationNode[];
  message?: string;
  queryKey: string;
}

export interface GeoapifyAdapterContract {
  readonly provider: string;
  readonly source: string;
  readonly available?: boolean;
  search(request: GeocodingRequest, signal?: AbortSignal): Promise<LocationNode[]>;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Persistenza della cache geocoding: in memoria di default, su file lato server. */
export interface GeoCacheStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

export const memoryGeoCacheStore = (): GeoCacheStore => {
  let value: string | null = null;
  return { read: async () => value, write: async (next) => { value = next; } };
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function slug(value: string): string {
  return normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'luogo';
}

function queryKey(request: GeocodingRequest): string {
  return [request.query, request.area ?? request.city ?? '', request.language ?? 'it'].map(normalize).join('|');
}

function locationType(request: GeocodingRequest, properties: Record<string, unknown>): LocationNode['type'] {
  if (request.type) return request.type;
  const category = String(properties.category ?? '');
  if (category.includes('airport')) return 'airport';
  if (category.includes('railway') || category.includes('train')) return 'station';
  if (category.includes('port')) return 'port';
  return 'custom';
}

function confidenceFor(properties: Record<string, unknown>): number | undefined {
  const rank = properties.rank;
  const raw = rank && typeof rank === 'object' ? (rank as Record<string, unknown>).confidence : properties.confidence;
  const confidence = Number(raw);
  return Number.isFinite(confidence) ? confidence : undefined;
}

function toNode(request: GeocodingRequest, properties: Record<string, unknown>, coordinates: [number, number], index: number): LocationNode {
  const [longitude, latitude] = coordinates;
  const label = typeof properties.formatted === 'string' ? properties.formatted : request.query.trim();
  const providerPlaceId = typeof properties.place_id === 'string' ? properties.place_id : undefined;
  const confidence = confidenceFor(properties);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
  // Non ereditiamo mai la città attesa: se il provider non la restituisce non
  // possiamo associare automaticamente il risultato a un viaggio cittadino.
  const city = typeof properties.city === 'string' ? properties.city : typeof properties.county === 'string' ? properties.county : undefined;
  return ensureLocationNode({
    id: providerPlaceId ? `${GEOAPIFY_PROVIDER.toLowerCase()}-${slug(providerPlaceId)}` : nodeIdForLabel(`${label}-${index}`, 'geoapify'),
    label,
    type: locationType(request, properties),
    address: typeof properties.address_line1 === 'string' ? properties.address_line1 : label,
    city,
    country: typeof properties.country === 'string' ? properties.country : request.country,
    latitude: hasCoordinates ? latitude : undefined,
    longitude: hasCoordinates ? longitude : undefined,
    providerId: providerPlaceId,
    providerPlaceId,
    confidence,
    timezone: typeof properties.timezone === 'object' && properties.timezone !== null && typeof (properties.timezone as Record<string, unknown>).name === 'string'
      ? (properties.timezone as Record<string, unknown>).name as string
      : undefined,
    source: GEOAPIFY_SOURCE,
    updatedAt: new Date().toISOString(),
    reliabilityStatus: hasCoordinates ? 'VERIFIED' : 'MISSING',
    geoStatus: hasCoordinates ? 'CONFIRMED' : 'MISSING',
  }, label, providerPlaceId ? `${GEOAPIFY_PROVIDER.toLowerCase()}-${slug(providerPlaceId)}` : nodeIdForLabel(`${label}-${index}`, 'geoapify'));
}

export class GeoapifyAdapter implements GeoapifyAdapterContract {
  readonly provider = GEOAPIFY_PROVIDER;
  readonly source = GEOAPIFY_SOURCE;
  readonly available: boolean;
  private readonly fetcher: FetchLike;
  private readonly apiKey: string;

  constructor(fetcher: FetchLike = fetch, apiKey = '') {
    this.fetcher = fetcher;
    this.apiKey = apiKey;
    this.available = Boolean(apiKey);
  }

  async search(request: GeocodingRequest, signal?: AbortSignal): Promise<LocationNode[]> {
    if (!this.apiKey) return [];
    const params = new URLSearchParams({
      text: request.query.trim(),
      lang: request.language ?? 'it',
      limit: '5',
      apiKey: this.apiKey,
    });
    if (request.area) params.set('bias', `countrycode:${request.area}`);
    const response = await this.fetcher(`https://api.geoapify.com/v1/geocode/search?${params.toString()}`, { signal });
    if (!response.ok) throw Object.assign(new Error(`Geoapify returned ${response.status}`), { status: response.status });
    const payload = await response.json() as { features?: Array<{ properties?: Record<string, unknown>; geometry?: { coordinates?: [number, number] } }> };
    return (payload.features ?? []).map((feature, index) => {
      const properties = feature.properties ?? {};
      return toNode(request, properties, feature.geometry?.coordinates ?? [NaN, NaN], index);
    });
  }
}

const localFallbacks: Array<{ aliases: string[]; node: LocationNode }> = [
  { aliases: ['lisbona', 'lisbon', 'lisbona portogallo'], node: { id: 'local-destination-lisbona', label: 'Lisbona, Portogallo', type: 'final', city: 'Lisbona', country: 'Portogallo', latitude: 38.7223, longitude: -9.1393, timezone: 'Europe/Lisbon', source: 'Catalogo locale demo Odys', updatedAt: '2026-08-25', reliabilityStatus: 'DEMO', geoStatus: 'DEMO' } },
  { aliases: ['roma', 'rome', 'roma italia'], node: { id: 'local-destination-roma', label: 'Roma, Italia', type: 'final', city: 'Roma', country: 'Italia', latitude: 41.9028, longitude: 12.4964, timezone: 'Europe/Rome', source: 'Catalogo locale demo Odys', updatedAt: '2026-08-25', reliabilityStatus: 'DEMO', geoStatus: 'DEMO' } },
  { aliases: ['istanbul', 'istanbul turchia'], node: { id: 'local-destination-istanbul', label: 'Istanbul, Turchia', type: 'final', city: 'Istanbul', country: 'Turchia', latitude: 41.0082, longitude: 28.9784, timezone: 'Europe/Istanbul', source: 'Catalogo locale demo Odys', updatedAt: '2026-08-25', reliabilityStatus: 'DEMO', geoStatus: 'DEMO' } },
  { aliases: ['kyoto', 'kyoto giappone'], node: { id: 'local-destination-kyoto', label: 'Kyoto, Giappone', type: 'final', city: 'Kyoto', country: 'Giappone', latitude: 35.0116, longitude: 135.7681, timezone: 'Asia/Tokyo', source: 'Catalogo locale demo Odys', updatedAt: '2026-08-25', reliabilityStatus: 'DEMO', geoStatus: 'DEMO' } },
  { aliases: ['cancun', 'cancun messico', 'cancún'], node: { id: 'local-destination-cancun', label: 'Cancún, Messico', type: 'final', city: 'Cancún', country: 'Messico', latitude: 21.1619, longitude: -86.8515, timezone: 'America/Cancun', source: 'Catalogo locale demo Odys', updatedAt: '2026-08-25', reliabilityStatus: 'DEMO', geoStatus: 'DEMO' } },
];

function localFallback(request: GeocodingRequest): LocationNode | undefined {
  const normalizedQuery = normalize(request.query);
  const found = localFallbacks.find((item) => item.aliases.some((alias) => normalize(alias) === normalizedQuery));
  return found ? { ...found.node, type: request.type ?? found.node.type } : undefined;
}

function cityMatches(node: LocationNode, expected?: string): boolean {
  if (!expected) return true;
  if (!node.city) return false;
  const wanted = normalize(expected);
  const actual = normalize(node.city);
  return actual === wanted || actual.includes(wanted) || wanted.includes(actual);
}

function isAmbiguous(nodes: LocationNode[]): boolean {
  if (nodes.length < 2) return false;
  const first = nodes[0].confidence;
  const second = nodes[1].confidence;
  return first === undefined || second === undefined || first < 0.8 || first - second < 0.08;
}

function markForReview(nodes: LocationNode[]): LocationNode[] {
  return nodes.map((node) => ({ ...node, geoStatus: 'TO_VERIFY', reliabilityStatus: 'TO_VERIFY' }));
}

export class GeocodingClient {
  private readonly cache = new Map<string, LocationNode[]>();
  private readonly inFlight = new Map<string, Promise<GeocodingResult>>();
  private activeController: AbortController | null = null;
  private lastRequestAt = 0;
  private hydrated = false;

  constructor(
    private readonly adapter: GeoapifyAdapterContract = new GeoapifyAdapter(),
    private readonly store: GeoCacheStore = memoryGeoCacheStore(),
  ) {}

  /** Fonte dei risultati, per i messaggi del piano. */
  get source(): string {
    return this.adapter.source;
  }

  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const raw = await this.store.read();
      if (!raw) return;
      const stored = JSON.parse(raw) as Record<string, LocationNode[]>;
      Object.entries(stored).forEach(([key, nodes]) => {
        if (Array.isArray(nodes)) this.cache.set(key, nodes);
      });
    } catch {
      // La cache è un acceleratore: un errore non blocca la pianificazione locale.
    }
  }

  private persist(): void {
    void this.store.write(JSON.stringify(Object.fromEntries(this.cache))).catch(() => undefined);
  }

  async geocode(request: GeocodingRequest): Promise<GeocodingResult> {
    const normalized = request.query.trim();
    const key = queryKey(request);
    if (normalized.length < MIN_GEOCODING_QUERY_LENGTH) return { status: 'MISSING', candidates: [], queryKey: key, message: 'Scrivi almeno 3 caratteri per cercare un luogo.' };
    await this.hydrate();
    const local = localFallback(request);
    if (local) return { status: local.geoStatus, node: local, candidates: [local], queryKey: key, message: 'Posizione dal catalogo locale demo: da verificare.' };
    const cached = this.cache.get(key);
    if (cached?.length) {
      const candidates = request.city ? cached.filter((node) => cityMatches(node, request.city)) : cached;
      if (!candidates.length) return { status: 'CITY_MISMATCH', candidates: cached, queryKey: key, message: 'Il risultato in cache appartiene a una città diversa.' };
      return this.resultFromNodes(candidates, key);
    }
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = this.fetchAndClassify(request, key);
    this.inFlight.set(key, promise);
    void promise.finally(() => this.inFlight.delete(key));
    return promise;
  }

  private async fetchAndClassify(request: GeocodingRequest, key: string): Promise<GeocodingResult> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < GEOCODING_MIN_INTERVAL_MS) await new Promise((resolve) => setTimeout(resolve, GEOCODING_MIN_INTERVAL_MS - elapsed));
    this.activeController?.abort();
    this.activeController = new AbortController();
    try {
      if (this.adapter.available === false) return { status: 'MISSING', candidates: [], queryKey: key, message: 'Geocoding online non configurato: il testo resta salvato come Posizione da definire.' };
      this.lastRequestAt = Date.now();
      const nodes = await this.adapter.search(request, this.activeController.signal);
      if (nodes.length) this.cache.set(key, nodes);
      if (nodes.length) this.persist();
      const matching = request.city ? nodes.filter((node) => cityMatches(node, request.city)) : nodes;
      if (!matching.length && nodes.length) return { status: 'CITY_MISMATCH', candidates: nodes, queryKey: key, message: 'Abbiamo trovato un luogo in un’altra città: non lo associamo al viaggio.' };
      if (!matching.length) return { status: 'MISSING', candidates: [], queryKey: key, message: 'Nessun luogo trovato. Conserviamo il testo e mostriamo Posizione da definire.' };
      return this.resultFromNodes(matching, key);
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return { status: 'UNAVAILABLE_OFFLINE', candidates: [], queryKey: key, message: 'Richiesta superata da una ricerca più recente.' };
      if ((error as { status?: number }).status === 429) return { status: 'UNAVAILABLE_OFFLINE', candidates: [], queryKey: key, message: 'Limite del servizio di ricerca raggiunto: riprova tra poco.' };
      return { status: 'UNAVAILABLE_OFFLINE', candidates: [], queryKey: key, message: 'Posizione non disponibile offline: il testo resta conservato.' };
    } finally {
      this.activeController = null;
    }
  }

  private resultFromNodes(nodes: LocationNode[], key: string): GeocodingResult {
    if (isAmbiguous(nodes)) {
      const candidates = markForReview(nodes);
      return { status: 'AMBIGUOUS', candidates, queryKey: key, message: 'Abbiamo trovato più luoghi simili. Conferma quello corretto.' };
    }
    return { status: 'CONFIRMED', node: nodes[0], candidates: nodes, queryKey: key };
  }

  async geocodeMany(requests: GeocodingRequest[]): Promise<GeocodingResult[]> {
    const unique = Array.from(new Map(requests.map((request) => [queryKey(request), request])).values());
    const results: GeocodingResult[] = [];
    for (const request of unique) results.push(await this.geocode(request));
    return results;
  }

  async searchInteractive(query: string, options?: Omit<GeocodingRequest, 'query'>): Promise<GeocodingResult> {
    this.activeController?.abort();
    return this.geocode({ ...options, query });
  }
}

export interface GeoEnrichmentIssue {
  id: string;
  label: string;
  target: GeoTarget;
  candidates: LocationNode[];
  message: string;
}

export type GeoTarget =
  | { kind: 'destination' }
  | { kind: 'activity'; day: number; index: number }
  | { kind: 'lodging' }
  | { kind: 'node'; field: 'departurePoint' | 'arrivalPoint' | 'returnPoint' | 'arrivalDestinationPoint' };

export interface EnrichedItinerary {
  itinerary: Itinerary;
  issues: GeoEnrichmentIssue[];
  changed: boolean;
  messages: string[];
}

function placeFromNode(place: PlaceMetadata, node: LocationNode): PlaceMetadata {
  return {
    ...place,
    title: node.label,
    address: node.address ?? place.address,
    city: node.city ?? place.city,
    country: node.country ?? place.country,
    timezone: node.timezone ?? place.timezone,
    latitude: node.latitude,
    longitude: node.longitude,
    placeId: node.providerPlaceId ?? node.providerId ?? place.placeId,
    providerId: node.providerId,
    providerPlaceId: node.providerPlaceId ?? node.providerId,
    confidence: node.confidence,
    source: node.source ?? place.source,
    updatedAt: node.updatedAt ?? place.updatedAt,
    geoStatus: node.geoStatus,
  };
}

function nodeRequest(node: LocationNode | undefined, fallback: string, type: LocationNode['type']): GeocodingRequest | null {
  const query = node?.label?.trim() || fallback.trim();
  return query ? { query, city: node?.city, country: node?.country, type } : null;
}

function applyUnresolvedStatus(itinerary: Itinerary, target: GeoTarget, status: GeoStatus, source: string): Itinerary {
  const patchNode = (node: LocationNode | undefined, label: string, type: LocationNode['type']): LocationNode => ({
    ...(node ?? ensureLocationNode({ id: nodeIdForLabel(label, 'geo'), label, type, geoStatus: status, reliabilityStatus: status === 'TO_VERIFY' ? 'TO_VERIFY' : 'MISSING' }, label)),
    geoStatus: status,
    reliabilityStatus: status === 'TO_VERIFY' ? 'TO_VERIFY' : 'MISSING',
    source,
  });
  if (target.kind === 'destination') return { ...itinerary, destinationNode: patchNode(itinerary.destinationNode, itinerary.destination, 'final') };
  if (target.kind === 'node') return { ...itinerary, [target.field]: patchNode(itinerary[target.field], itinerary[target.field]?.label ?? 'Punto da definire', itinerary[target.field]?.type ?? 'custom') };
  if (target.kind === 'lodging') return { ...itinerary, lodging: { ...itinerary.lodging, name: itinerary.lodging?.name, geoStatus: status, source } };
  return {
    ...itinerary,
    days: itinerary.days.map((day) => day.day !== target.day ? day : {
      ...day,
      activities: day.activities.map((activity, index) => index !== target.index || !activity.place ? activity : {
        ...activity,
        place: activity.place.geoStatus === 'DEMO' ? activity.place : { ...activity.place, geoStatus: status, source },
      }),
    }),
  };
}

export interface EnrichOptions {
  /**
   * Cerca anche le attività. Con un provider gratuito a basso volume si cercano solo
   * destinazione, alloggio e punti: le attività generate sono segnaposto generici.
   */
  activities?: boolean;
}

export async function enrichItineraryGeography(itinerary: Itinerary, client: GeocodingClient, options: EnrichOptions = {}): Promise<EnrichedItinerary> {
  const requests: Array<{ request: GeocodingRequest; target: GeoTarget }> = [];
  if (!itinerary.destinationNode || itinerary.destinationNode.geoStatus !== 'CONFIRMED') {
    requests.push({ request: { query: itinerary.destination, type: 'final' }, target: { kind: 'destination' } });
  }
  itinerary.days.forEach((day) => day.activities.forEach((activity, index) => {
    const place = activity.place;
    if (options.activities !== false && (!place || place.geoStatus !== 'CONFIRMED')) {
      requests.push({ request: { query: [place?.title ?? activity.title, place?.city ?? itinerary.destination, place?.country].filter(Boolean).join(', '), city: itinerary.destination, type: 'activity' }, target: { kind: 'activity', day: day.day, index } });
    }
  }));
  if (itinerary.lodging?.name && (!itinerary.lodging.latitude || !itinerary.lodging.longitude)) {
    requests.push({ request: { query: [itinerary.lodging.name, itinerary.lodging.address, itinerary.destination].filter(Boolean).join(', '), city: itinerary.destination, type: 'accommodation' }, target: { kind: 'lodging' } });
  }
  (['departurePoint', 'arrivalPoint', 'returnPoint', 'arrivalDestinationPoint'] as const).forEach((field) => {
    const node = itinerary[field];
    if (node && node.geoStatus !== 'CONFIRMED') {
      const request = nodeRequest(node, '', node.type);
      // Partenza e rientro possono essere in un'altra città; gli altri punti
      // sono vincolati alla città della destinazione per evitare associazioni errate.
      const expectedCity = field === 'departurePoint' ? node.city : itinerary.destination;
      if (request) requests.push({ request: { ...request, city: expectedCity }, target: { kind: 'node', field } });
    }
  });
  const results = await client.geocodeMany(requests.map((item) => item.request));
  const byKey = new Map(results.map((result) => [result.queryKey, result]));
  const issues: GeoEnrichmentIssue[] = [];
  const messages: string[] = [];
  let changed = false;
  let next = { ...itinerary };
  requests.forEach(({ request, target }) => {
    const result = byKey.get(queryKey(request));
    if (!result) return;
    if (result.status === 'AMBIGUOUS') {
      next = applyUnresolvedStatus(next, target, 'TO_VERIFY', `${client.source} · risultati da confermare`);
      changed = true;
      issues.push({ id: `${target.kind}-${queryKey(request)}`, label: request.query, target, candidates: result.candidates, message: result.message ?? 'Conferma il luogo corretto.' });
      return;
    }
    if (result.node && (result.status === 'CONFIRMED' || result.status === 'DEMO')) {
      changed = true;
      if (target.kind === 'destination') next = { ...next, destinationNode: result.node };
      if (target.kind === 'lodging') next = { ...next, lodging: { ...next.lodging, name: next.lodging?.name, address: result.node.address ?? next.lodging?.address, city: result.node.city, country: result.node.country, latitude: result.node.latitude, longitude: result.node.longitude, timezone: result.node.timezone, source: result.node.source, geoStatus: result.node.geoStatus, providerId: result.node.providerId, providerPlaceId: result.node.providerPlaceId, confidence: result.node.confidence } };
      if (target.kind === 'node') next = { ...next, [target.field]: result.node };
      if (target.kind === 'activity') {
        next = { ...next, days: next.days.map((day) => day.day !== target.day ? day : { ...day, activities: day.activities.map((activity, index) => index !== target.index || !activity.place ? activity : { ...activity, place: placeFromNode(activity.place, result.node!) }) }) };
      }
      if (result.status === 'DEMO') messages.push(`${request.query}: posizione simulata dal catalogo locale; da verificare e non usata per il meteo.`);
      return;
    }
    if (result.status === 'UNAVAILABLE_OFFLINE') {
      next = applyUnresolvedStatus(next, target, 'UNAVAILABLE_OFFLINE', 'Ricerca non disponibile offline');
      changed = true;
    } else if (result.status === 'MISSING' || result.status === 'CITY_MISMATCH') {
      next = applyUnresolvedStatus(next, target, 'MISSING', result.status === 'CITY_MISMATCH' ? `${client.source} · città diversa non associata` : 'Posizione da definire');
      changed = true;
    }
    if (result.message) messages.push(`${request.query}: ${result.message}`);
  });
  return { itinerary: next, issues, changed, messages };
}

export function applyGeoCandidate(itinerary: Itinerary, target: GeoTarget, node: LocationNode): Itinerary {
  if (target.kind === 'destination') return { ...itinerary, destinationNode: node };
  if (target.kind === 'lodging') return { ...itinerary, lodging: { ...itinerary.lodging, name: itinerary.lodging?.name, address: node.address ?? itinerary.lodging?.address, city: node.city, country: node.country, latitude: node.latitude, longitude: node.longitude, timezone: node.timezone, source: node.source, geoStatus: node.geoStatus, providerId: node.providerId, providerPlaceId: node.providerPlaceId, confidence: node.confidence } };
  if (target.kind === 'node') return { ...itinerary, [target.field]: node };
  return { ...itinerary, days: itinerary.days.map((day) => day.day !== target.day ? day : { ...day, activities: day.activities.map((activity, index) => index !== target.index || !activity.place ? activity : { ...activity, place: placeFromNode(activity.place, node) }) }) };
}

export function activityGeoRequest(activity: Activity, destination: string): GeocodingRequest {
  return { query: [activity.place?.title ?? activity.title, activity.place?.city ?? destination, activity.place?.country].filter(Boolean).join(', '), city: destination, type: 'activity' };
}