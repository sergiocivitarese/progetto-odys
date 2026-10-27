import type { SavedTrip } from '@/types/travel';

export const TRIP_EXPORT_FORMAT = 'travel-companion-trip';
export const TRIP_EXPORT_VERSION = 5;

export interface TripExportPayload {
  format: typeof TRIP_EXPORT_FORMAT;
  version: typeof TRIP_EXPORT_VERSION;
  exportedAt: string;
  trip: SavedTrip;
}

type JsonRecord = Record<string, unknown>;

interface ImportContext {
  activityIds: Set<string>;
  segmentIds: Set<string>;
  nodeSignatures: Map<string, string>;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function optionalInteger(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value));
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function optionalStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

function optionalFields(record: JsonRecord, keys: string[], validator: (value: unknown) => boolean): boolean {
  return keys.every((key) => validator(record[key]));
}

function coordinatePair(value: JsonRecord): boolean {
  const hasLatitude = value.latitude !== undefined;
  const hasLongitude = value.longitude !== undefined;
  return hasLatitude === hasLongitude && optionalFiniteNumber(value.latitude) && optionalFiniteNumber(value.longitude);
}

function registerNode(context: ImportContext, node: JsonRecord, path: string): string | null {
  if (!nonEmptyString(node.id) || !nonEmptyString(node.label) || !nonEmptyString(node.type) || !nonEmptyString(node.geoStatus)
    || !coordinatePair(node) || !optionalFields(node, ['address', 'city', 'zone', 'placeId', 'osmId', 'providerId', 'providerPlaceId', 'country', 'timezone', 'source', 'updatedAt'], optionalString)
    || !optionalFiniteNumber(node.confidence) || !optionalString(node.reliabilityStatus)) {
    return `${path} contiene un nodo non valido.`;
  }
  const signature = JSON.stringify([node.label, node.type, node.geoStatus, node.latitude ?? null, node.longitude ?? null]);
  const existing = context.nodeSignatures.get(node.id);
  if (existing && existing !== signature) return `${path} riusa un identificativo nodo con dati incoerenti.`;
  context.nodeSignatures.set(node.id, signature);
  return null;
}

function validatePlace(value: unknown, path: string): string | null {
  if (!isRecord(value) || !nonEmptyString(value.id) || !nonEmptyString(value.title) || !nonEmptyString(value.source)
    || !nonEmptyString(value.updatedAt) || !nonEmptyString(value.geoStatus) || !nonEmptyString(value.category)
    || !nonEmptyString(value.whyRecommended) || !coordinatePair(value)
    || !optionalFields(value, ['address', 'city', 'zone', 'placeId', 'providerId', 'providerPlaceId', 'visitDuration', 'openingHours', 'country', 'timezone'], optionalString)
    || !optionalFiniteNumber(value.confidence) || !optionalString(value.setting)) {
    return `${path} contiene un luogo non valido.`;
  }
  return null;
}

function validateActivity(value: unknown, path: string, context: ImportContext): string | null {
  if (!isRecord(value) || !nonEmptyString(value.time) || !nonEmptyString(value.title) || typeof value.detail !== 'string'
    || !nonEmptyString(value.category) || !optionalString(value.id) || !optionalString(value.dayId)
    || !optionalString(value.nodeId) || !optionalString(value.duration) || !optionalString(value.notes)
    || !optionalString(value.status) || !optionalString(value.updatedAt) || !optionalInteger(value.order)
    || !optionalString(value.transport) || !optionalString(value.setting) || !optionalBoolean(value.requiresBooking)
    || !optionalBoolean(value.completed) || !optionalString(value.repositioningDecision) || !optionalString(value.repositioningCheckedAt)
    || (typeof value.order === 'number' && value.order < 0)) {
    return `${path} contiene campi attività obbligatori mancanti o non validi.`;
  }
  if (typeof value.id === 'string' && value.id.trim()) {
    if (context.activityIds.has(value.id)) return `${path} duplica l'identificativo di un'attività.`;
    context.activityIds.add(value.id);
  }
  if (value.place !== undefined) {
    const placeError = validatePlace(value.place, `${path}.place`);
    if (placeError) return placeError;
  }
  if (typeof value.nodeId === 'string' && value.nodeId.trim()) {
    const place = isRecord(value.place) ? value.place : {};
    return registerNode(context, {
      id: value.nodeId,
      label: value.title,
      type: 'activity',
      geoStatus: place.geoStatus ?? 'MISSING',
      source: place.source,
      latitude: place.latitude,
      longitude: place.longitude,
    }, `${path}.nodeId`);
  }
  return null;
}

function validateSegments(value: unknown, path: string, context: ImportContext): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return `${path} deve essere una lista.`;
  for (let index = 0; index < value.length; index += 1) {
    const segment = value[index];
    if (!isRecord(segment) || !nonEmptyString(segment.id) || typeof segment.day !== 'number' || !Number.isInteger(segment.day)
      || typeof segment.order !== 'number' || !Number.isInteger(segment.order) || !nonEmptyString(segment.fromNodeId)
      || !nonEmptyString(segment.toNodeId) || !nonEmptyString(segment.type) || !nonEmptyString(segment.recommendedMode)
      || !nonEmptyString(segment.cost) || !nonEmptyString(segment.changes) || !nonEmptyString(segment.comfort)
      || !nonEmptyString(segment.weatherImpact) || !nonEmptyString(segment.reliability) || !nonEmptyString(segment.status)
      || !nonEmptyString(segment.note) || !Array.isArray(segment.alternatives) || !segment.alternatives.every((mode) => typeof mode === 'string')
      || !optionalFields(segment, ['duration', 'distance', 'source', 'provider', 'updatedAt', 'lastCalculatedAt'], optionalString)
      || !optionalBoolean(segment.completed)) {
      return `${path}[${index}] contiene una tratta non valida.`;
    }
    if (context.segmentIds.has(segment.id)) return `${path}[${index}] duplica l'identificativo di una tratta.`;
    context.segmentIds.add(segment.id);
    if (!isRecord(segment.origin) || !isRecord(segment.destination) || segment.origin.id !== segment.fromNodeId || segment.destination.id !== segment.toNodeId) {
      return `${path}[${index}] ha riferimenti nodo incoerenti.`;
    }
    const originError = registerNode(context, segment.origin, `${path}[${index}].origin`);
    const destinationError = registerNode(context, segment.destination, `${path}[${index}].destination`);
    if (originError || destinationError) return originError ?? destinationError;
    if (segment.geometry !== undefined) {
      if (!isRecord(segment.geometry) || !nonEmptyString(segment.geometry.kind) || !Array.isArray(segment.geometry.coordinates)
        || !segment.geometry.coordinates.every((point) => Array.isArray(point) && point.length === 2 && point.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)))) {
        return `${path}[${index}] contiene una geometria non valida.`;
      }
    }
  }
  return null;
}

function validateWeather(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return `${path} deve essere una lista.`;
  for (let index = 0; index < value.length; index += 1) {
    const record = value[index];
    if (!isRecord(record) || !nonEmptyString(record.id) || !nonEmptyString(record.nodeId) || !nonEmptyString(record.nodeLabel)
      || !nonEmptyString(record.localDate) || !nonEmptyString(record.timezone) || !nonEmptyString(record.status)
      || !nonEmptyString(record.dataset) || !nonEmptyString(record.provider) || !nonEmptyString(record.source)
      || !optionalFiniteNumber(record.latitude) || !optionalFiniteNumber(record.longitude)
      || record.latitude === undefined || record.longitude === undefined
      || !optionalFields(record, ['license', 'attribution', 'updatedAt', 'lastSuccessfulAt', 'conditionDescription', 'note'], optionalString)
      || !optionalFields(record, ['temperatureMinC', 'temperatureMaxC', 'precipitationMm', 'precipitationProbability', 'windKmh', 'conditionCode'], optionalFiniteNumber)) {
      return `${path}[${index}] contiene un dato meteo non valido.`;
    }
  }
  return null;
}

function validateMapSnapshot(value: unknown, context: ImportContext): string | null {
  if (value === undefined) return null;
  if (!isRecord(value) || value.version !== 1 || !nonEmptyString(value.signature) || !nonEmptyString(value.provider)
    || !Array.isArray(value.markers) || !Array.isArray(value.routeLinks) || !isRecord(value.offline)
    || !nonEmptyString(value.offline.status) || !nonEmptyString(value.offline.note) || !Array.isArray(value.offline.areas)) {
    return 'Export incompleto: la mappa salvata non ha una struttura valida.';
  }
  const markerIds = new Set<string>();
  for (let index = 0; index < value.markers.length; index += 1) {
    const marker = value.markers[index];
    if (!isRecord(marker) || !nonEmptyString(marker.id) || !nonEmptyString(marker.nodeId) || !nonEmptyString(marker.label)
      || !nonEmptyString(marker.type) || !nonEmptyString(marker.source) || !nonEmptyString(marker.reliabilityStatus)
      || typeof marker.latitude !== 'number' || !Number.isFinite(marker.latitude) || typeof marker.longitude !== 'number' || !Number.isFinite(marker.longitude)
      || markerIds.has(marker.id) || !context.nodeSignatures.has(marker.nodeId)
      || !optionalInteger(marker.day) || !optionalInteger(marker.sequence) || !optionalString(marker.updatedAt)) {
      return `Mappa salvata: marker ${index + 1} non valido o senza nodo corrispondente.`;
    }
    markerIds.add(marker.id);
  }
  const linkIds = new Set<string>();
  for (let index = 0; index < value.routeLinks.length; index += 1) {
    const link = value.routeLinks[index];
    if (!isRecord(link) || !nonEmptyString(link.id) || !nonEmptyString(link.segmentId) || !nonEmptyString(link.fromNodeId)
      || !nonEmptyString(link.toNodeId) || !nonEmptyString(link.mode) || !nonEmptyString(link.source)
      || !nonEmptyString(link.reliabilityStatus) || !nonEmptyString(link.note) || linkIds.has(link.id)
      || typeof link.day !== 'number' || !Number.isInteger(link.day) || typeof link.order !== 'number' || !Number.isInteger(link.order)
      || !context.segmentIds.has(link.segmentId) || !context.nodeSignatures.has(link.fromNodeId) || !context.nodeSignatures.has(link.toNodeId)
      || !optionalString(link.duration) || !optionalString(link.distance)
      || (link.geometry !== undefined && (!isRecord(link.geometry) || !nonEmptyString(link.geometry.kind) || !Array.isArray(link.geometry.coordinates)
        || !link.geometry.coordinates.every((point) => Array.isArray(point) && point.length === 2 && point.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)))))) {
      return `Mappa salvata: collegamento ${index + 1} non valido o senza riferimenti corrispondenti.`;
    }
    linkIds.add(link.id);
  }
  const areaIds = new Set<string>();
  for (let index = 0; index < value.offline.areas.length; index += 1) {
    const area = value.offline.areas[index];
    if (!isRecord(area) || !nonEmptyString(area.id) || !nonEmptyString(area.label) || !nonEmptyString(area.status)
      || areaIds.has(area.id) || !optionalString(area.packId) || !optionalString(area.provider)
      || !optionalFiniteNumber(area.minZoom) || !optionalFiniteNumber(area.maxZoom) || !optionalFiniteNumber(area.progress)
      || !optionalFields(area, ['styleId', 'styleVersion', 'styleUrlHash', 'downloadedAt', 'updatedAt', 'lastError'], optionalString)
      || !optionalFields(area, ['estimatedSizeMb', 'actualSizeMb', 'completedResources', 'requiredResources'], optionalFiniteNumber)
      || (area.bounds !== undefined && (!Array.isArray(area.bounds) || area.bounds.length !== 4 || !area.bounds.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))))) {
      return `Mappa salvata: area offline ${index + 1} non valida.`;
    }
    areaIds.add(area.id);
  }
  return null;
}

function validateLodging(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isRecord(value) || !optionalFields(value, ['name', 'address', 'zone', 'customStartingPoint', 'arrivalStation', 'departureStation', 'port', 'changeOfLodging', 'city', 'country', 'timezone', 'geoStatus', 'providerId', 'providerPlaceId', 'source'], optionalString)
    || !optionalFiniteNumber(value.latitude) || !optionalFiniteNumber(value.longitude) || !optionalFiniteNumber(value.confidence) || !coordinatePair(value)) {
    return 'Export incompleto: dati alloggio non validi.';
  }
  return null;
}

function validateItinerary(value: unknown, allowOriginal = true): string | null {
  if (!isRecord(value) || !nonEmptyString(value.destination) || !Array.isArray(value.days)
    || !optionalFiniteNumber(value.duration) || !optionalFiniteNumber(value.version)
    || !optionalFields(value, ['departure', 'returnDate', 'arrivalTime', 'departureTime', 'travelers', 'budget', 'budgetPerTraveler', 'constraints', 'estimate', 'weatherNote', 'scheduleNote', 'routeSummary', 'pace', 'transport', 'budgetReliability', 'arrivalTransport', 'returnTransport', 'arrivalDate', 'arrivalDestinationKind', 'weatherMode', 'planningMode'], optionalString)
    || !optionalStringArray(value.interests) || !optionalStringArray(value.customInterests) || !optionalStringArray(value.stops) || !optionalStringArray(value.nextSteps)
    || !optionalInteger(value.arrivalDayOffset) || (typeof value.arrivalDayOffset === 'number' && value.arrivalDayOffset !== 0 && value.arrivalDayOffset !== 1)) {
    return 'Export incompleto: l’itinerario non ha una struttura valida.';
  }
  const lodgingError = validateLodging(value.lodging);
  if (lodgingError) return lodgingError;
  const context: ImportContext = { activityIds: new Set(), segmentIds: new Set(), nodeSignatures: new Map() };
  for (const [field, node] of Object.entries({
    destinationNode: value.destinationNode,
    departurePoint: value.departurePoint,
    arrivalPoint: value.arrivalPoint,
    arrivalDestinationPoint: value.arrivalDestinationPoint,
    returnPoint: value.returnPoint,
  })) {
    if (node !== undefined) {
      if (!isRecord(node)) return `Export incompleto: ${field} non valido.`;
      const error = registerNode(context, node, field);
      if (error) return error;
    }
  }
  const dayNumbers = new Set<number>();
  for (let index = 0; index < value.days.length; index += 1) {
    const day = value.days[index];
    if (!isRecord(day) || typeof day.day !== 'number' || !Number.isInteger(day.day) || day.day < 1 || dayNumbers.has(day.day)
      || !nonEmptyString(day.date) || !nonEmptyString(day.label) || !nonEmptyString(day.rainyAlternative)
      || !nonEmptyString(day.tiredAlternative) || !Array.isArray(day.activities)) {
      return `Export incompleto: giornata ${index + 1} non valida.`;
    }
    dayNumbers.add(day.day);
    for (const [field, node] of Object.entries({ origin: day.origin, finalDestination: day.finalDestination })) {
      if (node !== undefined) {
        if (!isRecord(node)) return `Giornata ${index + 1}.${field} non valido.`;
        const error = registerNode(context, node, `Giornata ${index + 1}.${field}`);
        if (error) return error;
      }
    }
    for (let activityIndex = 0; activityIndex < day.activities.length; activityIndex += 1) {
      const activityError = validateActivity(day.activities[activityIndex], `Giornata ${index + 1}.activities[${activityIndex}]`, context);
      if (activityError) return activityError;
    }
    const segmentsError = validateSegments(day.segments, `Giornata ${index + 1}.segments`, context);
    if (segmentsError) return segmentsError;
  }
  const interurbanError = validateSegments(value.interurbanRoutes, 'Tratte interurbane', context);
  if (interurbanError) return interurbanError;
  const weatherError = validateWeather(value.weather, 'Meteo');
  if (weatherError) return weatherError;
  const mapError = validateMapSnapshot(value.mapSnapshot, context);
  if (mapError) return mapError;
  if (allowOriginal && value.original !== undefined) {
    const originalError = validateItinerary(value.original, false);
    if (originalError) return `Export incompleto: piano originale non valido (${originalError}).`;
  }
  return null;
}

export function serializeTripExport(trip: SavedTrip, exportedAt = new Date().toISOString()): string {
  const payload: TripExportPayload = {
    format: TRIP_EXPORT_FORMAT,
    version: TRIP_EXPORT_VERSION,
    exportedAt,
    trip,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseTripExport(raw: string): { trip: SavedTrip | null; error: string | null } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { trip: null, error: 'Il file non contiene un oggetto JSON valido.' };
    if (parsed.format !== TRIP_EXPORT_FORMAT || parsed.version !== TRIP_EXPORT_VERSION) {
      return { trip: null, error: 'Formato non supportato: importa un export Travel Companion v5.' };
    }
    const trip = parsed.trip;
    if (!isRecord(trip) || !nonEmptyString(trip.id) || !nonEmptyString(trip.title)
      || !optionalString(trip.createdAt) || !optionalString(trip.updatedAt)
      || (trip.planVersion !== undefined && typeof trip.planVersion !== 'number')) {
      return { trip: null, error: 'Export incompleto: i metadati del viaggio non sono validi.' };
    }
    const itineraryError = validateItinerary(trip.itinerary);
    if (itineraryError) return { trip: null, error: itineraryError };
    return { trip: trip as unknown as SavedTrip, error: null };
  } catch {
    return { trip: null, error: 'JSON non valido o corrotto. Controlla il contenuto e riprova.' };
  }
}