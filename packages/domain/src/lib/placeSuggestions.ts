import type { LocationNode, LocationNodeType } from '../types/travel';
import type { GeoapifyAdapterContract, GeocodingRequest } from './geocoding';

/*
 * Suggerimenti di località mentre si digita, da OpenStreetMap.
 *   - Photon (photon.komoot.io): ricerca "as you type" sui dati OpenStreetMap, senza chiave;
 *   - Geoapify autocomplete: stessi dati OpenStreetMap, nomi in italiano, se c'è la chiave.
 * Nominatim non si usa qui: la sua policy vieta l'autocompletamento.
 */

export const OPENSTREETMAP_ATTRIBUTION = '© OpenStreetMap contributors';
export const MIN_SUGGESTION_QUERY_LENGTH = 2;
export const SUGGESTION_DEBOUNCE_MS = 300;

/** `place`: città, regioni e paesi (destinazione, tappe). `point`: indirizzi, luoghi, stazioni, aeroporti. */
export type PlaceSuggestionKind = 'place' | 'point';

export interface PlaceSuggestionRequest {
  query: string;
  kind: PlaceSuggestionKind;
  limit?: number;
}

export interface PlaceSuggestionProvider {
  readonly provider: string;
  readonly source: string;
  suggest(request: PlaceSuggestionRequest, signal?: AbortSignal): Promise<LocationNode[]>;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const OSM_TYPES: Record<string, string> = { N: 'node', W: 'way', R: 'relation', node: 'node', way: 'way', relation: 'relation' };

/** Collegamento alla scheda OpenStreetMap del luogo, oppure alla mappa sulle sue coordinate. */
export function openStreetMapUrl(place: Pick<LocationNode, 'osmId' | 'latitude' | 'longitude'> | null | undefined): string | null {
  if (!place) return null;
  const match = /^(node|way|relation)\/(\d+)$/.exec(place.osmId ?? '');
  if (match) return `https://www.openstreetmap.org/${match[1]}/${match[2]}`;
  const { latitude, longitude } = place;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const lat = latitude.toFixed(5);
  const lon = longitude.toFixed(5);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`;
}

/** Nome del paese in italiano dal codice ISO (i provider li restituiscono in inglese o in lingua locale). */
export function italianCountryName(countryCode: unknown, fallback?: unknown): string | undefined {
  if (typeof countryCode === 'string' && /^[A-Za-z]{2}$/.test(countryCode)) {
    try {
      const name = new Intl.DisplayNames(['it'], { type: 'region' }).of(countryCode.toUpperCase());
      if (name) return name;
    } catch { /* Intl senza dati sulle regioni: si usa il nome del provider */ }
  }
  return typeof fallback === 'string' && fallback.trim() ? fallback : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('it').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** "Nome, città, paese" senza ripetizioni (es. "Lisbon, Portogallo"). */
function composeLabel(parts: Array<string | undefined>): string {
  const seen = new Set<string>();
  return parts.filter((part): part is string => Boolean(part)).filter((part) => {
    const key = normalize(part);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(', ');
}

function nodeType(kind: PlaceSuggestionKind, osmKey?: string, osmValue?: string): LocationNodeType {
  if (kind === 'place') return 'final';
  if (osmValue === 'aerodrome' || osmKey === 'aeroway') return 'airport';
  if (osmKey === 'railway' || osmValue === 'station' || osmValue === 'train_station') return 'station';
  if (osmValue === 'ferry_terminal' || osmValue === 'harbour') return 'port';
  if (osmKey === 'tourism' && ['hotel', 'hostel', 'guest_house', 'apartment'].includes(osmValue ?? '')) return 'accommodation';
  return 'custom';
}

// Per la destinazione contano città e paesi; per un punto contano luoghi e indirizzi.
const PLACE_RANK: Record<string, number> = { city: 0, country: 1, state: 2, region: 2, county: 3, locality: 4, district: 5, town: 0, village: 4 };
const POINT_RANK: Record<string, number> = { house: 0, street: 1, amenity: 0, district: 2, locality: 2, city: 3 };

interface SuggestionCandidate {
  node: LocationNode;
  layer: string;
}

function rankAndTrim(candidates: SuggestionCandidate[], kind: PlaceSuggestionKind, limit: number): LocationNode[] {
  const ranks = kind === 'place' ? PLACE_RANK : POINT_RANK;
  const seen = new Set<string>();
  return candidates
    .map((candidate, index) => ({ ...candidate, index, rank: ranks[candidate.layer] ?? 6 }))
    .filter((candidate) => kind === 'point' || candidate.rank < 6)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .filter(({ node }) => {
      const key = normalize(node.label);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ node }) => node);
}

interface PhotonFeature {
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: [number, number] };
}

/** Feature di Photon → nodo confermato con riferimento OpenStreetMap. */
export function photonFeatureToNode(feature: PhotonFeature, kind: PlaceSuggestionKind): SuggestionCandidate | null {
  const properties = feature.properties ?? {};
  const [longitude, latitude] = feature.geometry?.coordinates ?? [NaN, NaN];
  const name = text(properties.name);
  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const osmType = OSM_TYPES[String(properties.osm_type ?? '')];
  const osmNumber = Number(properties.osm_id);
  const osmId = osmType && Number.isFinite(osmNumber) ? `${osmType}/${osmNumber}` : undefined;
  const layer = String(properties.type ?? '');
  const city = text(properties.city) ?? (layer === 'city' ? name : undefined);
  const country = italianCountryName(properties.countrycode, properties.country);
  const street = text(properties.street);
  const address = street ? [street, text(properties.housenumber)].filter(Boolean).join(' ') : undefined;
  // La regione distingue località omonime (Lisbon, Maine e Lisbon, Ohio); per un punto conta la città.
  const label = kind === 'place' || layer === 'city' || layer === 'country'
    ? composeLabel([name, layer === 'country' || layer === 'state' ? undefined : text(properties.state), country])
    : composeLabel([name, city, country]);
  const id = osmId ? `osm-${osmId.replace('/', '-')}` : `osm-${normalize(label).replace(/[^a-z0-9]+/g, '-')}`;
  return {
    layer,
    node: {
      id,
      label,
      type: nodeType(kind, text(properties.osm_key), text(properties.osm_value)),
      address,
      city,
      country,
      latitude,
      longitude,
      osmId,
      placeId: id,
      providerId: osmId,
      source: 'OpenStreetMap · Photon',
      updatedAt: new Date().toISOString(),
      reliabilityStatus: 'VERIFIED',
      geoStatus: 'CONFIRMED',
    },
  };
}

/** Photon: ricerca "as you type" sui dati OpenStreetMap, senza chiave (uso moderato). */
export class PhotonSuggestionProvider implements PlaceSuggestionProvider {
  readonly provider = 'OpenStreetMap';
  readonly source = 'OpenStreetMap · Photon';

  constructor(
    private readonly fetcher: FetchLike = fetch,
    private readonly options: { baseUrl?: string; userAgent?: string } = {},
  ) {}

  async suggest(request: PlaceSuggestionRequest, signal?: AbortSignal): Promise<LocationNode[]> {
    const limit = request.limit ?? 6;
    // Più risultati del necessario: l'ordinamento per tipo (città prima delle vie) avviene qui.
    const params = new URLSearchParams({ q: request.query.trim(), limit: String(Math.min(limit * 3, 20)), lang: 'en' });
    if (request.kind === 'place') ['city', 'country', 'state', 'county', 'locality', 'district'].forEach((layer) => params.append('layer', layer));
    const headers: Record<string, string> = {};
    if (this.options.userAgent) headers['User-Agent'] = this.options.userAgent;
    const response = await this.fetcher(`${this.options.baseUrl ?? 'https://photon.komoot.io'}/api/?${params.toString()}`, { signal, headers });
    if (!response.ok) throw Object.assign(new Error(`Photon returned ${response.status}`), { status: response.status });
    const payload = await response.json() as { features?: PhotonFeature[] };
    const candidates = (payload.features ?? []).map((feature) => photonFeatureToNode(feature, request.kind)).filter((item): item is SuggestionCandidate => item !== null);
    return rankAndTrim(candidates, request.kind, limit);
  }
}

/** Geoapify autocomplete (dati OpenStreetMap, nomi in italiano): usato quando c'è la chiave. */
export class GeoapifySuggestionProvider implements PlaceSuggestionProvider {
  readonly provider = 'Geoapify';
  readonly source = 'Geoapify · OpenStreetMap';

  constructor(private readonly fetcher: FetchLike, private readonly apiKey: string) {}

  async suggest(request: PlaceSuggestionRequest, signal?: AbortSignal): Promise<LocationNode[]> {
    const limit = request.limit ?? 6;
    const params = new URLSearchParams({ text: request.query.trim(), lang: 'it', limit: String(limit), format: 'json', apiKey: this.apiKey });
    if (request.kind === 'place') params.set('type', 'city');
    const response = await this.fetcher(`https://api.geoapify.com/v1/geocode/autocomplete?${params.toString()}`, { signal });
    if (!response.ok) throw Object.assign(new Error(`Geoapify returned ${response.status}`), { status: response.status });
    const payload = await response.json() as { results?: Array<Record<string, unknown>> };
    return (payload.results ?? []).flatMap((result): LocationNode[] => {
      const latitude = Number(result.lat);
      const longitude = Number(result.lon);
      const label = text(result.formatted);
      if (!label || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
      const datasource = (result.datasource ?? {}) as Record<string, unknown>;
      const raw = (datasource.raw ?? {}) as Record<string, unknown>;
      const osmType = OSM_TYPES[String(raw.osm_type ?? '')];
      const osmId = osmType && Number.isFinite(Number(raw.osm_id)) ? `${osmType}/${Number(raw.osm_id)}` : undefined;
      const placeId = text(result.place_id);
      return [{
        id: placeId ? `geoapify-${placeId.slice(0, 60)}` : `geoapify-${normalize(label).replace(/[^a-z0-9]+/g, '-')}`,
        label,
        type: request.kind === 'place' ? 'final' : 'custom',
        address: text(result.address_line1),
        city: text(result.city),
        country: text(result.country),
        latitude,
        longitude,
        osmId,
        providerId: placeId,
        providerPlaceId: placeId,
        source: this.source,
        updatedAt: new Date().toISOString(),
        reliabilityStatus: 'VERIFIED',
        geoStatus: 'CONFIRMED',
      }];
    });
  }
}

/**
 * Geocoding gratuito per confermare le posizioni del piano (destinazione, alloggio,
 * punti di arrivo e rientro) quando manca la chiave Geoapify. Photon non dà un
 * punteggio di affidabilità: con più risultati il planner chiede di confermare.
 */
export class PhotonGeocodingAdapter implements GeoapifyAdapterContract {
  readonly provider = 'OpenStreetMap';
  readonly source = 'OpenStreetMap · Photon';
  readonly available = true;
  private readonly photon: PhotonSuggestionProvider;

  constructor(fetcher: FetchLike = fetch, options: { baseUrl?: string; userAgent?: string } = {}) {
    this.photon = new PhotonSuggestionProvider(fetcher, options);
  }

  async search(request: GeocodingRequest, signal?: AbortSignal): Promise<LocationNode[]> {
    const kind: PlaceSuggestionKind = request.type === 'final' ? 'place' : 'point';
    const nodes = await this.photon.suggest({ query: request.query, kind, limit: 4 }, signal);
    return nodes.map((node) => ({ ...node, type: request.type ?? node.type }));
  }
}
