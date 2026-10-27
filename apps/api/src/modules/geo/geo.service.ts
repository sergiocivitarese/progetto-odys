import path from 'node:path';
import {
  applyGeoCandidate,
  enrichItineraryGeography,
  GeoapifyAdapter,
  GeoapifySuggestionProvider,
  GeocodingClient,
  MIN_SUGGESTION_QUERY_LENGTH,
  normalizePlan,
  OPENSTREETMAP_ATTRIBUTION,
  PhotonGeocodingAdapter,
  PhotonSuggestionProvider,
  recalculateRoutes,
  synchronizeItineraryMap,
  type GeoCacheStore,
  type GeocodingRequest,
  type GeoTarget,
  type Itinerary,
  type LocationNode,
  type PlaceSuggestionProvider,
  type PlaceSuggestionRequest,
} from '@odys/domain';
import { JsonFile } from '../../shared/jsonFile';

const SUGGESTION_CACHE_SIZE = 500;
const SUGGESTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface PlaceSuggestions {
  suggestions: LocationNode[];
  provider: string;
  attribution: string;
}

/** Geocoding lato server: la chiave Geoapify non arriva mai al browser. */
export class GeoService {
  private readonly client: GeocodingClient;
  private readonly suggestions: PlaceSuggestionProvider;
  /** Cache dei suggerimenti (in memoria): chi digita la stessa località non interroga di nuovo OSM. */
  private readonly suggestionCache = new Map<string, { at: number; value: LocationNode[] }>();
  /** Con il servizio gratuito non si cercano le attività segnaposto del piano generato. */
  private readonly searchActivities: boolean;

  /** `cache`: Supabase se disponibile, altrimenti un file JSON locale in `dataDir`. */
  constructor(apiKey: string, dataDir: string, cache?: GeoCacheStore | null, osm: { photonUrl?: string; userAgent?: string } = {}, fetcher: typeof fetch = fetch) {
    const file = new JsonFile<unknown>(path.join(dataDir, 'geocoding-cache.json'), () => ({}));
    const store: GeoCacheStore = cache ?? { read: () => file.readRaw(), write: (value) => file.writeRaw(value) };
    // Senza chiave Geoapify le posizioni si confermano con Photon (OpenStreetMap, gratuito).
    this.client = new GeocodingClient(apiKey ? new GeoapifyAdapter(fetcher, apiKey) : new PhotonGeocodingAdapter(fetcher, { baseUrl: osm.photonUrl, userAgent: osm.userAgent }), store);
    this.searchActivities = Boolean(apiKey);
    this.suggestions = apiKey
      ? new GeoapifySuggestionProvider(fetcher, apiKey)
      : new PhotonSuggestionProvider(fetcher, { baseUrl: osm.photonUrl, userAgent: osm.userAgent });
  }

  /** Suggerimenti di località mentre si digita (OpenStreetMap). */
  async suggest(request: PlaceSuggestionRequest): Promise<PlaceSuggestions> {
    const query = request.query.trim().slice(0, 120);
    const base = { provider: this.suggestions.source, attribution: OPENSTREETMAP_ATTRIBUTION };
    if (query.length < MIN_SUGGESTION_QUERY_LENGTH) return { ...base, suggestions: [] };
    const key = `${request.kind}|${query.toLocaleLowerCase('it')}`;
    const cached = this.suggestionCache.get(key);
    if (cached && Date.now() - cached.at < SUGGESTION_CACHE_TTL_MS) return { ...base, suggestions: cached.value };
    const value = await this.suggestions.suggest({ ...request, query }, AbortSignal.timeout(6000));
    this.suggestionCache.delete(key);
    this.suggestionCache.set(key, { at: Date.now(), value });
    if (this.suggestionCache.size > SUGGESTION_CACHE_SIZE) this.suggestionCache.delete(this.suggestionCache.keys().next().value!);
    return { ...base, suggestions: value };
  }

  search(request: GeocodingRequest) {
    return this.client.geocode(request);
  }

  /** Cerca le posizioni mancanti del piano; i risultati ambigui tornano come "issues" da confermare. */
  async enrich(itinerary: Itinerary) {
    const result = await enrichItineraryGeography(itinerary, this.client, { activities: this.searchActivities });
    const next = result.changed
      ? normalizePlan(synchronizeItineraryMap(recalculateRoutes(result.itinerary, result.itinerary.lodging), itinerary.mapSnapshot?.updatedAt))
      : itinerary;
    return { itinerary: next, changed: result.changed, issues: result.issues, messages: Array.from(new Set(result.messages)).slice(0, 8) };
  }

  confirm(itinerary: Itinerary, target: GeoTarget, node: LocationNode): Itinerary {
    return normalizePlan(synchronizeItineraryMap(recalculateRoutes(applyGeoCandidate(itinerary, target, {
      ...node,
      geoStatus: 'CONFIRMED',
      reliabilityStatus: 'VERIFIED',
    }), itinerary.lodging), itinerary.mapSnapshot?.updatedAt));
  }
}
