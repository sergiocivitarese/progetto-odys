import type { Itinerary, ItinerarySnapshot, SavedTrip } from '../types/travel';
import { ensureLocationNode, normalizeDayRouteModel } from './routeModel';
import { synchronizeItineraryMap } from './mapModel';
import { normalizeWeatherRecords } from './weather';

/**
 * Regole di persistenza dei viaggi salvati, portate da `hooks/useSavedTrip.ts`
 * del progetto Triply. Sono indipendenti dallo storage: il backend le usa sul
 * proprio repository.
 */
export const PLAN_VERSION = 5;

export function createTripId(): string {
  return `${Date.now().toString()}-${Math.random().toString(36).slice(2, 11)}`;
}

function now(): string {
  return new Date().toISOString();
}

function migrateSnapshot(snapshot: ItinerarySnapshot): ItinerarySnapshot {
  const legacyBudget = snapshot.budget?.trim();
  const budgetPerTraveler = snapshot.budgetPerTraveler?.trim() || legacyBudget || 'budget flessibile';
  const normalizedActivities = (activity: ItinerarySnapshot['days'][number]['activities'][number]) => ({
    ...activity,
    transport: activity.transport ?? snapshot.transport,
    setting: activity.setting ?? 'outdoor',
    requiresBooking: activity.requiresBooking ?? false,
    place: activity.place ?? {
      id: `legacy-${activity.title.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}`,
      title: activity.title,
      city: snapshot.destination,
      source: 'Piano locale migrato',
      updatedAt: now(),
      geoStatus: 'MISSING' as const,
      category: activity.category,
      whyRecommended: 'Attività migrata da un piano precedente.',
    },
  });
  return {
    ...snapshot,
    departure: snapshot.departure ?? '',
    returnDate: snapshot.returnDate ?? '',
    arrivalTime: snapshot.arrivalTime,
    departureTime: snapshot.departureTime,
    travelers: snapshot.travelers ?? '',
    budget: legacyBudget ?? budgetPerTraveler,
    budgetPerTraveler,
    budgetReliability: snapshot.budgetReliability ?? (snapshot.budgetPerTraveler ? 'USER_ENTERED' : 'TO_VERIFY'),
    interests: snapshot.interests ?? ['Cibo', 'Natura', 'Storia'],
    customInterests: snapshot.customInterests ?? [],
    constraints: snapshot.constraints ?? '',
    stops: snapshot.stops ?? [],
    lodging: snapshot.lodging ?? {},
    arrivalTransport: snapshot.arrivalTransport,
    departurePoint: snapshot.departurePoint ? ensureLocationNode(snapshot.departurePoint, 'Punto di partenza') : undefined,
    arrivalPoint: snapshot.arrivalPoint ? ensureLocationNode(snapshot.arrivalPoint, 'Punto di arrivo') : undefined,
    arrivalDayOffset: snapshot.arrivalDayOffset,
    arrivalDate: snapshot.arrivalDate,
    arrivalDestinationKind: snapshot.arrivalDestinationKind,
    arrivalDestinationPoint: snapshot.arrivalDestinationPoint ? ensureLocationNode(snapshot.arrivalDestinationPoint, 'Prima destinazione') : undefined,
    destinationNode: snapshot.destinationNode ? ensureLocationNode(snapshot.destinationNode, snapshot.destination || 'Destinazione') : undefined,
    returnTransport: snapshot.returnTransport,
    returnPoint: snapshot.returnPoint ? ensureLocationNode(snapshot.returnPoint, 'Punto di rientro') : undefined,
    days: Array.isArray(snapshot.days) ? snapshot.days.map((day, index) => normalizeDayRouteModel({
      ...day,
      activities: Array.isArray(day.activities) ? day.activities.map(normalizedActivities) : [],
    }, index)) : [],
    nextSteps: Array.isArray(snapshot.nextSteps) ? snapshot.nextSteps : [],
    planningMode: snapshot.planningMode ?? 'initial',
    routeSummary: snapshot.routeSummary ?? 'Pianificazione iniziale: percorsi da completare localmente',
    interurbanRoutes: Array.isArray(snapshot.interurbanRoutes) ? snapshot.interurbanRoutes : [],
    weather: normalizeWeatherRecords(snapshot.weather),
    version: PLAN_VERSION,
  };
}

export function migrateItinerary(itinerary: Itinerary): Itinerary {
  const migrated = migrateSnapshot(itinerary);
  return {
    ...synchronizeItineraryMap(migrated, itinerary.mapSnapshot?.updatedAt),
    original: itinerary.original ? migrateSnapshot(itinerary.original) : itinerary.original,
  };
}

export function asSavedTrip(value: unknown): SavedTrip | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SavedTrip>;
  if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string') return null;
  if (!candidate.itinerary || typeof candidate.itinerary !== 'object') return null;
  const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : now();
  return {
    id: candidate.id,
    title: candidate.title,
    itinerary: migrateItinerary(candidate.itinerary as Itinerary),
    createdAt,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : createdAt,
    planVersion: typeof candidate.planVersion === 'number' ? candidate.planVersion : PLAN_VERSION,
  };
}

export function asSavedTrips(value: unknown): SavedTrip[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(asSavedTrip).filter((item): item is SavedTrip => item !== null);
}

/** Ordina per ultima modifica e rimuove duplicati per id. */
export function sortSavedTrips(trips: SavedTrip[]): SavedTrip[] {
  const ordered = [...trips].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? '') || 0;
    const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? '') || 0;
    return bTime - aTime;
  });
  const ids = new Set<string>();
  return ordered.filter((trip) => {
    if (ids.has(trip.id)) return false;
    ids.add(trip.id);
    return true;
  });
}

/** Crea o aggiorna un viaggio salvato (equivalente di `save` nel vecchio hook). */
export function upsertSavedTrip(current: SavedTrip[], itinerary: Itinerary, tripId?: string, title?: string): { trip: SavedTrip; trips: SavedTrip[] } {
  const existing = tripId ? current.find((trip) => trip.id === tripId) : undefined;
  const timestamp = now();
  const trip: SavedTrip = {
    id: existing?.id ?? tripId ?? createTripId(),
    title: title?.trim() || existing?.title || itinerary.destination,
    itinerary: migrateItinerary(itinerary),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    planVersion: PLAN_VERSION,
  };
  return { trip, trips: sortSavedTrips([trip, ...current.filter((item) => item.id !== trip.id)]) };
}
