import type { LocationNode, RouteSegment, Transport } from '@/types/travel';
import { GeocodingClient, type GeocodingResult } from '@/lib/geocoding';

const GRAPHHOPPER_URL = 'https://graphhopper.com/api/1/route';
const geocodingClient = new GeocodingClient();

export function mapTilerStyleUrl(): string | null {
  const key = process.env.EXPO_PUBLIC_MAPTILER_KEY?.trim();
  return key ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(key)}` : null;
}

export async function searchGeoapifyPlaces(query: string): Promise<{ nodes: LocationNode[]; message?: string; result: GeocodingResult }> {
  const result = await geocodingClient.searchInteractive(query, { language: 'it', type: 'custom' });
  return { nodes: result.candidates, message: result.message, result };
}

export async function calculateGraphHopperRoute(origin: LocationNode, destination: LocationNode, mode: Transport): Promise<Partial<RouteSegment> | null> {
  if ((mode !== 'a piedi' && mode !== 'auto' && mode !== 'taxi') || !Number.isFinite(origin.latitude) || !Number.isFinite(origin.longitude) || !Number.isFinite(destination.latitude) || !Number.isFinite(destination.longitude)) return null;
  const key = process.env.EXPO_PUBLIC_GRAPHHOPPER_KEY?.trim();
  if (!key) return null;
  const profile = mode === 'a piedi' ? 'foot' : 'car';
  try {
    const url = `${GRAPHHOPPER_URL}?point=${origin.latitude},${origin.longitude}&point=${destination.latitude},${destination.longitude}&profile=${profile}&locale=it&calc_points=true&key=${encodeURIComponent(key)}`;
    const response = await fetch(url);
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