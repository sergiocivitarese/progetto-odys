/**
 * Modello di dominio Odys.
 *
 * Nel progetto Triply questo file (`types/travel.ts`) era importato ovunque ma
 * mancava dal repository. È stato ricostruito dall'uso effettivo nel codice
 * legacy e dalla validazione degli export (`lib/tripTransfer.ts`).
 */

// ---------------------------------------------------------------------------
// Stati dei dati: ogni informazione dichiara quanto è affidabile
// ---------------------------------------------------------------------------

/** Stato della posizione geografica di un luogo o nodo. */
export type GeoStatus = 'CONFIRMED' | 'DEMO' | 'ESTIMATED' | 'TO_VERIFY' | 'UNAVAILABLE_OFFLINE' | 'MISSING';

/** Affidabilità di un nodo o di una tratta. */
export type ReliabilityStatus = 'VERIFIED' | 'ESTIMATED' | 'DEMO' | 'TO_VERIFY' | 'MISSING';

export type ActivityStatus = 'CONFIRMED' | 'SIMULATED' | 'TO_VERIFY' | 'MISSING' | 'OFFLINE' | 'TO_DEFINE' | 'COMPLETED';

/** Stato mostrato all'utente con i badge del design system. */
export type DataState = 'confermato' | 'simulato' | 'offline' | 'da-verificare' | 'mancante' | 'da-definire' | 'non-disponibile' | 'completata';

// ---------------------------------------------------------------------------
// Preferenze di viaggio
// ---------------------------------------------------------------------------

export type RecommendedInterest = 'Arte' | 'Cibo' | 'Natura' | 'Storia' | 'Benessere' | 'Design';
/** Gli interessi possono essere consigliati o personalizzati dall'utente. */
export type Interest = RecommendedInterest | (string & {});

export type Pace = 'rilassato' | 'equilibrato' | 'intenso';
export type ActivitySetting = 'indoor' | 'outdoor';

export type Transport = 'a piedi' | 'trasporto pubblico' | 'treno' | 'autobus' | 'auto' | 'taxi' | 'aereo' | 'traghetto' | 'misto' | 'altro';
export type ActivityTransport = Transport;
export type ArrivalTransport = 'aereo' | 'treno' | 'auto' | 'autobus' | 'traghetto' | 'altro';
export type ArrivalDestinationKind = 'lodging' | 'first-activity' | 'custom';
export type BudgetReliability = 'USER_ENTERED' | 'TO_VERIFY';
export type PlanningMode = 'initial' | 'detailed';

// ---------------------------------------------------------------------------
// Luoghi, nodi e tratte
// ---------------------------------------------------------------------------

export type LocationNodeType = 'activity' | 'accommodation' | 'station' | 'port' | 'airport' | 'custom' | 'final' | 'previous-stop' | 'undefined';

export interface LocationNode {
  id: string;
  label: string;
  type: LocationNodeType;
  address?: string;
  city?: string;
  zone?: string;
  country?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  osmId?: string;
  providerId?: string;
  providerPlaceId?: string;
  confidence?: number;
  source?: string;
  updatedAt?: string;
  reliabilityStatus?: ReliabilityStatus;
  geoStatus: GeoStatus;
}

export interface PlaceMetadata {
  id: string;
  title: string;
  address?: string;
  city?: string;
  zone?: string;
  country?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  providerId?: string;
  providerPlaceId?: string;
  confidence?: number;
  visitDuration?: string;
  openingHours?: string;
  setting?: ActivitySetting;
  source: string;
  updatedAt: string;
  geoStatus: GeoStatus;
  category: Interest;
  whyRecommended: string;
}

export interface LodgingInfo {
  name?: string;
  address?: string;
  zone?: string;
  customStartingPoint?: string;
  arrivalStation?: string;
  departureStation?: string;
  port?: string;
  changeOfLodging?: string;
  city?: string;
  country?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
  confidence?: number;
  geoStatus?: GeoStatus;
  providerId?: string;
  providerPlaceId?: string;
  source?: string;
}

export interface RouteGeometry {
  kind: 'route' | 'straight' | (string & {});
  coordinates: Array<[number, number]>;
}

export interface RouteSegment {
  id: string;
  day: number;
  order: number;
  fromNodeId: string;
  toNodeId: string;
  origin: LocationNode;
  destination: LocationNode;
  type: 'intracity' | 'interurban';
  recommendedMode: Transport;
  alternatives: Transport[];
  duration?: string;
  distance?: string;
  cost: string;
  changes: string;
  comfort: string;
  weatherImpact: string;
  reliability: ReliabilityStatus;
  status: ReliabilityStatus;
  note: string;
  source?: string;
  provider?: string;
  updatedAt?: string;
  lastCalculatedAt?: string;
  geometry?: RouteGeometry;
  completed?: boolean;
}

// ---------------------------------------------------------------------------
// Itinerario
// ---------------------------------------------------------------------------

export interface Activity {
  id?: string;
  dayId?: string;
  order?: number;
  time: string;
  title: string;
  detail: string;
  category: Interest;
  transport?: Transport;
  setting?: ActivitySetting;
  requiresBooking?: boolean;
  place?: PlaceMetadata;
  nodeId?: string;
  duration?: string;
  notes?: string;
  status?: ActivityStatus;
  completed?: boolean;
  updatedAt?: string;
  repositioningDecision?: 'ACCEPTED' | 'KEPT' | 'DISMISSED';
  repositioningCheckedAt?: string;
}

export interface DayPlan {
  day: number;
  date: string;
  label: string;
  activities: Activity[];
  rainyAlternative: string;
  tiredAlternative: string;
  origin?: LocationNode;
  finalDestination?: LocationNode;
  segments?: RouteSegment[];
}

export type WeatherMode = 'operational-high' | 'operational-medium' | 'trend' | 'seasonal';
export type WeatherDataset = 'forecast' | 'historical';
export type WeatherStatus = 'FORECAST' | 'HISTORICAL_CLIMATE' | 'UPDATE_NEEDED' | 'TO_VERIFY' | 'OFFLINE' | 'UNAVAILABLE';

export interface WeatherSnapshot {
  id: string;
  nodeId: string;
  nodeLabel: string;
  latitude: number;
  longitude: number;
  localDate: string;
  timezone: string;
  status: WeatherStatus;
  dataset: WeatherDataset;
  provider: string;
  source: string;
  license?: string;
  attribution?: string;
  note?: string;
  temperatureMinC?: number;
  temperatureMaxC?: number;
  precipitationMm?: number;
  precipitationProbability?: number;
  windKmh?: number;
  conditionCode?: number;
  conditionDescription?: string;
  updatedAt?: string;
  lastSuccessfulAt?: string;
}

// ---------------------------------------------------------------------------
// Mappa
// ---------------------------------------------------------------------------

export type MapViewMode = 'trip' | 'day' | 'activities' | 'arrival-return';
export type OfflineMapStatus = 'NOT_DOWNLOADED' | 'PREPARING' | 'DOWNLOADING' | 'PREPARED' | 'CANCELLED' | 'ERROR' | 'UNAVAILABLE';

export interface MapMarker {
  id: string;
  nodeId: string;
  label: string;
  type: LocationNodeType;
  day?: number;
  sequence?: number;
  latitude: number;
  longitude: number;
  source: string;
  reliabilityStatus: ReliabilityStatus;
  updatedAt?: string;
}

export interface MapRouteLink {
  id: string;
  segmentId: string;
  fromNodeId: string;
  toNodeId: string;
  day: number;
  order: number;
  mode: Transport;
  duration?: string;
  distance?: string;
  source: string;
  reliabilityStatus: ReliabilityStatus;
  note: string;
  geometry?: RouteGeometry;
}

export interface OfflineMapArea {
  id: string;
  label: string;
  bounds?: [number, number, number, number];
  minZoom?: number;
  maxZoom?: number;
  styleId?: string;
  styleVersion?: string;
  styleUrlHash?: string;
  status: OfflineMapStatus;
  provider?: string;
  packId?: string;
  estimatedSizeMb?: number;
  actualSizeMb?: number;
  progress?: number;
  completedResources?: number;
  requiredResources?: number;
  downloadedAt?: string;
  updatedAt?: string;
  lastError?: string;
}

export interface MapSnapshot {
  version: 1;
  signature: string;
  updatedAt?: string;
  provider: string;
  markers: MapMarker[];
  routeLinks: MapRouteLink[];
  offline: {
    status: OfflineMapStatus;
    areas: OfflineMapArea[];
    note: string;
  };
}

// ---------------------------------------------------------------------------
// Piano, modulo e viaggio salvato
// ---------------------------------------------------------------------------

export interface ItinerarySnapshot {
  destination: string;
  destinationNode?: LocationNode;
  departure?: string;
  returnDate?: string;
  arrivalTime?: string;
  departureTime?: string;
  travelers?: string;
  budget?: string;
  budgetPerTraveler?: string;
  budgetReliability?: BudgetReliability;
  interests?: Interest[];
  customInterests?: string[];
  constraints?: string;
  stops?: string[];
  lodging?: LodgingInfo;
  arrivalTransport?: ArrivalTransport;
  departurePoint?: LocationNode;
  arrivalPoint?: LocationNode;
  arrivalDayOffset?: 0 | 1;
  arrivalDate?: string;
  arrivalDestinationKind?: ArrivalDestinationKind;
  arrivalDestinationPoint?: LocationNode;
  returnTransport?: ArrivalTransport;
  returnPoint?: LocationNode;
  duration: number;
  profile: string;
  pace: Pace;
  transport: Transport;
  estimate: string;
  weatherMode: WeatherMode;
  weatherNote: string;
  scheduleNote?: string;
  planningMode?: PlanningMode;
  routeSummary?: string;
  days: DayPlan[];
  nextSteps: string[];
  version?: number;
  interurbanRoutes?: RouteSegment[];
  weather?: WeatherSnapshot[];
  mapSnapshot?: MapSnapshot;
}

export interface Itinerary extends ItinerarySnapshot {
  /** Versione generata inizialmente, usata per "ripristina originale". */
  original?: ItinerarySnapshot;
}

export interface TripForm {
  destination: string;
  /** Località scelta tra i suggerimenti OpenStreetMap: la destinazione nasce già confermata. */
  destinationPoint?: LocationNode;
  departure: string;
  returnDate: string;
  arrivalTime: string;
  departureTime: string;
  travelers: string;
  budget?: string;
  budgetPerTraveler?: string;
  budgetReliability?: BudgetReliability;
  pace: Pace;
  interests: Interest[];
  customInterests: string[];
  constraints?: string;
  transport: Transport;
  stops?: string[];
  lodging?: LodgingInfo;
  arrivalTransport?: ArrivalTransport;
  departurePoint?: LocationNode;
  arrivalPoint?: LocationNode;
  arrivalDayOffset?: 0 | 1;
  arrivalDate?: string;
  arrivalDestinationKind?: ArrivalDestinationKind;
  arrivalDestinationPoint?: LocationNode;
  returnTransport?: ArrivalTransport;
  returnPoint?: LocationNode;
}

export type TripDateFields = Pick<TripForm, 'departure' | 'returnDate' | 'arrivalTime' | 'departureTime' | 'arrivalDayOffset' | 'arrivalDate' | 'arrivalDestinationKind' | 'arrivalDestinationPoint'>;

export interface SavedTrip {
  id: string;
  title: string;
  itinerary: Itinerary;
  createdAt?: string;
  updatedAt?: string;
  planVersion?: number;
}

/** Idea di viaggio di gruppo (dati demo, sezione "Viaggi di gruppo"). */
export interface GroupTrip {
  id: string;
  title: string;
  destination: string;
  creator: string;
  duration: string;
  spots: string;
  price: string;
  image: string;
}
