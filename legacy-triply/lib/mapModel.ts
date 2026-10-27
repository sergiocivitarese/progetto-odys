import type { Activity, Itinerary, LocationNode, MapMarker, MapRouteLink, MapSnapshot, MapViewMode, RouteSegment } from '@/types/travel';
import { collectPlanNodes, ensureLocationNode, nodeIdForActivity } from '@/lib/routeModel';

export const MAP_PROVIDER_ATTRIBUTION = '© MapTiler © OpenStreetMap contributors';
export const MAP_LOCAL_ATTRIBUTION = 'Dati locali Travel Companion · nessuna basemap attiva';
export const MAP_FALLBACK_MESSAGE = 'Cartografia offline non scaricata';

export function hasCoordinates(node: Pick<LocationNode, 'latitude' | 'longitude'> | undefined): node is LocationNode & { latitude: number; longitude: number } {
  return Boolean(node && Number.isFinite(node.latitude) && Number.isFinite(node.longitude));
}

export function locationNodeForActivity(activity: Activity, index = 0): LocationNode {
  const place = activity.place;
  return ensureLocationNode({
    id: nodeIdForActivity(activity, index),
    label: activity.title,
    type: 'activity',
    address: place?.address,
    city: place?.city,
    country: place?.country,
    timezone: place?.timezone,
    latitude: place?.latitude,
    longitude: place?.longitude,
    placeId: place?.placeId,
    osmId: place?.placeId?.startsWith('osm-') ? place.placeId : undefined,
    source: place?.source,
    updatedAt: place?.updatedAt,
    reliabilityStatus: place?.geoStatus === 'CONFIRMED' ? 'VERIFIED' : place?.geoStatus === 'ESTIMATED' ? 'ESTIMATED' : place?.geoStatus === 'DEMO' ? 'DEMO' : place?.geoStatus === 'TO_VERIFY' ? 'TO_VERIFY' : 'MISSING',
    geoStatus: place?.geoStatus ?? 'MISSING',
  }, activity.title, nodeIdForActivity(activity, index));
}

export function collectItineraryNodes(itinerary: Itinerary): Array<LocationNode & { day?: number }> {
  const seen = new Set<string>();
  const nodes: Array<LocationNode & { day?: number }> = [];
  const add = (node: LocationNode | undefined, day?: number) => {
    if (!node || seen.has(node.id)) return;
    seen.add(node.id);
    nodes.push({ ...node, day });
  };

  [itinerary.destinationNode, itinerary.departurePoint, itinerary.arrivalPoint, itinerary.arrivalDestinationPoint, itinerary.returnPoint].forEach((node) => add(node));
  collectPlanNodes(itinerary.days, itinerary.interurbanRoutes ?? []).forEach((node) => add(node));
  itinerary.days.forEach((day) => day.activities.forEach((activity, index) => add(locationNodeForActivity(activity, index), day.day)));
  return nodes;
}

function mapMarker(node: LocationNode & { day?: number }): MapMarker | null {
  if (!hasCoordinates(node)) return null;
  return {
    id: `marker-${node.id}`,
    nodeId: node.id,
    label: node.label,
    type: node.type,
    day: (node as LocationNode & { day?: number }).day,
    latitude: node.latitude,
    longitude: node.longitude,
    source: node.source ?? 'Fonte non disponibile',
    reliabilityStatus: node.reliabilityStatus ?? 'MISSING',
    updatedAt: node.updatedAt,
  };
}

function mapRouteLink(segment: RouteSegment): MapRouteLink | null {
  if (!hasCoordinates(segment.origin) || !hasCoordinates(segment.destination)) return null;
  if (segment.geometry?.kind !== 'route' || !segment.geometry.coordinates?.length) return null;
  return {
    id: `map-link-${segment.id}`,
    segmentId: segment.id,
    fromNodeId: segment.fromNodeId,
    toNodeId: segment.toNodeId,
    day: segment.day,
    order: segment.order,
    mode: segment.recommendedMode,
    duration: segment.duration,
    distance: segment.distance,
    source: segment.source ?? 'Fonte non disponibile',
    reliabilityStatus: segment.reliability,
    note: segment.note,
    geometry: segment.geometry,
  };
}

function mapSignature(markers: MapMarker[], routeLinks: MapRouteLink[]): string {
  return JSON.stringify({
    markers: markers.map((marker) => [marker.nodeId, marker.latitude, marker.longitude, marker.day]),
    links: routeLinks.map((link) => [link.segmentId, link.fromNodeId, link.toNodeId, link.geometry?.coordinates]),
  });
}

export function deriveMapSnapshot(itinerary: Itinerary, previous?: MapSnapshot): MapSnapshot {
  const markers = collectItineraryNodes(itinerary)
    .map(mapMarker)
    .filter((marker): marker is MapMarker => marker !== null)
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const allRouteLinks = [...itinerary.days.flatMap((day) => day.segments ?? []), ...(itinerary.interurbanRoutes ?? [])]
    .map((segment) => mapRouteLink(segment))
    .filter((link): link is MapRouteLink => link !== null)
    .sort((a, b) => a.day - b.day || a.order - b.order || a.segmentId.localeCompare(b.segmentId));
  const routeLinks = Array.from(new Map(allRouteLinks.map((link) => [
    `${link.day}:${link.order}:${link.fromNodeId}:${link.toNodeId}:${link.mode}:${JSON.stringify(link.geometry?.coordinates ?? [])}`,
    link,
  ])).values());
  const signature = mapSignature(markers, routeLinks);
  const unchanged = previous?.signature === signature;
  return {
    version: 1,
    signature,
    updatedAt: unchanged ? previous?.updatedAt : undefined,
    provider: process.env.EXPO_PUBLIC_MAPTILER_KEY?.trim() ? 'MapTiler' : 'Locale',
    markers,
    routeLinks,
    offline: previous?.offline ?? {
      status: 'NOT_DOWNLOADED',
      areas: [],
      note: 'Cartografia offline non scaricata. Itinerario, nodi e tratte restano disponibili localmente.',
    },
  };
}

function emptyOfflineSnapshot(previous?: MapSnapshot): MapSnapshot['offline'] {
  return previous?.offline ?? {
    status: 'NOT_DOWNLOADED',
    areas: [],
    note: 'Cartografia offline non scaricata. Itinerario, nodi e tratte restano disponibili localmente.',
  };
}

function orderedDayNodes(itinerary: Itinerary, dayNumber: number): LocationNode[] {
  const day = itinerary.days.find((item) => item.day === dayNumber);
  if (!day) return [];
  const seen = new Set<string>();
  const result: LocationNode[] = [];
  const add = (node: LocationNode | undefined) => {
    if (!node || seen.has(node.id)) return;
    seen.add(node.id);
    result.push(node);
  };

  // La destinazione è il contesto geografico della giornata: può essere l'unico
  // nodo con coordinate mentre le singole attività restano da definire.
  add(itinerary.destinationNode);
  const remaining = [...(day.segments ?? [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const activityIds = new Set(day.activities.map((activity, index) => locationNodeForActivity(activity, index).id));
  const automaticArrivalTitles = new Set(['Arrivo nella destinazione', 'Check-in o deposito bagagli']);
  const addRoute = (segment: RouteSegment | undefined) => {
    if (!segment) return;
    add(segment.origin);
    add(segment.destination);
  };
  day.activities.forEach((activity, index) => {
    if (automaticArrivalTitles.has(activity.title)) add(locationNodeForActivity(activity, index));
  });
  const leadingRouteIndex = remaining.findIndex((segment) => segment.origin.id === day.origin?.id && !activityIds.has(segment.destination.id));
  if (leadingRouteIndex >= 0) addRoute(remaining.splice(leadingRouteIndex, 1)[0]);
  day.activities.forEach((activity, index) => {
    if (automaticArrivalTitles.has(activity.title)) return;
    const node = locationNodeForActivity(activity, index);
    const inboundRouteIndex = remaining.findIndex((segment) => segment.toNodeId === node.id);
    if (inboundRouteIndex >= 0) addRoute(remaining.splice(inboundRouteIndex, 1)[0]);
    add(node);
  });
  remaining.forEach(addRoute);
  add(day.origin);
  add(day.finalDestination);
  return result;
}

/**
 * Deriva la mappa operativa del singolo giorno senza rigenerare l'itinerario.
 * I marker ricevono una sequenza visiva stabile e le tratte senza geometria
 * restano disponibili nella timeline, ma non vengono disegnate come percorsi.
 */
export function deriveDayMapSnapshot(itinerary: Itinerary, dayNumber: number, previous?: MapSnapshot): MapSnapshot {
  const day = itinerary.days.find((item) => item.day === dayNumber);
  const markers = orderedDayNodes(itinerary, dayNumber)
    .map(mapMarker)
    .filter((marker): marker is MapMarker => marker !== null)
    .map((marker, index) => ({ ...marker, day: dayNumber, sequence: index + 1 }));
  const routeLinks = (day?.segments ?? [])
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((segment) => mapRouteLink(segment))
    .filter((link): link is MapRouteLink => link !== null);
  const signature = mapSignature(markers, routeLinks);
  const unchanged = previous?.signature === signature;
  return {
    version: 1,
    signature,
    updatedAt: unchanged ? previous?.updatedAt : undefined,
    provider: process.env.EXPO_PUBLIC_MAPTILER_KEY?.trim() ? 'MapTiler' : 'Locale',
    markers,
    routeLinks,
    offline: emptyOfflineSnapshot(previous),
  };
}

export function synchronizeItineraryMap(itinerary: Itinerary, updatedAt?: string): Itinerary {
  const mapSnapshot = deriveMapSnapshot(itinerary, itinerary.mapSnapshot);
  const current = itinerary.mapSnapshot;
  const isChanged = current?.signature !== mapSnapshot.signature;
  return {
    ...itinerary,
    mapSnapshot: {
      ...mapSnapshot,
      updatedAt: isChanged ? updatedAt ?? current?.updatedAt : current?.updatedAt,
    },
  };
}

export function filterMapSnapshot(snapshot: MapSnapshot, mode: MapViewMode, day?: number): MapSnapshot {
  if (mode === 'trip') return snapshot;
  const selectedDays = mode === 'day' || mode === 'activities'
    ? new Set(day ? [day] : [])
    : new Set(snapshot.markers.filter((marker) => marker.type === 'airport' || marker.type === 'station' || marker.type === 'port').map((marker) => marker.day).filter((value): value is number => value !== undefined));
  const markers = snapshot.markers.filter((marker) => mode === 'arrival-return'
    ? marker.type === 'airport' || marker.type === 'station' || marker.type === 'port' || marker.type === 'accommodation'
    : selectedDays.has(marker.day ?? -1));
  const markerIds = new Set(markers.map((marker) => marker.nodeId));
  const routeLinks = snapshot.routeLinks.filter((link) => mode === 'arrival-return'
    ? markerIds.has(link.fromNodeId) || markerIds.has(link.toNodeId)
    : selectedDays.has(link.day));
  return { ...snapshot, markers, routeLinks };
}