import type { Activity, ActivityStatus, DayPlan, LocationNode, RouteSegment, Transport } from '@/types/travel';

export const LOCAL_ROUTE_SOURCE = 'Piano locale Travel Companion · nessun provider collegato';

export function slugForNode(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('it')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || 'definito';
}

export function nodeIdForLabel(label: string, namespace = 'node'): string {
  return `${namespace}-${slugForNode(label)}`;
}

export function nodeIdForActivity(activity: Activity, index = 0): string {
  if (activity.nodeId?.trim()) return activity.nodeId;
  const placeKey = activity.place?.placeId || activity.place?.id;
  return placeKey ? `activity-${slugForNode(placeKey)}` : activity.id?.trim()
    ? `activity-${slugForNode(activity.id)}`
    : nodeIdForLabel(`${activity.title}-${index}`, 'activity');
}

export function activityIdFor(activity: Partial<Activity>, dayId: string, index: number): string {
  if (activity.id?.trim()) return activity.id;
  const placeKey = activity.place?.placeId || activity.place?.id || activity.title || 'attivita';
  return `activity-${slugForNode(`${dayId}-${placeKey}-${index + 1}`)}`;
}

export function activityStatusFor(activity: Partial<Activity>): ActivityStatus {
  if (activity.completed) return 'COMPLETED';
  if (activity.status) return activity.status;
  const status = activity.place?.geoStatus;
  if (status === 'CONFIRMED') return 'CONFIRMED';
  if (status === 'DEMO' || status === 'ESTIMATED') return 'SIMULATED';
  if (status === 'TO_VERIFY') return 'TO_VERIFY';
  if (status === 'UNAVAILABLE_OFFLINE') return 'OFFLINE';
  if (status === 'MISSING') return 'MISSING';
  return 'TO_DEFINE';
}

export function normalizeActivity(
  activity: Partial<Activity>,
  dayId: string,
  index: number,
  defaultTransport?: Transport,
): Activity {
  const id = activityIdFor(activity, dayId, index);
  const base = { ...activity, id };
  return {
    ...base,
    dayId: activity.dayId ?? dayId,
    order: index,
    time: activity.time ?? 'Orario non inserito',
    title: activity.title?.trim() || 'Attività da definire',
    detail: activity.detail ?? '',
    category: activity.category ?? 'Storia',
    transport: activity.transport ?? defaultTransport,
    setting: activity.setting ?? 'outdoor',
    requiresBooking: activity.requiresBooking ?? false,
    nodeId: nodeIdForActivity(base as Activity, index),
    status: activityStatusFor(base),
    updatedAt: activity.updatedAt ?? new Date().toISOString(),
  };
}

export function ensureLocationNode(
  value: Partial<LocationNode> | null | undefined,
  fallbackLabel: string,
  fallbackId = nodeIdForLabel(fallbackLabel),
): LocationNode {
  const label = typeof value?.label === 'string' && value.label.trim() ? value.label.trim() : fallbackLabel;
  const geoStatus = value?.geoStatus ?? 'MISSING';
  return {
    ...value,
    id: typeof value?.id === 'string' && value.id.trim() ? value.id : fallbackId,
    label,
    type: value?.type ?? 'undefined',
    city: value?.city ?? '',
    country: value?.country ?? '',
    source: value?.source ?? LOCAL_ROUTE_SOURCE,
    reliabilityStatus: value?.reliabilityStatus ?? (geoStatus === 'MISSING' ? 'MISSING' : 'TO_VERIFY'),
    geoStatus,
  };
}

export function normalizeRouteSegment(value: Partial<RouteSegment> | null | undefined, day: number, order: number): RouteSegment | null {
  if (!value || typeof value !== 'object') return null;
  const originValue = value.origin;
  const destinationValue = value.destination;
  if (!originValue?.label?.trim() || !destinationValue?.label?.trim()) return null;
  const origin = ensureLocationNode(originValue, 'Origine da definire');
  const destination = ensureLocationNode(destinationValue, 'Destinazione da definire');
  const id = typeof value.id === 'string' && value.id.trim()
    ? value.id
    : `route-${day}-${order}-${origin.id}-${destination.id}`;
  const reliability = value.reliability ?? value.status ?? 'MISSING';
  return {
    ...value,
    id,
    day: typeof value.day === 'number' ? value.day : day,
    order: typeof value.order === 'number' ? value.order : order,
    fromNodeId: origin.id,
    toNodeId: destination.id,
    origin,
    destination,
    type: value.type ?? 'intracity',
    recommendedMode: value.recommendedMode ?? 'altro',
    alternatives: Array.isArray(value.alternatives) ? value.alternatives : [],
    duration: value.duration,
    distance: value.distance,
    cost: value.cost ?? 'Costo da definire',
    changes: value.changes ?? 'Da definire',
    comfort: value.comfort ?? 'Da definire',
    weatherImpact: value.weatherImpact ?? 'Da valutare',
    reliability,
    status: value.status ?? reliability,
    note: value.note ?? 'Tratta da definire: verifica origine, destinazione e dati locali.',
    source: value.source ?? LOCAL_ROUTE_SOURCE,
    provider: value.provider,
    updatedAt: value.updatedAt,
    lastCalculatedAt: value.lastCalculatedAt,
    geometry: value.geometry && Array.isArray(value.geometry.coordinates)
      ? { ...value.geometry, coordinates: value.geometry.coordinates.filter((coordinate): coordinate is [number, number] => Array.isArray(coordinate) && Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1])) }
      : undefined,
  };
}

export function normalizeDayRouteModel(day: Partial<DayPlan>, index: number): DayPlan {
  const dayNumber = typeof day.day === 'number' ? day.day : index + 1;
  const dayId = `day-${day.date ?? dayNumber}`;
  const activities = Array.isArray(day.activities)
    ? day.activities.map((activity, activityIndex) => normalizeActivity(activity, dayId, activityIndex))
    : [];
  const lastTitle = activities[activities.length - 1]?.title ?? 'Destinazione da definire';
  return {
    ...day,
    day: dayNumber,
    date: day.date ?? '',
    label: day.label ?? `Giornata ${index + 1}`,
    activities,
    rainyAlternative: day.rainyAlternative ?? 'Alternativa al coperto da definire',
    tiredAlternative: day.tiredAlternative ?? 'Rientro anticipato da definire',
    origin: ensureLocationNode(day.origin, 'Origine da definire', 'undefined-origin'),
    finalDestination: ensureLocationNode(day.finalDestination, lastTitle, `final-${index + 1}`),
    segments: (Array.isArray(day.segments) ? day.segments : [])
      .map((segment, segmentIndex) => normalizeRouteSegment(segment, typeof day.day === 'number' ? day.day : index + 1, segmentIndex))
      .filter((segment): segment is RouteSegment => segment !== null),
  };
}

export function collectPlanNodes(days: DayPlan[], interurbanRoutes: RouteSegment[] = []): LocationNode[] {
  const result: LocationNode[] = [];
  const seen = new Set<string>();
  const add = (node: LocationNode | undefined) => {
    if (!node || seen.has(node.id)) return;
    seen.add(node.id);
    result.push(node);
  };
  days.forEach((day) => {
    add(day.origin);
    add(day.finalDestination);
    day.segments?.forEach((segment) => {
      add(segment.origin);
      add(segment.destination);
    });
  });
  interurbanRoutes.forEach((segment) => {
    add(segment.origin);
    add(segment.destination);
  });
  return result;
}

export function validateRouteGraph(days: DayPlan[], interurbanRoutes: RouteSegment[] = []): string[] {
  const errors: string[] = [];
  const nodes = new Set(collectPlanNodes(days, interurbanRoutes).map((node) => node.id));
  [...days.flatMap((day) => day.segments ?? []), ...interurbanRoutes].forEach((segment) => {
    if (!nodes.has(segment.fromNodeId) || !nodes.has(segment.toNodeId)) errors.push(`Tratta ${segment.id} collega nodi inesistenti.`);
    if (segment.origin.id !== segment.fromNodeId || segment.destination.id !== segment.toNodeId) errors.push(`Tratta ${segment.id} ha riferimenti ai nodi incoerenti.`);
  });
  return errors;
}