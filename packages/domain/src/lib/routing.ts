import type { LocationNode, RouteSegment, Transport } from '../types/travel';

const GRAPHHOPPER_URL = 'https://graphhopper.com/api/1/route';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Mezzi per cui il routing online è disponibile (a piedi, auto, stima taxi). */
export function isRoutableMode(mode: Transport): boolean {
  return mode === 'a piedi' || mode === 'auto' || mode === 'taxi';
}

/**
 * Calcola una tratta con GraphHopper. Restituisce null se il mezzo non è
 * supportato, mancano coordinate o chiave, o il provider non risponde.
 */
export async function calculateGraphHopperRoute(
  origin: LocationNode,
  destination: LocationNode,
  mode: Transport,
  apiKey = '',
  fetcher: FetchLike = fetch,
): Promise<Partial<RouteSegment> | null> {
  if (!isRoutableMode(mode) || !Number.isFinite(origin.latitude) || !Number.isFinite(origin.longitude) || !Number.isFinite(destination.latitude) || !Number.isFinite(destination.longitude)) return null;
  const key = apiKey.trim();
  if (!key) return null;
  const profile = mode === 'a piedi' ? 'foot' : 'car';
  try {
    const url = `${GRAPHHOPPER_URL}?point=${origin.latitude},${origin.longitude}&point=${destination.latitude},${destination.longitude}&profile=${profile}&locale=it&calc_points=true&points_encoded=false&key=${encodeURIComponent(key)}`;
    const response = await fetcher(url);
    if (!response.ok) return null;
    const data = await response.json() as { paths?: Array<{ distance?: number; time?: number; points?: { coordinates?: Array<[number, number]> } }> };
    const path = data.paths?.[0];
    if (!path || !Number.isFinite(path.distance) || !Number.isFinite(path.time)) return null;
    return {
      provider: 'GraphHopper',
      source: 'GraphHopper · dati OpenStreetMap',
      recommendedMode: mode,
      duration: `${Math.max(1, Math.round((path.time ?? 0) / 60000))} min`,
      distance: `${((path.distance ?? 0) / 1000).toFixed(1)} km`,
      reliability: 'VERIFIED',
      status: 'VERIFIED',
      lastCalculatedAt: new Date().toISOString(),
      geometry: path.points?.coordinates?.length ? { kind: 'route', coordinates: path.points.coordinates } : undefined,
      note: mode === 'taxi' ? 'Stima taxi basata sul profilo auto; disponibilità e tariffa non sono verificate.' : 'Percorso calcolato dal provider.',
    };
  } catch {
    return null;
  }
}

const OSRM_PUBLIC_URL = 'https://routing.openstreetmap.de';

/**
 * Alternativa gratuita a GraphHopper: OSRM sui server pubblici OpenStreetMap
 * (FOSSGIS), senza chiave e per un uso moderato. Profili a piedi e auto.
 */
export async function calculateOsrmRoute(
  origin: LocationNode,
  destination: LocationNode,
  mode: Transport,
  options: { baseUrl?: string; userAgent?: string } = {},
  fetcher: FetchLike = fetch,
): Promise<Partial<RouteSegment> | null> {
  if (!isRoutableMode(mode) || !Number.isFinite(origin.latitude) || !Number.isFinite(origin.longitude) || !Number.isFinite(destination.latitude) || !Number.isFinite(destination.longitude)) return null;
  const profile = mode === 'a piedi' ? 'routed-foot' : 'routed-car';
  const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  try {
    const headers: Record<string, string> = options.userAgent ? { 'User-Agent': options.userAgent } : {};
    const response = await fetcher(`${options.baseUrl ?? OSRM_PUBLIC_URL}/${profile}/route/v1/driving/${coordinates}?overview=full&geometries=geojson`, { headers, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const data = await response.json() as { code?: string; routes?: Array<{ distance?: number; duration?: number; geometry?: { coordinates?: Array<[number, number]> } }> };
    const route = data.code === 'Ok' ? data.routes?.[0] : undefined;
    if (!route || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) return null;
    return {
      provider: 'OSRM',
      source: 'OSRM · dati OpenStreetMap (routing.openstreetmap.de)',
      recommendedMode: mode,
      duration: `${Math.max(1, Math.round((route.duration ?? 0) / 60))} min`,
      distance: `${((route.distance ?? 0) / 1000).toFixed(1)} km`,
      reliability: 'VERIFIED',
      status: 'VERIFIED',
      lastCalculatedAt: new Date().toISOString(),
      geometry: route.geometry?.coordinates?.length ? { kind: 'route', coordinates: route.geometry.coordinates } : undefined,
      note: mode === 'taxi' ? 'Stima taxi basata sul profilo auto; disponibilità e tariffa non sono verificate.' : 'Percorso calcolato su dati OpenStreetMap.',
    };
  } catch {
    return null;
  }
}

export function patchRouteInPlan<T extends { days: Array<{ segments?: RouteSegment[] }>; interurbanRoutes?: RouteSegment[] }>(plan: T, routeId: string, patch: Partial<RouteSegment>): T {
  return {
    ...plan,
    days: plan.days.map((day) => ({ ...day, segments: day.segments?.map((segment) => segment.id === routeId ? { ...segment, ...patch } : segment) })),
    interurbanRoutes: plan.interurbanRoutes?.map((segment) => segment.id === routeId ? { ...segment, ...patch } : segment),
  };
}
