import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Itinerary, ItinerarySnapshot, SavedTrip } from '@/types/travel';
import { ensureLocationNode, normalizeDayRouteModel } from '@/lib/routeModel';
import { synchronizeItineraryMap } from '@/lib/mapModel';
import { normalizeWeatherRecords } from '@/lib/weather';

export const STORAGE_KEY = 'travel_companion_trips_v5';
const LEGACY_V4_KEY = 'travel_companion_trips_v4';
const LEGACY_COLLECTION_KEY = 'travel-companion:saved-trips';
const LEGACY_STORAGE_KEY = 'travel-companion:saved-trip';
const PLAN_VERSION = 5;

function createId(): string {
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

function migrateItinerary(itinerary: Itinerary): Itinerary {
  const migrated = migrateSnapshot(itinerary);
  return {
    ...synchronizeItineraryMap(migrated, itinerary.mapSnapshot?.updatedAt),
    original: itinerary.original ? migrateSnapshot(itinerary.original) : itinerary.original,
  };
}

function asSavedTrip(value: unknown): SavedTrip | null {
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

function asSavedTrips(value: unknown): SavedTrip[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(asSavedTrip).filter((item): item is SavedTrip => item !== null);
}

function migrateLegacy(raw: string | null): SavedTrip[] {
  if (!raw) return [];
  try {
    const itinerary = JSON.parse(raw) as Itinerary;
    if (!itinerary || typeof itinerary !== 'object' || typeof itinerary.destination !== 'string') return [];
    const timestamp = now();
    return [{
      id: createId(),
      title: itinerary.destination,
      itinerary: synchronizeItineraryMap(migrateItinerary(itinerary), timestamp),
      createdAt: timestamp,
      updatedAt: timestamp,
      planVersion: PLAN_VERSION,
    }];
  } catch {
    return [];
  }
}

function parseSavedTrips(raw: string | null): SavedTrip[] | null {
  if (!raw) return null;
  try {
    return asSavedTrips(JSON.parse(raw));
  } catch {
    return null;
  }
}

function normalizeTrips(trips: SavedTrip[]): SavedTrip[] {
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

function readBrowserTrips(): SavedTrip[] {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return [];
  const stored = parseSavedTrips(window.localStorage.getItem(STORAGE_KEY));
  if (stored) return normalizeTrips(stored);

  const legacyV4 = parseSavedTrips(window.localStorage.getItem(LEGACY_V4_KEY));
  const legacyCollection = parseSavedTrips(window.localStorage.getItem(LEGACY_COLLECTION_KEY));
  const migrated = legacyV4 ?? legacyCollection ?? migrateLegacy(window.localStorage.getItem(LEGACY_STORAGE_KEY));
  if (migrated.length > 0) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeTrips(migrated)));
    window.localStorage.removeItem(LEGACY_V4_KEY);
    window.localStorage.removeItem(LEGACY_COLLECTION_KEY);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
  return normalizeTrips(migrated);
}

async function readNativeTrips(): Promise<SavedTrip[]> {
  const stored = parseSavedTrips(await AsyncStorage.getItem(STORAGE_KEY));
  if (stored) return normalizeTrips(stored);

  const legacyV4 = parseSavedTrips(await AsyncStorage.getItem(LEGACY_V4_KEY));
  const legacyCollection = parseSavedTrips(await AsyncStorage.getItem(LEGACY_COLLECTION_KEY));
  const migrated = legacyV4 ?? legacyCollection ?? migrateLegacy(await AsyncStorage.getItem(LEGACY_STORAGE_KEY));
  if (migrated.length > 0) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeTrips(migrated)));
    await AsyncStorage.removeItem(LEGACY_V4_KEY);
    await AsyncStorage.removeItem(LEGACY_COLLECTION_KEY);
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
  }
  return normalizeTrips(migrated);
}

async function readTrips(): Promise<SavedTrip[]> {
  return Platform.OS === 'web' ? readBrowserTrips() : readNativeTrips();
}

async function writeTrips(trips: SavedTrip[]): Promise<void> {
  const serialized = JSON.stringify(normalizeTrips(trips));
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, serialized);
  } else {
    await AsyncStorage.setItem(STORAGE_KEY, serialized);
  }
}

export function sortSavedTrips(trips: SavedTrip[]): SavedTrip[] {
  return normalizeTrips(trips);
}

export function useSavedTrip() {
  const [trips, setTrips] = useState<SavedTrip[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setTrips(await readTrips());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (itinerary: Itinerary, tripId?: string, title?: string): Promise<SavedTrip> => {
    const current = await readTrips();
    const existing = tripId ? current.find((trip) => trip.id === tripId) : undefined;
    const timestamp = now();
    const savedTrip: SavedTrip = {
      id: existing?.id ?? tripId ?? createId(),
      title: title?.trim() || existing?.title || itinerary.destination,
      itinerary: migrateItinerary(itinerary),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      planVersion: PLAN_VERSION,
    };
    const next = normalizeTrips([savedTrip, ...current.filter((trip) => trip.id !== savedTrip.id)]);
    await writeTrips(next);
    setTrips(next);
    return savedTrip;
  }, []);

  const remove = useCallback(async (tripId: string) => {
    const next = (await readTrips()).filter((trip) => trip.id !== tripId);
    await writeTrips(next);
    setTrips(next);
  }, []);

  const rename = useCallback(async (tripId: string, title: string) => {
    const timestamp = now();
    const next = (await readTrips()).map((trip) => trip.id === tripId
      ? { ...trip, title: title.trim(), updatedAt: timestamp }
      : trip);
    await writeTrips(next);
    setTrips(next);
  }, []);

  return { trips, loading, save, remove, rename, refresh };
}