import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { RouteMapPreview } from '@/components/RouteMapPreview';
import { WeatherCard } from '@/components/WeatherCard';
import { EmptyState, Header, Button, InfoRow, SectionTitle, Pill, StatusBadge, type DataState } from '@/components/TravelUI';
import { demoPlaces, placeForActivity } from '@/data/places';
import { useColors } from '@/hooks/useColors';
import {
  calculateDuration,
  parseBudgetAmount,
  parseTravelerCount,
  generateItinerary,
  mergeItineraryDaysForDateChange,
  parseCalendarDate,
  parseTime,
  recalculateDayRoutes,
  recalculateRoutes,
  validateArrivalDate,
  validateDateRange,
  validateSchedule,
  validateTime,
} from '@/lib/generateItinerary';
import { useSavedTrip } from '@/hooks/useSavedTrip';
import { activityStatusFor, ensureLocationNode, nodeIdForActivity, nodeIdForLabel, normalizeActivity, normalizeDayRouteModel, normalizeRouteSegment } from '@/lib/routeModel';
import { applyRepositioning, proposeRepositioning, type RepositionSuggestion } from '@/lib/repositioning';
import { calculateGraphHopperRoute } from '@/lib/locationServices';
import { applyGeoCandidate, enrichItineraryGeography, GeocodingClient, type GeoEnrichmentIssue } from '@/lib/geocoding';
import { synchronizeItineraryMap } from '@/lib/mapModel';
import { serializeTripExport } from '@/lib/tripTransfer';
import { WeatherClient, normalizeWeatherRecords, weatherAlerts, weatherKey, weatherRequestForDay } from '@/lib/weather';
import type {
  Activity,
  ActivitySetting,
  ActivityStatus,
  ActivityTransport,
  ArrivalTransport,
  Itinerary,
  ItinerarySnapshot,
  LodgingInfo,
  LocationNode,
  MapSnapshot,
  MapViewMode,
  RouteSegment,
  Transport,
  TripForm,
  WeatherSnapshot,
} from '@/types/travel';

const fallback: Itinerary = generateItinerary({
  destination: 'Lisbona',
  departure: '2026-09-12',
  returnDate: '2026-09-16',
  arrivalTime: '15:30',
  departureTime: '11:00',
  travelers: '2',
  budget: '800€',
  budgetPerTraveler: '800€',
  pace: 'equilibrato',
  interests: ['Cibo', 'Natura', 'Storia'],
  customInterests: [],
  constraints: '',
  transport: 'misto',
  stops: [],
  lodging: {},
});

const tripTransportOptions: Transport[] = ['a piedi', 'trasporto pubblico', 'treno', 'autobus', 'auto', 'taxi', 'aereo', 'traghetto', 'misto'];
const activityTransportOptions: ActivityTransport[] = ['a piedi', 'trasporto pubblico', 'treno', 'autobus', 'taxi', 'auto', 'aereo', 'traghetto'];
const settingOptions: ActivitySetting[] = ['indoor', 'outdoor'];
const transportLabels: Record<ActivityTransport, string> = {
  'a piedi': 'A piedi',
  misto: 'Misto',
  'trasporto pubblico': 'Trasporto pubblico',
  treno: 'Treno',
  auto: 'Auto',
  aereo: 'Aereo',
  taxi: 'Taxi',
  traghetto: 'Traghetto',
  autobus: 'Autobus',
  altro: 'Altro mezzo',
};
const arrivalTransportLabels: Record<ArrivalTransport, string> = { aereo: 'Aereo', treno: 'Treno', auto: 'Auto', autobus: 'Autobus', traghetto: 'Traghetto', altro: 'Altro' };
const settingLabels: Record<ActivitySetting, string> = {
  indoor: 'Indoor',
  outdoor: 'Outdoor',
};
const activityStatusLabels: Record<ActivityStatus, string> = {
  CONFIRMED: 'Confermato',
  SIMULATED: 'Simulato',
  TO_VERIFY: 'Da verificare',
  MISSING: 'Mancante',
  OFFLINE: 'Offline',
  TO_DEFINE: 'Da definire',
  COMPLETED: 'Completata',
};
const editableActivityStatuses: ActivityStatus[] = ['TO_DEFINE', 'TO_VERIFY', 'CONFIRMED'];

function activityDataState(status: ActivityStatus): DataState {
  const states: Record<ActivityStatus, DataState> = {
    CONFIRMED: 'confermato',
    SIMULATED: 'simulato',
    TO_VERIFY: 'da-verificare',
    MISSING: 'mancante',
    OFFLINE: 'offline',
    TO_DEFINE: 'da-definire',
    COMPLETED: 'completata',
  };
  return states[status];
}

function placeDataState(activity: Activity): DataState {
  if (!activity.place) return 'da-definire';
  if (activity.place.geoStatus === 'CONFIRMED') return 'confermato';
  if (activity.place.geoStatus === 'DEMO' || activity.place.geoStatus === 'ESTIMATED') return 'simulato';
  if (activity.place.geoStatus === 'TO_VERIFY') return 'da-verificare';
  if (activity.place.geoStatus === 'UNAVAILABLE_OFFLINE') return 'offline';
  return 'mancante';
}

function routeDataState(segment: RouteSegment): DataState {
  if (segment.completed) return 'completata';
  if (segment.reliability === 'VERIFIED') return 'confermato';
  if (segment.reliability === 'ESTIMATED' || segment.reliability === 'DEMO') return 'simulato';
  if (segment.reliability === 'TO_VERIFY') return 'da-verificare';
  return 'mancante';
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type DateFields = Pick<TripForm, 'departure' | 'returnDate' | 'arrivalTime' | 'departureTime' | 'arrivalDayOffset' | 'arrivalDate' | 'arrivalDestinationKind' | 'arrivalDestinationPoint'>;
type BudgetFields = Pick<TripForm, 'travelers' | 'budgetPerTraveler'>;

function cloneSnapshot(snapshot: ItinerarySnapshot): ItinerarySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ItinerarySnapshot;
}

function snapshotOf(plan: Itinerary): ItinerarySnapshot {
  const { original: _original, ...snapshot } = plan;
  return cloneSnapshot(snapshot);
}

function normalizePlan(plan: Itinerary): Itinerary {
  const original = plan.original ? cloneSnapshot(plan.original) : snapshotOf(plan);
  const departure = plan.departure ?? '';
  const returnDate = plan.returnDate ?? departure;
  return {
    ...plan,
    departure,
    returnDate,
    arrivalTime: plan.arrivalTime,
    departureTime: plan.departureTime,
    travelers: plan.travelers ?? '',
    budget: plan.budget ?? plan.budgetPerTraveler ?? 'budget flessibile',
    budgetPerTraveler: plan.budgetPerTraveler ?? plan.budget ?? 'budget flessibile',
    budgetReliability: plan.budgetReliability ?? (plan.budgetPerTraveler ? 'USER_ENTERED' : 'TO_VERIFY'),
    interests: plan.interests ?? ['Cibo', 'Natura', 'Storia'],
    customInterests: plan.customInterests ?? [],
    constraints: plan.constraints ?? '',
    stops: plan.stops ?? [],
    lodging: plan.lodging ?? {},
    arrivalTransport: plan.arrivalTransport,
    departurePoint: plan.departurePoint ? ensureLocationNode(plan.departurePoint, 'Punto di partenza') : undefined,
    arrivalPoint: plan.arrivalPoint ? ensureLocationNode(plan.arrivalPoint, 'Punto di arrivo') : undefined,
    arrivalDayOffset: plan.arrivalDayOffset,
    arrivalDate: plan.arrivalDate,
    arrivalDestinationKind: plan.arrivalDestinationKind ?? 'first-activity',
    arrivalDestinationPoint: plan.arrivalDestinationPoint ? ensureLocationNode(plan.arrivalDestinationPoint, 'Prima destinazione') : undefined,
    destinationNode: plan.destinationNode ? ensureLocationNode(plan.destinationNode, plan.destination || 'Destinazione') : undefined,
    returnTransport: plan.returnTransport,
    returnPoint: plan.returnPoint ? ensureLocationNode(plan.returnPoint, 'Punto di rientro') : undefined,
    planningMode: plan.planningMode ?? 'initial',
    routeSummary: plan.routeSummary ?? 'Pianificazione iniziale: completa il punto di partenza per le tratte',
    interurbanRoutes: (plan.interurbanRoutes ?? []).map((segment, index) => normalizeRouteSegment(segment, 0, index)).filter((segment): segment is RouteSegment => segment !== null),
    version: plan.version ?? 5,
    original,
    days: (plan.days ?? []).map((day, index) => normalizeDayRouteModel({
      ...day,
        activities: (day.activities ?? []).map((activity, activityIndex) => normalizeActivity({
          ...activity,
        transport: activity.transport ?? plan.transport,
        setting: activity.setting ?? 'outdoor',
        requiresBooking: activity.requiresBooking ?? false,
        place: activity.place ?? {
          id: `local-${activity.title.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}`,
          title: activity.title,
          city: plan.destination,
          source: 'Piano locale',
          updatedAt: '2026-08-25',
          geoStatus: 'MISSING',
          category: activity.category,
          whyRecommended: 'Attività già presente nel piano.',
        },
        }, `day-${day.date ?? day.day ?? index + 1}`, activityIndex, plan.transport)),
    }, index)),
  };
}

function parsePlan(raw: string | string[] | undefined): Itinerary {
  if (!raw) return normalizePlan(fallback);
  try {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return normalizePlan(JSON.parse(value) as Itinerary);
  } catch {
    return normalizePlan(fallback);
  }
}

function newActivity(transport: Transport, dayId: string, order: number): Activity {
  return {
    id: `activity-${Date.now().toString()}-${Math.random().toString(36).slice(2, 11)}`,
    dayId,
    order,
    time: '20:00',
    title: 'Nuova attività',
    detail: '',
    category: 'Cibo',
    transport,
    setting: 'outdoor',
    requiresBooking: false,
    status: 'TO_DEFINE',
    updatedAt: new Date().toISOString(),
  };
}

function statusForNode(node: LocationNode): ActivityStatus {
  if (node.geoStatus === 'CONFIRMED') return 'CONFIRMED';
  if (node.geoStatus === 'DEMO' || node.geoStatus === 'ESTIMATED') return 'SIMULATED';
  if (node.geoStatus === 'TO_VERIFY') return 'TO_VERIFY';
  if (node.geoStatus === 'UNAVAILABLE_OFFLINE') return 'OFFLINE';
  return node.geoStatus === 'MISSING' ? 'MISSING' : 'TO_DEFINE';
}

function placeFromNode(node: LocationNode, category: Activity['category'], setting: ActivitySetting) {
  return {
    id: node.providerId ? `geoapify-${node.providerId}` : node.id,
    placeId: node.providerId ?? node.placeId,
    title: node.label,
    address: node.address,
    city: node.city,
    country: node.country,
    timezone: node.timezone,
    latitude: node.latitude,
    longitude: node.longitude,
    source: node.source ?? 'Fonte non disponibile',
    updatedAt: node.updatedAt ?? new Date().toISOString(),
    geoStatus: node.geoStatus,
    category,
    setting,
    whyRecommended: 'Luogo scelto dall’utente: verifica orari, accesso e dettagli prima di partire.',
  };
}

function formFromPlan(plan: Itinerary, dates?: DateFields): TripForm {
  return {
    destination: plan.destination,
    departure: dates?.departure ?? plan.departure ?? '',
    returnDate: dates?.returnDate ?? plan.returnDate ?? '',
    arrivalTime: dates?.arrivalTime ?? plan.arrivalTime ?? '',
    departureTime: dates?.departureTime ?? plan.departureTime ?? '',
    travelers: plan.travelers ?? '',
    budget: plan.budget ?? plan.budgetPerTraveler ?? 'budget flessibile',
    budgetPerTraveler: plan.budgetPerTraveler ?? plan.budget ?? 'budget flessibile',
    budgetReliability: plan.budgetReliability,
    pace: plan.pace,
    interests: plan.interests ?? ['Cibo', 'Natura', 'Storia'],
    customInterests: plan.customInterests ?? [],
    constraints: plan.constraints ?? '',
    transport: plan.transport,
    stops: plan.stops ?? [],
    lodging: plan.lodging ?? {},
    arrivalTransport: plan.arrivalTransport,
    departurePoint: plan.departurePoint,
    arrivalPoint: plan.arrivalPoint,
    arrivalDayOffset: dates?.arrivalDayOffset ?? plan.arrivalDayOffset,
    arrivalDate: dates?.arrivalDate ?? plan.arrivalDate,
    arrivalDestinationKind: dates?.arrivalDestinationKind ?? plan.arrivalDestinationKind,
    arrivalDestinationPoint: dates?.arrivalDestinationPoint ?? plan.arrivalDestinationPoint,
    returnTransport: plan.returnTransport,
    returnPoint: plan.returnPoint,
  };
}

function transportDetails(selected: ActivityTransport) {
  const detail: Record<ActivityTransport, { duration: string; distance: string; cost: string; comfort: string }> = {
    'a piedi': { duration: 'Tempo da verificare', distance: 'Distanza da verificare', cost: 'Costo da verificare', comfort: 'ritmo lento' },
    'trasporto pubblico': { duration: 'Tempo da verificare', distance: 'Distanza da verificare', cost: 'Costo da verificare', comfort: 'coperto' },
    misto: { duration: 'Tempo da verificare', distance: 'Distanza da verificare', cost: 'Costo da verificare', comfort: 'equilibrato' },
    treno: { duration: 'Tempo da verificare', distance: 'Distanza da verificare', cost: 'Costo da verificare', comfort: 'coperto' },
    auto: { duration: 'Tempo da verificare', distance: 'Distanza da verificare', cost: 'Costo da verificare', comfort: 'flessibile' },
    aereo: { duration: 'Tempo da verificare', distance: 'Distanza da verificare', cost: 'Costo da verificare', comfort: 'lungo raggio' },
    autobus: { duration: 'Tempo da verificare', distance: 'Distanza da verificare', cost: 'Costo da verificare', comfort: 'flessibile' },
    taxi: { duration: 'Tempo da verificare', distance: 'Distanza da verificare', cost: 'Costo da verificare', comfort: 'diretto' },
    traghetto: { duration: 'Tempo da verificare', distance: 'Distanza da verificare', cost: 'Costo da verificare', comfort: 'panoramico' },
    altro: { duration: 'Tempo da verificare', distance: 'Distanza da verificare', cost: 'Costo da verificare', comfort: 'da valutare' },
  };
  return detail[selected];
}

const automaticArrivalTitles = new Set(['Arrivo nella destinazione', 'Check-in o deposito bagagli']);

function timelineEntries(day: Itinerary['days'][number]): Array<{ kind: 'activity'; activity: Activity; activityIndex: number } | { kind: 'route'; segment: RouteSegment }> {
  const entries: Array<{ kind: 'activity'; activity: Activity; activityIndex: number } | { kind: 'route'; segment: RouteSegment }> = [];
  const remaining = [...(day.segments ?? [])];
  const activityIds = new Set(day.activities.map((activity, index) => nodeIdForActivity(activity, index)));
  day.activities.forEach((activity, index) => {
    if (automaticArrivalTitles.has(activity.title)) entries.push({ kind: 'activity', activity, activityIndex: index });
  });
  const leadingRouteIndex = remaining.findIndex((segment) => segment.origin.id === day.origin?.id && !activityIds.has(segment.destination.id));
  if (leadingRouteIndex >= 0) entries.push({ kind: 'route', segment: remaining.splice(leadingRouteIndex, 1)[0] });
  day.activities.forEach((activity, index) => {
    if (automaticArrivalTitles.has(activity.title)) return;
    const nodeId = nodeIdForActivity(activity, index);
    const inboundRouteIndex = remaining.findIndex((segment) => segment.toNodeId === nodeId);
    if (inboundRouteIndex >= 0) entries.push({ kind: 'route', segment: remaining.splice(inboundRouteIndex, 1)[0] });
    entries.push({ kind: 'activity', activity, activityIndex: index });
  });
  remaining.forEach((segment) => entries.push({ kind: 'route', segment }));
  return entries;
}

function patchRouteInPlan(plan: Itinerary, routeId: string, patch: Partial<RouteSegment>): Itinerary {
  return {
    ...plan,
    days: plan.days.map((day) => ({ ...day, segments: day.segments?.map((segment) => segment.id === routeId ? { ...segment, ...patch } : segment) })),
    interurbanRoutes: plan.interurbanRoutes?.map((segment) => segment.id === routeId ? { ...segment, ...patch } : segment),
  };
}

function dayForToday(plan: Itinerary): number | undefined {
  const departure = parseCalendarDate(plan.departure ?? '');
  if (!departure || !plan.days.length) return plan.days[0]?.day;
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const offset = Math.floor((now.getTime() - departure.getTime()) / (24 * 60 * 60 * 1000));
  return plan.days[Math.max(0, Math.min(plan.days.length - 1, offset))]?.day;
}

function displayDayDate(value: string): string {
  const parsed = parseCalendarDate(value);
  return parsed ? new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(parsed) : value;
}

export default function ItineraryScreen() {
  const C = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ data?: string; saved?: string; tripId?: string }>();
  const { trips, loading: savedTripLoading, save, refresh } = useSavedTrip();
  const [plan, setPlan] = useState<Itinerary>(() => parsePlan(params.data));
  const [draft, setDraft] = useState<Itinerary | null>(null);
  const [saveState, setSaveState] = useState<SaveState>(() => params.saved === '1' ? 'saved' : 'idle');
  const [restoreConfirmationVisible, setRestoreConfirmationVisible] = useState(false);
  const [dateEditorVisible, setDateEditorVisible] = useState(false);
  const [dateFields, setDateFields] = useState<DateFields>(() => ({
    departure: plan.departure ?? '',
    returnDate: plan.returnDate ?? '',
    arrivalTime: plan.arrivalTime ?? '',
    departureTime: plan.departureTime ?? '',
    arrivalDayOffset: plan.arrivalDayOffset ?? 0,
    arrivalDate: plan.arrivalDate,
    arrivalDestinationKind: plan.arrivalDestinationKind ?? 'first-activity',
    arrivalDestinationPoint: plan.arrivalDestinationPoint,
  }));
  const [dateError, setDateError] = useState('');
  const [pendingDateFields, setPendingDateFields] = useState<DateFields | null>(null);
  const [originEditorVisible, setOriginEditorVisible] = useState(false);
  const [originFields, setOriginFields] = useState<LodgingInfo>(() => plan.lodging ?? {});
  const [routePreview, setRoutePreview] = useState<Itinerary | null>(null);
  const [budgetEditorVisible, setBudgetEditorVisible] = useState(false);
  const [budgetFields, setBudgetFields] = useState<BudgetFields>(() => ({ travelers: plan.travelers ?? '', budgetPerTraveler: plan.budgetPerTraveler ?? plan.budget ?? '' }));
  const [budgetError, setBudgetError] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [todayDay, setTodayDay] = useState<number | undefined>(() => dayForToday(plan));
  const [todayMapView, setTodayMapView] = useState<MapViewMode>('day');
  const weatherClientRef = useRef<WeatherClient | null>(null);
  const weatherAutoLoaded = useRef(false);
  const geocodingClientRef = useRef<GeocodingClient | null>(null);
  const geographyAutoLoaded = useRef(false);
  const [geographyReady, setGeographyReady] = useState(false);
  const [geoIssues, setGeoIssues] = useState<GeoEnrichmentIssue[]>([]);
  const [geoStatusMessages, setGeoStatusMessages] = useState<string[]>([]);
  const [weatherRecords, setWeatherRecords] = useState<WeatherSnapshot[]>(() => normalizeWeatherRecords(plan.weather));
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [expandedWeatherId, setExpandedWeatherId] = useState<string | undefined>();

  const isEditing = draft !== null;
  const visiblePlan = draft ?? plan;
  const discoveryPlace = demoPlaces.find((place) => place.city?.toLocaleLowerCase('it') === visiblePlan.destination.toLocaleLowerCase('it'))
    ?? placeForActivity('Luogo da scoprire', visiblePlan.destination, 'Storia', 'outdoor');
  const hasRoutePlan = Array.isArray(params.data) ? Boolean(params.data[0]) : Boolean(params.data);
  const tripId = Array.isArray(params.tripId) ? params.tripId[0] : params.tripId;
  const savedTrip = tripId ? trips.find((trip) => trip.id === tripId) : undefined;
  const budgetIsConfirmed = visiblePlan.budgetReliability === 'USER_ENTERED';
  const budgetPerTraveler = visiblePlan.budgetPerTraveler ?? visiblePlan.budget ?? 'Budget non inserito';
  const travelerCount = parseTravelerCount(visiblePlan.travelers);
  const budgetAmount = parseBudgetAmount(budgetPerTraveler);
  const estimatedBudgetTotal = budgetIsConfirmed && travelerCount !== null && budgetAmount !== null
    ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(budgetAmount * travelerCount)
    : null;
  const arrivalDayLabel = visiblePlan.arrivalDate
    ? `Data specifica · ${visiblePlan.arrivalDate}`
    : visiblePlan.arrivalDayOffset === 1 ? 'Il giorno successivo'
      : 'Lo stesso giorno';
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | undefined>();
  const [repositionProposal, setRepositionProposal] = useState<{ dayIndex: number; suggestion: RepositionSuggestion } | null>(null);
  const [pendingActivityDeletion, setPendingActivityDeletion] = useState<{ dayIndex: number; activityIndex: number; title: string } | null>(null);
  const [activityGeoSearch, setActivityGeoSearch] = useState<{ dayIndex: number; activityIndex: number; message: string; candidates: LocationNode[] } | null>(null);
  const [activityDaysToRefresh, setActivityDaysToRefresh] = useState<number[]>([]);
  const [providerRouteMessage, setProviderRouteMessage] = useState('');
  const [pendingProviderRoute, setPendingProviderRoute] = useState<{ segment: RouteSegment; patch: Partial<RouteSegment> } | null>(null);
  const selectedTodayDay = visiblePlan.days.find((day) => day.day === todayDay) ?? visiblePlan.days[0];
  const selectedTodayIndex = selectedTodayDay ? visiblePlan.days.findIndex((day) => day.day === selectedTodayDay.day) : -1;
  const selectedTodayTimeline = selectedTodayDay ? timelineEntries(selectedTodayDay) : [];
  const nextTodayActivity = selectedTodayDay?.activities.find((activity) => !activity.completed);
  const weatherForDay = (dayNumber: number): WeatherSnapshot | undefined => {
    const request = weatherRequestForDay(visiblePlan, dayNumber);
    return request ? weatherRecords.find((record) => weatherKey(record) === weatherKey(request)) : undefined;
  };
  const selectedWeather = selectedTodayDay ? weatherForDay(selectedTodayDay.day) : undefined;
  const selectedWeatherAlerts = weatherAlerts(selectedWeather, selectedTodayDay?.activities.filter((activity) => activity.setting !== 'indoor').length ?? 0, selectedTodayDay?.rainyAlternative);

  useFocusEffect(useCallback(() => {
    void refresh();
  }, [refresh]));

  useEffect(() => {
    if (!hasRoutePlan && !savedTripLoading && savedTrip && !isEditing && !dateEditorVisible) {
      const savedPlan = normalizePlan(savedTrip.itinerary);
      geographyAutoLoaded.current = false;
      weatherAutoLoaded.current = false;
      setGeographyReady(false);
      setPlan(savedPlan);
      setDateFields({
        departure: savedPlan.departure ?? '',
        returnDate: savedPlan.returnDate ?? '',
        arrivalTime: savedPlan.arrivalTime ?? '',
        departureTime: savedPlan.departureTime ?? '',
        arrivalDayOffset: savedPlan.arrivalDayOffset ?? 0,
        arrivalDate: savedPlan.arrivalDate,
        arrivalDestinationKind: savedPlan.arrivalDestinationKind ?? 'first-activity',
        arrivalDestinationPoint: savedPlan.arrivalDestinationPoint,
      });
    }
  }, [dateEditorVisible, hasRoutePlan, isEditing, savedTrip, savedTripLoading]);

  useEffect(() => {
    if (!visiblePlan.days.some((day) => day.day === todayDay)) setTodayDay(dayForToday(visiblePlan));
  }, [todayDay, visiblePlan]);

  useEffect(() => {
    if (geographyAutoLoaded.current || isEditing) return;
    geographyAutoLoaded.current = true;
    let cancelled = false;
    const enrich = async () => {
      geocodingClientRef.current ??= new GeocodingClient();
      const result = await enrichItineraryGeography(plan, geocodingClientRef.current);
      if (cancelled) return;
      setGeoIssues(result.issues);
      setGeoStatusMessages(Array.from(new Set(result.messages)).slice(0, 8));
      if (result.changed) {
        const next = normalizePlan(synchronizeItineraryMap(recalculateRoutes(result.itinerary, result.itinerary.lodging), plan.mapSnapshot?.updatedAt));
        setPlan(next);
        if (tripId) {
          try {
            await save(next, tripId, savedTrip?.title);
          } catch {
            setSaveState('error');
          }
        }
      }
      setGeographyReady(true);
    };
    void enrich().catch(() => {
      if (!cancelled) setGeographyReady(true);
    });
    return () => { cancelled = true; };
  }, [isEditing, plan, save, savedTrip?.title, tripId]);

  const startEditing = () => {
    setDateEditorVisible(false);
    setDraft(normalizePlan(JSON.parse(JSON.stringify(plan)) as Itinerary));
    setActivityDaysToRefresh([]);
    setPendingActivityDeletion(null);
    setActivityGeoSearch(null);
    setSaveState('idle');
  };

  const cancelEditing = () => {
    setDraft(null);
    setSaveState('idle');
    setRestoreConfirmationVisible(false);
    setPendingActivityDeletion(null);
    setActivityGeoSearch(null);
    setActivityDaysToRefresh([]);
  };

  const updateDraft = (update: (current: Itinerary) => Itinerary) => {
    setDraft((current) => (current ? update(current) : current));
    setSaveState('idle');
  };

  const markActivityDaysForRefresh = (...dayIndexes: number[]) => {
    setActivityDaysToRefresh((current) => Array.from(new Set([...current, ...dayIndexes.filter((index) => index >= 0)])));
  };

  const updateActivity = (dayIndex: number, activityIndex: number, patch: Partial<Activity>) => {
    updateDraft((current) => ({
      ...current,
      days: current.days.map((day, index) => index !== dayIndex ? day : {
        ...day,
        activities: day.activities.map((activity, innerIndex) => innerIndex !== activityIndex ? activity : {
          ...activity,
          ...patch,
          repositioningDecision: patch.repositioningDecision ?? (Object.keys(patch).some((key) => ['place', 'time', 'duration', 'title'].includes(key)) ? undefined : activity.repositioningDecision),
          repositioningCheckedAt: patch.repositioningDecision ? new Date().toISOString() : activity.repositioningCheckedAt,
          updatedAt: new Date().toISOString(),
        }),
      }),
    }));
    markActivityDaysForRefresh(dayIndex);
  };

  const addActivity = (dayIndex: number) => {
    updateDraft((current) => ({
      ...current,
      days: current.days.map((day, index) => index !== dayIndex ? day : {
        ...day,
        activities: [...day.activities, newActivity(current.transport, `day-${day.date ?? day.day}`, day.activities.length)],
      }),
    }));
    markActivityDaysForRefresh(dayIndex);
  };

  const confirmActivityDeletion = () => {
    if (!pendingActivityDeletion) return;
    const { dayIndex, activityIndex } = pendingActivityDeletion;
    updateDraft((current) => ({
      ...current,
      days: current.days.map((day, index) => index !== dayIndex ? day : {
        ...day,
        activities: day.activities.filter((_, innerIndex) => innerIndex !== activityIndex),
      }),
    }));
    markActivityDaysForRefresh(dayIndex);
    setPendingActivityDeletion(null);
  };

  const inspectRepositioning = (dayIndex: number, activityIndex: number) => {
    const day = visiblePlan.days[dayIndex];
    if (!day) return;
    setRepositionProposal({ dayIndex, suggestion: proposeRepositioning(day, activityIndex) });
  };

  const acceptRepositioning = () => {
    if (!repositionProposal || repositionProposal.suggestion.status !== 'CALCULABLE') return;
    const { dayIndex, suggestion } = repositionProposal;
    if (suggestion.suggestedIndex === suggestion.activityIndex) {
      setRepositionProposal(null);
      return;
    }
    updateDraft((current) => ({
      ...current,
      days: current.days.map((day, index) => index === dayIndex ? {
        ...day,
        activities: applyRepositioning(day.activities, suggestion.activityIndex, suggestion.suggestedIndex).map((activity, index) => ({
          ...activity,
          order: index,
          repositioningDecision: activity.id === day.activities[suggestion.activityIndex]?.id ? 'ACCEPTED' : activity.repositioningDecision,
          repositioningCheckedAt: activity.id === day.activities[suggestion.activityIndex]?.id ? new Date().toISOString() : activity.repositioningCheckedAt,
          updatedAt: activity.id === day.activities[suggestion.activityIndex]?.id ? new Date().toISOString() : activity.updatedAt,
        })),
      } : day),
    }));
    markActivityDaysForRefresh(dayIndex);
    setRepositionProposal(null);
  };

  const keepRepositioning = () => {
    if (!repositionProposal) return;
    const { dayIndex, suggestion } = repositionProposal;
    updateActivity(dayIndex, suggestion.activityIndex, { repositioningDecision: 'KEPT' });
    setRepositionProposal(null);
  };

  const moveActivityWithinDay = (dayIndex: number, activityIndex: number, targetIndex: number) => {
    updateDraft((current) => ({
      ...current,
      days: current.days.map((day, index) => index !== dayIndex ? day : {
        ...day,
        activities: applyRepositioning(day.activities, activityIndex, targetIndex).map((activity, order) => ({ ...activity, order, updatedAt: activity.id === day.activities[activityIndex]?.id ? new Date().toISOString() : activity.updatedAt })),
      }),
    }));
    markActivityDaysForRefresh(dayIndex);
  };

  const moveActivityToDay = (fromDayIndex: number, activityIndex: number, toDayIndex: number) => {
    if (fromDayIndex === toDayIndex) return;
    updateDraft((current) => {
      const activity = current.days[fromDayIndex]?.activities[activityIndex];
      if (!activity) return current;
      return {
        ...current,
        days: current.days.map((day, index) => {
          if (index === fromDayIndex) return { ...day, activities: day.activities.filter((_, innerIndex) => innerIndex !== activityIndex).map((item, order) => ({ ...item, order })) };
          if (index === toDayIndex) return {
            ...day,
            activities: [...day.activities, {
              ...activity,
              dayId: `day-${day.date ?? day.day}`,
              order: day.activities.length,
              updatedAt: new Date().toISOString(),
            }],
          };
          return day;
        }),
      };
    });
    markActivityDaysForRefresh(fromDayIndex, toDayIndex);
  };

  const updateActivityPlaceQuery = (dayIndex: number, activityIndex: number, value: string) => {
    const activity = visiblePlan.days[dayIndex]?.activities[activityIndex];
    if (!activity) return;
    updateActivity(dayIndex, activityIndex, {
      place: {
        ...(activity.place ?? {
          id: `place-${activity.id ?? activityIndex}`,
          category: activity.category,
          setting: activity.setting,
          whyRecommended: 'Luogo inserito dall’utente.',
        }),
        title: value,
        city: visiblePlan.destination,
        latitude: undefined,
        longitude: undefined,
        placeId: undefined,
        source: 'Inserito dall’utente',
        updatedAt: new Date().toISOString(),
        geoStatus: value.trim() ? 'MISSING' : 'MISSING',
        category: activity.category,
        setting: activity.setting,
        whyRecommended: 'Luogo inserito dall’utente: cerca o conferma una posizione prima di usare la mappa.',
      },
      status: value.trim() ? 'MISSING' : 'TO_DEFINE',
    });
    setActivityGeoSearch(null);
  };

  const applyActivityGeoNode = (dayIndex: number, activityIndex: number, node: LocationNode) => {
    const activity = visiblePlan.days[dayIndex]?.activities[activityIndex];
    if (!activity) return;
    updateActivity(dayIndex, activityIndex, {
      place: placeFromNode(node, activity.category, activity.setting ?? 'outdoor'),
      status: statusForNode(node),
    });
    setActivityGeoSearch(null);
  };

  const searchActivityPlace = async (dayIndex: number, activityIndex: number) => {
    const activity = visiblePlan.days[dayIndex]?.activities[activityIndex];
    const query = activity?.place?.title?.trim() || '';
    if (!activity || !query) {
      setActivityGeoSearch({ dayIndex, activityIndex, message: 'Inserisci prima il nome del luogo da cercare.', candidates: [] });
      return;
    }
    setActivityGeoSearch({ dayIndex, activityIndex, message: 'Ricerca del luogo in corso…', candidates: [] });
    geocodingClientRef.current ??= new GeocodingClient();
    try {
      const result = await geocodingClientRef.current.geocode({ query, city: visiblePlan.destination, type: 'activity' });
      if (result.node && result.status !== 'AMBIGUOUS' && result.status !== 'CITY_MISMATCH') {
        applyActivityGeoNode(dayIndex, activityIndex, result.node);
        setProviderRouteMessage(result.message ?? `Luogo aggiornato: stato ${activityStatusLabels[statusForNode(result.node)]}.`);
        return;
      }
      setActivityGeoSearch({
        dayIndex,
        activityIndex,
        message: result.message ?? 'Riposizionamento non calcolabile: posizione da definire.',
        candidates: result.candidates,
      });
    } catch {
      setActivityGeoSearch({
        dayIndex,
        activityIndex,
        message: 'Ricerca non disponibile. Il luogo resta salvato come Posizione da definire.',
        candidates: [],
      });
    }
  };

  const addGeoSearchResult = (node: LocationNode) => {
    const activity: Activity = {
      id: `activity-${Date.now().toString()}-${Math.random().toString(36).slice(2, 11)}`,
      time: 'Da definire',
      title: node.label,
      detail: 'Luogo cercato online: verifica orari, accesso e dettagli prima di partire.',
      category: 'Storia',
      transport: plan.transport,
      setting: 'outdoor',
      requiresBooking: false,
      nodeId: node.id,
      status: statusForNode(node),
      updatedAt: new Date().toISOString(),
      place: {
        id: node.providerId ? `geoapify-${node.providerId}` : node.id,
        placeId: node.providerId,
        title: node.label,
        address: node.address,
        city: node.city,
        country: node.country,
        timezone: node.timezone,
        latitude: node.latitude,
        longitude: node.longitude,
        source: node.source ?? 'Geoapify · OpenStreetMap',
        updatedAt: node.updatedAt ?? new Date().toISOString(),
        geoStatus: node.geoStatus,
        category: 'Storia',
        whyRecommended: 'Risultato di ricerca da verificare e confermare nel tuo itinerario.',
      },
    };
    const targetDay = todayDay ?? plan.days[0]?.day;
    const targetDayIndex = plan.days.findIndex((day) => day.day === targetDay);
    setDraft(normalizePlan({
      ...plan,
      days: plan.days.map((day) => day.day === targetDay ? { ...day, activities: [...day.activities, activity] } : day),
    }));
    markActivityDaysForRefresh(targetDayIndex);
    setSaveState('idle');
    setProviderRouteMessage('Luogo aggiunto alla bozza. Salva le modifiche per conservarlo nel viaggio.');
  };

  const requestProviderRoute = async (segment: RouteSegment) => {
    if (segment.recommendedMode !== 'a piedi' && segment.recommendedMode !== 'auto' && segment.recommendedMode !== 'taxi') {
      setProviderRouteMessage('Il routing online è disponibile solo per percorsi a piedi, auto o stima taxi. Gli altri mezzi restano manuali o da verificare.');
      return;
    }
    if (!Number.isFinite(segment.origin.latitude) || !Number.isFinite(segment.origin.longitude) || !Number.isFinite(segment.destination.latitude) || !Number.isFinite(segment.destination.longitude)) {
      setProviderRouteMessage('Routing non calcolabile: mancano coordinate valide per origine o destinazione.');
      return;
    }
    const patch = await calculateGraphHopperRoute(segment.origin, segment.destination, segment.recommendedMode);
    if (!patch) {
      setProviderRouteMessage('Routing online non disponibile: configura una chiave pubblica GraphHopper limitata oppure conserva la tratta locale da verificare.');
      return;
    }
    setProviderRouteMessage('');
    setPendingProviderRoute({ segment, patch });
  };

  const confirmProviderRoute = async () => {
    if (!pendingProviderRoute) return;
    const routeUpdate = pendingProviderRoute;
    setPendingProviderRoute(null);
    if (draft) {
      updateDraft((current) => patchRouteInPlan(current, routeUpdate.segment.id, routeUpdate.patch));
      setProviderRouteMessage('Percorso online applicato alla bozza. Salva le modifiche per conservarlo nel viaggio.');
      return;
    }
    const next = patchRouteInPlan(plan, routeUpdate.segment.id, routeUpdate.patch);
    await savePlan(normalizePlan(next));
  };

  const savePlan = async (next: Itinerary) => {
    setSaveState('saving');
    try {
      const saved = await save(next, tripId, savedTrip?.title);
      setPlan(next);
      setDraft(null);
      setSaveState('saved');
      router.replace({ pathname: '/itinerary', params: { saved: '1', tripId: saved.id } });
    } catch {
      setSaveState('error');
    }
  };

  const confirmGeocodingIssue = async (issue: GeoEnrichmentIssue, node: LocationNode) => {
    const next = normalizePlan(synchronizeItineraryMap(recalculateRoutes(applyGeoCandidate(plan, issue.target, {
      ...node,
      geoStatus: 'CONFIRMED',
      reliabilityStatus: 'VERIFIED',
    }), plan.lodging), plan.mapSnapshot?.updatedAt));
    setGeoIssues((current) => current.filter((item) => item.id !== issue.id));
    weatherAutoLoaded.current = false;
    setGeographyReady(true);
    setPlan(next);
    if (tripId) {
      try {
        await save(next, tripId, savedTrip?.title);
      } catch {
        setSaveState('error');
      }
    }
  };

  const saveOperationalUpdate = async (update: (current: Itinerary) => Itinerary) => {
    if (draft) {
      updateDraft(update);
      return;
    }
    const next = normalizePlan(update(plan));
    setSaveState('saving');
    try {
      await save(next, tripId, savedTrip?.title);
      setPlan(next);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const toggleActivityCompletion = (dayNumber: number, activityIndex: number) => {
    void saveOperationalUpdate((current) => ({
      ...current,
      days: current.days.map((day) => day.day !== dayNumber ? day : {
        ...day,
        activities: day.activities.map((activity, index) => index !== activityIndex ? activity : {
          ...activity,
          completed: !activity.completed,
          status: !activity.completed ? 'COMPLETED' : activityStatusFor({ ...activity, completed: false, status: undefined }),
          updatedAt: new Date().toISOString(),
        }),
      }),
    }));
  };

  const toggleSegmentCompletion = (routeId: string) => {
    void saveOperationalUpdate((current) => {
      const route = [...current.days.flatMap((day) => day.segments ?? []), ...(current.interurbanRoutes ?? [])].find((segment) => segment.id === routeId);
      return route ? patchRouteInPlan(current, routeId, { completed: !route.completed }) : current;
    });
  };

  const persistMapSnapshot = useCallback((mapSnapshot: MapSnapshot) => {
    const next = normalizePlan({ ...visiblePlan, mapSnapshot });
    if (draft) {
      setDraft(next);
      setSaveState('idle');
      return;
    }
    setPlan(next);
    void save(next, tripId, savedTrip?.title).catch(() => setSaveState('error'));
  }, [draft, save, savedTrip?.title, tripId, visiblePlan]);

  const refreshWeather = useCallback(async () => {
    const sourcePlan = draft ?? plan;
    const requests = sourcePlan.days.map((day) => weatherRequestForDay(sourcePlan, day.day)).filter((request): request is NonNullable<typeof request> => request !== null);
    if (!requests.length) return;
    weatherClientRef.current ??= new WeatherClient();
    setWeatherLoading(true);
    const cached = new Map(normalizeWeatherRecords(sourcePlan.weather ?? weatherRecords).map((record) => [weatherKey(record), record]));
    try {
      const refreshed = await Promise.all(requests.map((request) => weatherClientRef.current!.get(request, cached.get(weatherKey(request)))));
      const refreshedKeys = new Set(refreshed.map((record) => weatherKey(record)));
      const nextWeather = normalizeWeatherRecords([...cached.values()].filter((record) => !refreshedKeys.has(weatherKey(record))).concat(refreshed));
      const next = normalizePlan({ ...sourcePlan, weather: nextWeather });
      setWeatherRecords(nextWeather);
      if (draft) {
        setDraft(next);
      } else {
        setPlan(next);
        if (tripId) await save(next, tripId, savedTrip?.title);
      }
    } finally {
      setWeatherLoading(false);
    }
  }, [draft, plan, save, savedTrip?.title, tripId, weatherRecords]);

  useEffect(() => {
    setWeatherRecords(normalizeWeatherRecords(visiblePlan.weather));
  }, [visiblePlan.weather]);

  useEffect(() => {
    if (weatherAutoLoaded.current || isEditing || !geographyReady || !visiblePlan.days.length) return;
    weatherAutoLoaded.current = true;
    void refreshWeather();
  }, [geographyReady, isEditing, refreshWeather, visiblePlan.days.length]);

  const saveChanges = async () => {
    if (!draft) return;
    const refreshed = activityDaysToRefresh.reduce((current, dayIndex) => {
      const day = current.days[dayIndex];
      return day ? recalculateDayRoutes(current, day.day) : current;
    }, draft);
    await savePlan(normalizePlan(synchronizeItineraryMap(refreshed, draft.mapSnapshot?.updatedAt)));
    setActivityDaysToRefresh([]);
    setRestoreConfirmationVisible(false);
  };

  const restoreOriginal = () => {
    if (!draft?.original) return;
    const original = cloneSnapshot(draft.original);
    setDraft(normalizePlan({ ...original, original }));
    setSaveState('idle');
    setRestoreConfirmationVisible(false);
  };

  const openDateEditor = () => {
    setDraft(null);
    setDateFields({
      departure: plan.departure ?? '',
      returnDate: plan.returnDate ?? '',
      arrivalTime: plan.arrivalTime ?? '',
      departureTime: plan.departureTime ?? '',
      arrivalDayOffset: plan.arrivalDayOffset ?? 0,
      arrivalDate: plan.arrivalDate,
      arrivalDestinationKind: plan.arrivalDestinationKind ?? 'first-activity',
      arrivalDestinationPoint: plan.arrivalDestinationPoint,
    });
    setDateError('');
    setPendingDateFields(null);
    setDateEditorVisible(true);
    setSaveState('idle');
  };

  const closeDateEditor = () => {
    setDateEditorVisible(false);
    setDateError('');
    setPendingDateFields(null);
  };

  const openOriginEditor = () => {
    setDraft(null);
    setDateEditorVisible(false);
    setOriginFields(plan.lodging ?? {});
    setRoutePreview(null);
    setOriginEditorVisible(true);
  };

  const openBudgetEditor = () => {
    setDraft(null);
    setDateEditorVisible(false);
    setOriginEditorVisible(false);
    setBudgetFields({ travelers: plan.travelers ?? '', budgetPerTraveler: plan.budgetPerTraveler ?? plan.budget ?? '' });
    setBudgetError('');
    setBudgetEditorVisible(true);
  };

  const confirmBudget = async () => {
    const confirmedBudget = budgetFields.budgetPerTraveler?.trim() ?? '';
    const amount = parseBudgetAmount(confirmedBudget);
    const travelers = parseTravelerCount(budgetFields.travelers);
    if (amount === null || travelers === null) {
      setBudgetError('Inserisci un budget per viaggiatore e un numero di viaggiatori validi prima di confermare.');
      return;
    }
    const original = plan.original ? cloneSnapshot(plan.original) : snapshotOf(plan);
    const nextForm = { ...formFromPlan(plan), travelers: budgetFields.travelers.trim(), budgetPerTraveler: confirmedBudget, budgetReliability: 'USER_ENTERED' as const };
    const recalculatedBudget = generateItinerary(nextForm);
    setBudgetEditorVisible(false);
    await savePlan(normalizePlan({ ...plan, travelers: nextForm.travelers, budget: nextForm.budgetPerTraveler, budgetPerTraveler: nextForm.budgetPerTraveler, budgetReliability: 'USER_ENTERED', profile: recalculatedBudget.profile, estimate: recalculatedBudget.estimate, original }));
  };

  const previewOriginRoutes = () => {
    setRoutePreview(recalculateRoutes(plan, originFields));
  };

  const confirmOriginRoutes = async () => {
    if (!routePreview) return;
    const original = plan.original ? cloneSnapshot(plan.original) : snapshotOf(plan);
    setOriginEditorVisible(false);
    setRoutePreview(null);
    geographyAutoLoaded.current = false;
    weatherAutoLoaded.current = false;
    setGeographyReady(false);
    await savePlan(normalizePlan({ ...routePreview, original }));
  };

  const applyDateChanges = async (nextDates: DateFields) => {
    const regenerated = generateItinerary(formFromPlan(plan, nextDates));
    const original = plan.original ? cloneSnapshot(plan.original) : snapshotOf(plan);
    const preservedDays = mergeItineraryDaysForDateChange(plan.days, regenerated.days);
    const next = recalculateRoutes({
      ...regenerated,
      days: preservedDays,
      scheduleNote: nextDates.arrivalDayOffset === 1
        ? 'Arrivo il giorno successivo: le attività restano nel loro ordine. Controlla la loro coerenza temporale prima di partire.'
        : regenerated.scheduleNote,
    }, regenerated.lodging);
    setDateFields(nextDates);
    setDateEditorVisible(false);
    setPendingDateFields(null);
    await savePlan(normalizePlan({ ...next, original }));
  };

  const submitDateChanges = () => {
    const dateValidation = validateDateRange(dateFields.departure, dateFields.returnDate);
    const arrivalDateValidation = validateArrivalDate(dateFields.departure, dateFields.returnDate, dateFields.arrivalDayOffset, dateFields.arrivalDate);
    const arrivalValidation = dateFields.arrivalTime ? validateTime(dateFields.arrivalTime, 'Orario di arrivo') : null;
    const departureValidation = dateFields.departureTime ? validateTime(dateFields.departureTime, 'Orario di partenza') : null;
    const scheduleValidation = dateFields.arrivalTime && dateFields.departureTime ? validateSchedule(dateFields.departure, dateFields.returnDate, dateFields.arrivalTime, dateFields.departureTime) : null;
    const customDestinationValidation = dateFields.arrivalDestinationKind === 'custom' && !dateFields.arrivalDestinationPoint?.label?.trim()
      ? 'Inserisci il punto personalizzato dopo l’arrivo oppure scegli un’altra prima destinazione.'
      : null;
    const error = dateValidation ?? arrivalDateValidation ?? arrivalValidation ?? departureValidation ?? scheduleValidation ?? customDestinationValidation;
    if (error) {
      setDateError(error);
      return;
    }
    setDateError('');
    const arrivalChanged = dateFields.arrivalTime !== (plan.arrivalTime ?? '')
      || dateFields.arrivalDayOffset !== (plan.arrivalDayOffset ?? 0)
      || dateFields.arrivalDate !== plan.arrivalDate
      || dateFields.arrivalDestinationKind !== (plan.arrivalDestinationKind ?? 'first-activity')
      || dateFields.arrivalDestinationPoint?.label !== plan.arrivalDestinationPoint?.label;
    if (calculateDuration(dateFields.departure, dateFields.returnDate) !== visiblePlan.duration || arrivalChanged) {
      setPendingDateFields(dateFields);
      return;
    }
    void applyDateChanges(dateFields);
  };

  const shareTrip = () => Share.share({
    title: 'Il mio itinerario',
    message: `Ho preparato un itinerario per ${visiblePlan.destination}: ${visiblePlan.duration} giorni da vivere.`,
  });
  const exportTripJson = async () => {
    const trip = {
      id: tripId ?? `local-${nodeIdForLabel(visiblePlan.destination, 'trip')}`,
      title: savedTrip?.title ?? visiblePlan.destination,
      itinerary: visiblePlan,
      createdAt: savedTrip?.createdAt,
      updatedAt: savedTrip?.updatedAt,
      planVersion: 5,
    };
    const json = serializeTripExport(trip);
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${visiblePlan.destination.toLocaleLowerCase('it').replace(/[^a-z0-9]+/g, '-') || 'viaggio'}-travel-companion.json`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }
    await Share.share({ title: `Export ${trip.title}`, message: json });
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: C.background }}
      contentContainerStyle={s.scroll}
      showsVerticalScrollIndicator={false}
      bottomOffset={70}
      keyboardShouldPersistTaps="handled"
    >
      <Header eyebrow={isEditing ? 'Modifica itinerario' : dateEditorVisible ? 'Modifica date' : 'Il tuo piano'} title={visiblePlan.destination} onBack={() => router.back()} />

      {saveState !== 'idle' && (
        <View testID={`save-status-${saveState}`} accessibilityRole="alert" style={[s.status, { backgroundColor: saveState === 'error' ? C.destructive : saveState === 'saved' ? C.sage : C.secondary }]}>
          <Feather name={saveState === 'saving' ? 'loader' : saveState === 'error' ? 'alert-circle' : 'check-circle'} size={17} color={saveState === 'error' ? C.destructiveForeground : C.primary} />
          <Text style={[s.statusText, { color: saveState === 'error' ? C.destructiveForeground : C.primary }]}>
            {saveState === 'saving' ? 'Salvataggio in corso…' : saveState === 'saved' ? 'Salvataggio completato' : 'Errore di salvataggio. Le modifiche non sono state salvate.'}
          </Text>
        </View>
      )}

      <View style={[s.hero, { backgroundColor: C.primaryContainer }]}>
        <View style={s.heroTop}>
          <View>
            <Text style={[s.kicker, { color: C.primary }]}>ITINERARIO PRONTO</Text>
            <Text style={[s.heroTitle, { color: C.foreground }]}>{visiblePlan.duration} {visiblePlan.duration === 1 ? 'giorno' : 'giorni'} da vivere</Text>
          </View>
          <View style={[s.weatherIcon, { backgroundColor: C.card }]}><Feather name="sun" size={20} color={C.primary} /></View>
        </View>
        <Text style={[s.profile, { color: C.mutedForeground }]}>{visiblePlan.profile}</Text>
        <View style={s.infoGrid}>
          <InfoRow icon="calendar" title="Date" value={`${visiblePlan.departure || '—'} → ${visiblePlan.returnDate || '—'}`} />
          <InfoRow icon="clock" title="Orari" value={`${visiblePlan.arrivalTime || 'Orario non inserito'} arrivo · ${visiblePlan.departureTime || 'Orario non inserito'} partenza`} />
          <InfoRow icon="activity" title="Ritmo" value={visiblePlan.pace} />
          <InfoRow icon="navigation" title="Arrivo" value={visiblePlan.arrivalTransport ? `${arrivalTransportLabels[visiblePlan.arrivalTransport]} · ${visiblePlan.arrivalPoint?.label ?? 'punto da definire'}` : 'Da definire'} />
          <InfoRow icon="calendar" title="Giorno di arrivo" value={arrivalDayLabel} />
          <InfoRow icon="map-pin" title="Prima destinazione" value={visiblePlan.arrivalDestinationKind === 'lodging' ? visiblePlan.lodging?.name || 'Alloggio non ancora inserito' : visiblePlan.arrivalDestinationKind === 'custom' ? visiblePlan.arrivalDestinationPoint?.label || 'Punto da definire' : 'Prima attività'} />
          <InfoRow icon="navigation" title="Spostamenti locali" value={transportLabels[visiblePlan.transport]} />
          <InfoRow icon="credit-card" title="Budget per viaggiatore" value={budgetIsConfirmed ? budgetPerTraveler : `Valore migrato: ${budgetPerTraveler} · da verificare`} />
          {estimatedBudgetTotal ? <InfoRow icon="credit-card" title="Budget totale stimato" value={`${estimatedBudgetTotal} · ${travelerCount} viaggiatori`} /> : null}
        </View>
        {!estimatedBudgetTotal ? <Text style={[s.budgetHint, { color: C.mutedForeground }]}>{budgetIsConfirmed ? 'Il totale stimato richiede un budget numerico e il numero di viaggiatori.' : 'Il valore migrato non viene interpretato come budget individuale: confermalo prima di calcolare un totale.'}</Text> : null}
        <Button testID="edit-budget-per-traveler" variant="ghost" onPress={openBudgetEditor} icon="credit-card">{budgetIsConfirmed ? 'Modifica budget per viaggiatore' : 'Conferma budget per viaggiatore'}</Button>
        <View style={[s.weather, { backgroundColor: C.card }]}>
          <Feather name="cloud" size={17} color={C.primary} />
          <Text style={[s.weatherText, { color: C.foreground }]}>{selectedWeather ? `${selectedWeather.provider} · ${selectedWeather.status === 'HISTORICAL_CLIMATE' ? 'clima storico, non previsione' : selectedWeather.status === 'OFFLINE' ? 'ultimo dato salvato offline' : 'meteo contestuale disponibile nella sezione Oggi'}` : 'Meteo contestuale: scegli un giorno con un luogo geolocalizzato per consultare dati locali o aggiornati.'}</Text>
        </View>
        {visiblePlan.scheduleNote ? (
          <View style={[s.warning, { borderColor: C.border }]}>
            <Feather name="alert-triangle" size={16} color={C.primary} />
            <Text style={[s.warningText, { color: C.foreground }]}>{visiblePlan.scheduleNote}</Text>
          </View>
        ) : null}
      </View>

      {!isEditing && !dateEditorVisible ? (
        <View style={s.topActions}>
          <Button testID="edit-itinerary" onPress={startEditing} icon="edit-3">Modifica itinerario</Button>
          <Button testID="edit-trip-dates" variant="ghost" onPress={openDateEditor} icon="calendar">Modifica date</Button>
          <Button testID="complete-starting-point" variant="secondary" onPress={openOriginEditor} icon="home">{visiblePlan.lodging?.name ? 'Aggiorna alloggio' : 'Aggiungi alloggio o punto di partenza'}</Button>
        </View>
      ) : null}
      {visiblePlan.days.length === 0 ? (
        <EmptyState
          testID="empty-no-generated-itinerary"
          icon="calendar"
          title="Nessun itinerario generato"
          description="Questo viaggio è stato conservato localmente, ma non ha ancora giornate da consultare."
          actionLabel="Modifica date"
          onAction={openDateEditor}
        />
      ) : null}
      {!visiblePlan.destinationNode || visiblePlan.destinationNode.geoStatus !== 'CONFIRMED' ? (
        <EmptyState
          testID="empty-no-confirmed-destination"
          icon="map-pin"
          title="Nessuna destinazione confermata"
          description="Il nome della destinazione resta nel piano. La posizione verrà mostrata solo dopo una verifica esplicita."
          actionLabel="Verifica attività"
          onAction={startEditing}
        />
      ) : null}

      {geoIssues.length > 0 && !isEditing && !dateEditorVisible ? (
        <View testID="geocoding-review-panel" style={[s.editorIntro, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[s.editorTitle, { color: C.foreground }]}>Conferma i luoghi trovati</Text>
          <Text style={[s.editorHint, { color: C.mutedForeground }]}>Non associamo automaticamente risultati ambigui. Scegli il luogo corretto o lascia la posizione da definire.</Text>
          {geoIssues.map((issue) => (
            <View key={issue.id} style={[s.geoIssue, { borderColor: C.border }]}>
              <Text style={[s.geoIssueTitle, { color: C.foreground }]}>{issue.label}</Text>
              <Text style={[s.geoIssueText, { color: C.mutedForeground }]}>{issue.message}</Text>
              {issue.candidates.map((candidate) => (
                <Pressable key={candidate.id} testID={`confirm-geocoding-${candidate.id}`} onPress={() => void confirmGeocodingIssue(issue, candidate)} style={[s.geoCandidate, { backgroundColor: C.secondary }]}>
                  <Feather name="map-pin" size={14} color={C.primary} />
                  <View style={{ flex: 1 }}><Text style={[s.geoIssueText, { color: C.foreground }]}>{candidate.label}</Text><Text style={[s.geoIssueText, { color: C.mutedForeground }]}>Fonte: {candidate.source ?? 'Fonte non disponibile'}</Text></View>
                  <Feather name="check" size={16} color={C.primary} />
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {geoStatusMessages.length > 0 && !isEditing && !dateEditorVisible ? (
        <View testID="geocoding-status-panel" style={[s.editorIntro, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[s.editorTitle, { color: C.foreground }]}>Stato delle posizioni</Text>
          <Text style={[s.editorHint, { color: C.mutedForeground }]}>Conserviamo sempre il testo inserito: nessuna posizione viene inventata o associata a una città diversa.</Text>
          {geoStatusMessages.map((message) => <Text key={message} style={[s.geoIssueText, { color: C.mutedForeground }]}>• {message}</Text>)}
        </View>
      ) : null}

      {originEditorVisible ? (
        <View testID="origin-editor" style={[s.editorIntro, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[s.editorTitle, { color: C.foreground }]}>Completa punto di partenza</Text>
          <Text style={[s.editorHint, { color: C.mutedForeground }]}>Le attività resteranno nello stesso ordine. Vedrai un riepilogo prima di salvare i nuovi percorsi demo.</Text>
          <EditorField label="Alloggio" value={originFields.name ?? ''} onChangeText={(value) => setOriginFields((current) => ({ ...current, name: value }))} placeholder="Es. Hotel vicino al centro" testID="lodging-name" />
          <EditorField label="Indirizzo" value={originFields.address ?? ''} onChangeText={(value) => setOriginFields((current) => ({ ...current, address: value }))} placeholder="Facoltativo" testID="lodging-address" />
          <EditorField label="Zona" value={originFields.zone ?? ''} onChangeText={(value) => setOriginFields((current) => ({ ...current, zone: value }))} placeholder="Facoltativo" testID="lodging-zone" />
           <EditorField label="Punto di partenza personalizzato" value={originFields.customStartingPoint ?? ''} onChangeText={(value) => setOriginFields((current) => ({ ...current, customStartingPoint: value }))} placeholder="Es. Piazza principale" testID="lodging-custom-start" />
           <Text style={[s.editorHint, { color: C.mutedForeground }]}>Cercheremo la posizione automaticamente dopo il salvataggio. Non chiediamo coordinate tecniche.</Text>
          {routePreview ? (
            <View testID="route-recalculation-preview" style={[s.confirmation, { backgroundColor: C.secondary, borderColor: C.border }]}>
              <Text style={[s.confirmTitle, { color: C.foreground }]}>Riepilogo aggiornamento</Text>
              <Text style={[s.confirmText, { color: C.mutedForeground }]}>Conserviamo {plan.days.reduce((total, day) => total + day.activities.length, 0)} attività e il loro ordine. Aggiorniamo solo origini, destinazioni, tratte, mezzi e indicazioni di orario.</Text>
              <Text style={[s.confirmText, { color: C.mutedForeground }]}>Prima: {plan.routeSummary}</Text>
              <Text style={[s.confirmText, { color: C.mutedForeground }]}>Dopo: {routePreview.routeSummary}</Text>
              <Button testID="confirm-route-recalculation" onPress={() => void confirmOriginRoutes()} icon="check">Salva nuova versione</Button>
              <Button variant="ghost" onPress={() => setRoutePreview(null)} icon="x">Annulla anteprima</Button>
            </View>
          ) : (
            <>
              <Button testID="preview-route-recalculation" onPress={previewOriginRoutes} icon="navigation">Mostra riepilogo percorsi</Button>
              <Button variant="ghost" onPress={() => setOriginEditorVisible(false)} icon="x">Annulla</Button>
            </>
          )}
        </View>
      ) : null}

      {budgetEditorVisible ? (
        <View testID="budget-editor" style={[s.editorIntro, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[s.editorTitle, { color: C.foreground }]}>Budget per viaggiatore</Text>
          <Text style={[s.editorHint, { color: C.mutedForeground }]}>Conferma esplicitamente il valore per viaggiatore. Il totale viene calcolato solo dopo questa conferma.</Text>
          {budgetError ? <Text testID="budget-editor-error" style={[s.formError, { color: C.destructive }]}>{budgetError}</Text> : null}
          <EditorField label="Budget per viaggiatore" value={budgetFields.budgetPerTraveler ?? ''} onChangeText={(value) => { setBudgetFields((current) => ({ ...current, budgetPerTraveler: value })); setBudgetError(''); }} placeholder="Es. 1.000€" testID="edit-budget-per-traveler-value" />
          <EditorField label="Viaggiatori" value={budgetFields.travelers} onChangeText={(value) => { setBudgetFields((current) => ({ ...current, travelers: value })); setBudgetError(''); }} placeholder="Es. 2" testID="edit-budget-travelers" />
          <Button testID="confirm-budget-per-traveler" onPress={() => void confirmBudget()} icon="check">Conferma e calcola totale</Button>
          <Button testID="cancel-budget-per-traveler" variant="ghost" onPress={() => setBudgetEditorVisible(false)} icon="x">Annulla</Button>
        </View>
      ) : null}

      {dateEditorVisible ? (
        <View testID="date-editor" style={[s.editorIntro, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[s.editorTitle, { color: C.foreground }]}>Modifica date, arrivo e orari</Text>
          <Text style={[s.editorHint, { color: C.mutedForeground }]}>Le attività restano nel loro ordine; vedrai una conferma prima di salvare le tratte che dipendono dall’arrivo.</Text>
          {dateError ? <Text style={[s.formError, { color: C.destructive }]}>{dateError}</Text> : null}
          <EditorField label="Data di partenza" value={dateFields.departure} onChangeText={(value) => setDateFields((current) => ({ ...current, departure: value }))} placeholder="2026-09-12" testID="edit-departure-date" />
          <EditorField label="Data di rientro" value={dateFields.returnDate} onChangeText={(value) => setDateFields((current) => ({ ...current, returnDate: value }))} placeholder="2026-09-16" testID="edit-return-date" />
          <Text style={[s.editorLabel, { color: C.foreground }]}>Quando arrivi?</Text>
          <View style={s.editorPills}>
            <Pill testID="edit-arrival-day-same" active={!dateFields.arrivalDate && dateFields.arrivalDayOffset !== 1} onPress={() => setDateFields((current) => ({ ...current, arrivalDate: undefined, arrivalDayOffset: 0 }))}>Lo stesso giorno</Pill>
            <Pill testID="edit-arrival-day-next" active={!dateFields.arrivalDate && dateFields.arrivalDayOffset === 1} onPress={() => setDateFields((current) => ({ ...current, arrivalDate: undefined, arrivalDayOffset: 1 }))}>Il giorno successivo</Pill>
            <Pill testID="edit-arrival-day-specific" active={Boolean(dateFields.arrivalDate)} onPress={() => setDateFields((current) => ({ ...current, arrivalDate: current.arrivalDate || current.departure, arrivalDayOffset: undefined }))}>Data specifica</Pill>
          </View>
          <EditorField label="Data di arrivo specifica (facoltativa)" value={dateFields.arrivalDate ?? ''} onChangeText={(value) => setDateFields((current) => ({ ...current, arrivalDate: value || undefined, arrivalDayOffset: value ? undefined : current.arrivalDayOffset ?? 0 }))} placeholder="2026-09-13" testID="edit-arrival-date" />
          <EditorField label="Orario di arrivo nella destinazione" value={dateFields.arrivalTime} onChangeText={(value) => setDateFields((current) => ({ ...current, arrivalTime: value }))} placeholder="15:30" testID="edit-arrival-time" />
          <Text style={[s.editorLabel, { color: C.foreground }]}>Prima destinazione dopo l’arrivo</Text>
          <View style={s.editorPills}>
            <Pill active={dateFields.arrivalDestinationKind === 'lodging'} onPress={() => setDateFields((current) => ({ ...current, arrivalDestinationKind: 'lodging', arrivalDestinationPoint: undefined }))}>Alloggio</Pill>
            <Pill active={dateFields.arrivalDestinationKind === 'first-activity'} onPress={() => setDateFields((current) => ({ ...current, arrivalDestinationKind: 'first-activity', arrivalDestinationPoint: undefined }))}>Prima attività</Pill>
            <Pill active={dateFields.arrivalDestinationKind === 'custom'} onPress={() => setDateFields((current) => ({ ...current, arrivalDestinationKind: 'custom' }))}>Punto personalizzato</Pill>
          </View>
          {dateFields.arrivalDestinationKind === 'custom' ? <EditorField label="Punto personalizzato" value={dateFields.arrivalDestinationPoint?.label ?? ''} onChangeText={(value) => setDateFields((current) => ({ ...current, arrivalDestinationPoint: value.trim() ? { id: nodeIdForLabel(value, 'manual'), label: value.trim(), type: 'custom', placeId: `manual-${value.trim().toLowerCase().replace(/[^a-z0-9]+/gi, '-')}`, source: 'Inserito manualmente', reliabilityStatus: 'MISSING', geoStatus: 'MISSING' } as LocationNode : undefined }))} placeholder="Es. Piazza principale" testID="edit-arrival-destination-custom" /> : null}
          <EditorField label="Orario di partenza dalla destinazione" value={dateFields.departureTime} onChangeText={(value) => setDateFields((current) => ({ ...current, departureTime: value }))} placeholder="11:00" testID="edit-departure-time" />
          {pendingDateFields ? (
            <View testID="date-duration-confirmation" style={[s.confirmation, { backgroundColor: C.secondary, borderColor: C.border }]}>
              <Text style={[s.confirmTitle, { color: C.foreground }]}>Conferma il ricalcolo</Text>
              <Text style={[s.confirmText, { color: C.mutedForeground }]}>Conserviamo attività, ordine e note. Aggiorniamo solo le giornate e le tratte dipendenti da date, arrivo o prima destinazione.</Text>
              <Button testID="confirm-date-duration" onPress={() => void applyDateChanges(pendingDateFields)} icon="check">Conferma e ricalcola</Button>
              <Button testID="cancel-date-duration" variant="ghost" onPress={() => setPendingDateFields(null)} icon="x">Annulla</Button>
            </View>
          ) : (
            <>
              <Button testID="save-trip-dates" onPress={submitDateChanges} icon="check">Salva date e ricalcola</Button>
              <Button testID="cancel-trip-dates" variant="ghost" onPress={closeDateEditor} icon="x">Annulla</Button>
            </>
          )}
        </View>
      ) : null}

      {isEditing ? (
        <View style={[s.editorIntro, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={s.modeRow}>
            <View><Text style={[s.editorTitle, { color: C.foreground }]}>Modalità modifica</Text><Text style={[s.editorHint, { color: C.mutedForeground }]}>Le modifiche restano in bozza fino al salvataggio.</Text></View>
            <Feather name="edit-3" size={18} color={C.primary} />
          </View>
          <Text style={[s.fieldLabel, { color: C.foreground }]}>Spostamenti durante il viaggio</Text>
          <View style={s.pills}>
            {tripTransportOptions.map((transport) => <Pill key={transport} testID={`trip-transport-${transport}`} active={visiblePlan.transport === transport} onPress={() => updateDraft((current) => ({ ...current, transport }))}>{transportLabels[transport]}</Pill>)}
          </View>
        </View>
      ) : null}

      {!isEditing && !dateEditorVisible && selectedTodayDay ? (
        <View testID="today-mode">
          <SectionTitle title="Oggi" action={`Giorno ${selectedTodayDay.day}`} />
          <View style={[s.todayHeader, { backgroundColor: C.card, borderColor: C.border }]}>
            <Pressable
              testID="today-previous-day"
              accessibilityRole="button"
              accessibilityLabel="Giorno precedente"
              disabled={selectedTodayIndex <= 0}
              onPress={() => setTodayDay(visiblePlan.days[selectedTodayIndex - 1]?.day)}
              style={[s.todayNavButton, { borderColor: C.border, opacity: selectedTodayIndex <= 0 ? 0.45 : 1 }]}
            ><Feather name="chevron-left" size={18} color={C.primary} /><Text style={[s.todayNavText, { color: C.primary }]}>Precedente</Text></Pressable>
            <View style={s.todayLabel}><Text style={[s.todayDate, { color: C.mutedForeground }]}>{displayDayDate(selectedTodayDay.date)}</Text><Text style={[s.todayTitle, { color: C.foreground }]}>{selectedTodayDay.label}</Text></View>
            <Pressable
              testID="today-next-day"
              accessibilityRole="button"
              accessibilityLabel="Giorno successivo"
              disabled={selectedTodayIndex >= visiblePlan.days.length - 1}
              onPress={() => setTodayDay(visiblePlan.days[selectedTodayIndex + 1]?.day)}
              style={[s.todayNavButton, { borderColor: C.border, opacity: selectedTodayIndex >= visiblePlan.days.length - 1 ? 0.45 : 1 }]}
            ><Text style={[s.todayNavText, { color: C.primary }]}>Successivo</Text><Feather name="chevron-right" size={18} color={C.primary} /></Pressable>
          </View>
          <RouteMapPreview
            itinerary={visiblePlan}
            viewMode={todayMapView}
            selectedDay={selectedTodayDay.day}
            title={todayMapView === 'day' ? 'Mappa del giorno' : undefined}
            showSearch
            selectedNodeId={selectedNodeId}
            selectedSegmentId={selectedSegmentId}
            onViewModeChange={setTodayMapView}
            onSelectedDayChange={setTodayDay}
            onSelectNode={setSelectedNodeId}
            onSelectSegment={setSelectedSegmentId}
            onAddSearchResult={addGeoSearchResult}
            onMapSnapshotChange={persistMapSnapshot}
          />
          <WeatherCard
            title="Meteo di oggi"
            record={selectedWeather}
            loading={weatherLoading}
            expanded={expandedWeatherId === selectedWeather?.id}
            alerts={selectedWeatherAlerts}
            onToggle={() => setExpandedWeatherId((current) => current === selectedWeather?.id ? undefined : selectedWeather?.id)}
            onRefresh={() => void refreshWeather()}
            onResolveLocation={startEditing}
          />
          <NextActivityCard
            day={selectedTodayDay}
            activity={nextTodayActivity}
            planTransport={visiblePlan.transport}
            onOpenMap={(activity, index) => {
              setTodayMapView('day');
              setSelectedNodeId(nodeIdForActivity(activity, index));
            }}
            onToggleCompleted={(activity, index) => toggleActivityCompletion(selectedTodayDay.day, index)}
          />
          <View style={s.todayTimeline}>
            <Text style={[s.todayTimelineTitle, { color: C.foreground }]}>Timeline della giornata</Text>
            {selectedTodayTimeline.map((entry, entryIndex) => entry.kind === 'route' ? (
              <RouteCard
                key={`today-${entry.segment.id}-${entryIndex}`}
                segment={entry.segment}
                compact
                selected={selectedSegmentId === entry.segment.id}
                onSelectNode={setSelectedNodeId}
                onSelectSegment={setSelectedSegmentId}
                onToggleCompleted={toggleSegmentCompletion}
                onCalculateProvider={requestProviderRoute}
              />
            ) : (
              <ActivityCard
                key={`today-${entry.activity.id ?? `${selectedTodayDay.day}-${entry.activityIndex}`}`}
                activity={entry.activity}
                activityIndex={entry.activityIndex}
                planTransport={visiblePlan.transport}
                weatherNote={visiblePlan.weatherMode === 'seasonal'}
                tripId={tripId}
                selected={selectedNodeId === nodeIdForActivity(entry.activity, entry.activityIndex)}
                onSelectNode={setSelectedNodeId}
                onToggleCompleted={() => toggleActivityCompletion(selectedTodayDay.day, entry.activityIndex)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <SectionTitle title={isEditing ? 'Timeline' : 'Tutto l’itinerario'} action={isEditing ? 'Modalità modifica' : 'Tutti i giorni'} />
       {!visiblePlan.interurbanRoutes?.length && !visiblePlan.days.some((day) => day.segments?.length) ? (
         <EmptyState
           testID="empty-routes"
           icon="navigation"
           title="Nessuna tratta ancora"
           description="Le attività restano nel loro ordine. Aggiungi un punto di partenza per preparare collegamenti locali da verificare."
           actionLabel="Aggiungi punto di partenza"
           onAction={openOriginEditor}
         />
       ) : null}
      {visiblePlan.interurbanRoutes?.length ? (
        <View style={s.routeList}>
          <Text style={[s.routeHeading, { color: C.foreground }]}>Tratte tra località</Text>
          {visiblePlan.interurbanRoutes.map((segment) => <RouteCard key={segment.id} segment={segment} selected={selectedSegmentId === segment.id} onSelectNode={setSelectedNodeId} onSelectSegment={setSelectedSegmentId} onToggleCompleted={toggleSegmentCompletion} onCalculateProvider={requestProviderRoute} />)}
        </View>
      ) : null}
      {!isEditing && !dateEditorVisible ? (
        <View style={s.discoverPlaces}>
          <Text style={[s.routeHeading, { color: C.foreground }]}>Un luogo da scoprire</Text>
          {[discoveryPlace].map((place) => (
            <Pressable key={place.id} testID={`discover-place-${place.id}`} onPress={() => router.push({ pathname: '/place', params: { data: JSON.stringify(place), tripId: tripId ?? '' } })} style={[s.discoveryCard, { backgroundColor: C.secondary, borderColor: C.border }]}>
              <View style={[s.discoveryIcon, { backgroundColor: C.card }]}><Feather name="compass" size={18} color={C.primary} /></View>
              <View style={{ flex: 1 }}><Text style={[s.discoveryTitle, { color: C.foreground }]}>{place.title}</Text><Text style={[s.discoveryText, { color: C.mutedForeground }]}>{place.whyRecommended}</Text></View>
              <Feather name="arrow-right" size={18} color={C.primary} />
            </Pressable>
          ))}
        </View>
      ) : null}
       {providerRouteMessage ? <View testID="provider-route-message" style={[s.providerNotice, { backgroundColor: C.secondary, borderColor: C.border }]}><Text style={[s.repositionText, { color: C.foreground }]}>{providerRouteMessage}</Text></View> : null}
       {pendingProviderRoute ? (
         <View testID="provider-route-confirmation" style={[s.providerNotice, { backgroundColor: C.secondary, borderColor: C.border }]}>
           <Text style={[s.repositionTitle, { color: C.foreground }]}>Conferma percorso online</Text>
           <Text style={[s.repositionText, { color: C.mutedForeground }]}>Aggiorneremo solo questa tratta con dati GraphHopper. Mezzo, fonte, data di calcolo e geometria verranno conservati; le altre tratte resteranno invariate.</Text>
           <Button testID="confirm-provider-route" icon="check" onPress={() => void confirmProviderRoute()}>Usa percorso calcolato</Button>
           <Button variant="ghost" icon="x" onPress={() => setPendingProviderRoute(null)}>Annulla</Button>
         </View>
       ) : null}
      {visiblePlan.days.map((day, dayIndex) => (
        <View key={`${day.day}-${day.date}`} style={s.day}>
          <View style={s.rail}><View style={[s.dot, { backgroundColor: C.primary }]} /><View style={[s.line, { backgroundColor: C.border }]} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[s.dayDate, { color: C.primary }]}>{displayDayDate(day.date).toUpperCase()} · GIORNO {day.day}</Text>
            <Text style={[s.dayTitle, { color: C.foreground }]}>{day.label}</Text>
            {!isEditing ? (
              <View style={[s.originBar, { backgroundColor: C.secondary, borderColor: C.border }]}>
                <Text style={[s.originText, { color: C.foreground }]}>Da: {day.origin?.label ?? 'Origine da definire'}</Text>
                <Text style={[s.originText, { color: C.mutedForeground }]}>A: {day.finalDestination?.label ?? 'Destinazione da definire'}</Text>
              </View>
            ) : null}
            {!isEditing ? (
              <WeatherCard
                title={`Meteo · giorno ${day.day}`}
                record={weatherForDay(day.day)}
                expanded={expandedWeatherId === weatherForDay(day.day)?.id}
                alerts={weatherAlerts(weatherForDay(day.day), day.activities.filter((activity) => activity.setting !== 'indoor').length, day.rainyAlternative)}
                onToggle={() => setExpandedWeatherId((current) => current === weatherForDay(day.day)?.id ? undefined : weatherForDay(day.day)?.id)}
                onResolveLocation={startEditing}
              />
            ) : null}
            {day.activities.length === 0 ? (
              <EmptyState
                testID={`empty-day-activities-${day.day}`}
                icon="calendar"
                title="Nessuna attività ancora"
                description="Questa giornata resta salvata. Aggiungi una tappa quando vuoi, senza modificare gli altri giorni."
                actionLabel={isEditing ? 'Aggiungi attività' : 'Modifica itinerario'}
                onAction={isEditing ? () => addActivity(dayIndex) : startEditing}
              />
            ) : isEditing ? (
              <>
                {day.activities.map((activity, activityIndex) => (
                  <View key={activity.id ?? `${day.day}-${activityIndex}`} testID={`activity-editor-${dayIndex}-${activityIndex}`} style={[s.activityEditor, { backgroundColor: C.card, borderColor: C.border }]}>
                    <View style={s.editorActivityHeader}>
                      <Text style={[s.editorActivityNumber, { color: C.primary }]}>ATTIVITÀ {activityIndex + 1}</Text>
                      <Pressable testID={`delete-activity-${dayIndex}-${activityIndex}`} accessibilityRole="button" accessibilityLabel={`Elimina ${activity.title}`} onPress={() => setPendingActivityDeletion({ dayIndex, activityIndex, title: activity.title })} hitSlop={10} style={s.deleteButton}>
                        <Feather name="trash-2" size={17} color={C.destructive} /><Text style={[s.deleteText, { color: C.destructive }]}>Elimina</Text>
                      </Pressable>
                    </View>
                    <EditorField label="Titolo attività" value={activity.title} onChangeText={(title) => updateActivity(dayIndex, activityIndex, { title })} placeholder="Titolo attività" testID={`activity-title-${dayIndex}-${activityIndex}`} />
                    <EditorField label="Luogo da cercare" value={activity.place?.title ?? ''} onChangeText={(value) => updateActivityPlaceQuery(dayIndex, activityIndex, value)} placeholder="Es. Museo, ristorante o piazza" testID={`activity-place-${dayIndex}-${activityIndex}`} />
                    <Button testID={`search-activity-place-${dayIndex}-${activityIndex}`} variant="ghost" icon="search" onPress={() => void searchActivityPlace(dayIndex, activityIndex)}>Cerca luogo</Button>
                    {activityGeoSearch?.dayIndex === dayIndex && activityGeoSearch.activityIndex === activityIndex ? (
                      <View testID={`activity-place-result-${dayIndex}-${activityIndex}`} style={[s.geoSearchResult, { backgroundColor: C.background, borderColor: C.border }]}>
                        <Text style={[s.repositionText, { color: C.mutedForeground }]}>{activityGeoSearch.message}</Text>
                        {activityGeoSearch.candidates.map((candidate) => (
                          <Pressable key={candidate.id} testID={`choose-activity-place-${candidate.id}`} accessibilityRole="button" accessibilityLabel={`Scegli ${candidate.label}`} onPress={() => applyActivityGeoNode(dayIndex, activityIndex, candidate)} style={[s.geoCandidate, { backgroundColor: C.secondary }]}>
                            <Feather name="map-pin" size={14} color={C.primary} />
                            <View style={{ flex: 1 }}><Text style={[s.geoIssueText, { color: C.foreground }]}>{candidate.label}</Text><Text style={[s.geoIssueText, { color: C.mutedForeground }]}>Fonte: {candidate.source ?? 'Fonte non disponibile'} · Stato: {activityStatusLabels[statusForNode(candidate)]}</Text></View>
                            <Feather name="check" size={16} color={C.primary} />
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    <Text style={[s.editorHint, { color: C.mutedForeground }]}>Posizione: {activityStatusLabels[activity.status ?? activityStatusFor(activity)]}. Non chiediamo coordinate e non associamo risultati ambigui automaticamente.</Text>
                    <EditorField label="Orario" value={activity.time} onChangeText={(time) => updateActivity(dayIndex, activityIndex, { time })} placeholder="09:30" testID={`activity-time-${dayIndex}-${activityIndex}`} />
                    <EditorField label="Durata (facoltativa)" value={activity.duration ?? ''} onChangeText={(duration) => updateActivity(dayIndex, activityIndex, { duration: duration || undefined })} placeholder="Es. 90 min" testID={`activity-duration-${dayIndex}-${activityIndex}`} />
                    <EditorField label="Descrizione" value={activity.detail} onChangeText={(detail) => updateActivity(dayIndex, activityIndex, { detail })} placeholder="Descrizione dell’attività" multiline testID={`activity-detail-${dayIndex}-${activityIndex}`} />
                    <EditorField label="Note (facoltative)" value={activity.notes ?? ''} onChangeText={(notes) => updateActivity(dayIndex, activityIndex, { notes: notes || undefined })} placeholder="Promemoria personale" multiline testID={`activity-notes-${dayIndex}-${activityIndex}`} />
                    <Text style={[s.fieldLabel, { color: C.foreground }]}>Giorno</Text>
                    <View style={s.pills}>
                      {visiblePlan.days.map((targetDay, targetIndex) => <Pill key={targetDay.day} testID={`activity-day-${dayIndex}-${activityIndex}-${targetIndex}`} active={targetIndex === dayIndex} onPress={() => moveActivityToDay(dayIndex, activityIndex, targetIndex)}>Giorno {targetDay.day}</Pill>)}
                    </View>
                    <View style={s.orderActions}>
                      <Button testID={`activity-move-earlier-${dayIndex}-${activityIndex}`} variant="ghost" icon="arrow-up" disabled={activityIndex === 0} onPress={() => moveActivityWithinDay(dayIndex, activityIndex, activityIndex - 1)}>Sposta prima</Button>
                      <Button testID={`activity-move-later-${dayIndex}-${activityIndex}`} variant="ghost" icon="arrow-down" disabled={activityIndex === day.activities.length - 1} onPress={() => moveActivityWithinDay(dayIndex, activityIndex, activityIndex + 1)}>Sposta dopo</Button>
                    </View>
                    <Text style={[s.fieldLabel, { color: C.foreground }]}>Stato attività</Text>
                    <View style={s.pills}>
                      {editableActivityStatuses.map((status) => <Pill key={status} testID={`activity-status-${dayIndex}-${activityIndex}-${status}`} active={(activity.status ?? activityStatusFor(activity)) === status} onPress={() => updateActivity(dayIndex, activityIndex, { status })}>{activityStatusLabels[status]}</Pill>)}
                    </View>
                    <Text style={[s.fieldLabel, { color: C.foreground }]}>Come arrivi?</Text>
                    <View style={s.pills}>
                      {activityTransportOptions.map((transport) => <Pill key={transport} testID={`activity-transport-${dayIndex}-${activityIndex}-${transport}`} active={activity.transport === transport} onPress={() => updateActivity(dayIndex, activityIndex, { transport })}>{transportLabels[transport]}</Pill>)}
                    </View>
                    <Text style={[s.fieldLabel, { color: C.foreground }]}>Ambiente</Text>
                    <View style={s.pills}>
                      {settingOptions.map((setting) => <Pill key={setting} testID={`activity-setting-${dayIndex}-${activityIndex}-${setting}`} active={activity.setting === setting} onPress={() => updateActivity(dayIndex, activityIndex, { setting })}>{settingLabels[setting]}</Pill>)}
                    </View>
                    <Pressable testID={`activity-booking-${dayIndex}-${activityIndex}`} accessibilityRole="checkbox" accessibilityState={{ checked: activity.requiresBooking }} onPress={() => updateActivity(dayIndex, activityIndex, { requiresBooking: !activity.requiresBooking })} style={[s.bookingToggle, { borderColor: activity.requiresBooking ? C.primary : C.border, backgroundColor: activity.requiresBooking ? C.secondary : C.background }]}>
                      <Feather name={activity.requiresBooking ? 'check-square' : 'square'} size={18} color={C.primary} /><Text style={[s.bookingText, { color: C.foreground }]}>Richiede prenotazione</Text>
                    </Pressable>
                    {pendingActivityDeletion?.dayIndex === dayIndex && pendingActivityDeletion.activityIndex === activityIndex ? (
                      <View testID={`delete-activity-confirmation-${dayIndex}-${activityIndex}`} accessibilityRole="alert" style={[s.deleteConfirmation, { backgroundColor: C.destructiveContainer, borderColor: C.destructive }]}>
                        <Text style={[s.repositionTitle, { color: C.foreground }]}>Eliminare “{pendingActivityDeletion.title}”?</Text>
                        <Text style={[s.repositionText, { color: C.mutedForeground }]}>Rimuoveremo solo questa attività e aggiorneremo le tratte adiacenti al prossimo salvataggio. Le altre giornate resteranno invariate.</Text>
                        <Button testID={`confirm-delete-activity-${dayIndex}-${activityIndex}`} variant="destructive" icon="trash-2" onPress={confirmActivityDeletion}>Conferma eliminazione</Button>
                        <Button testID={`cancel-delete-activity-${dayIndex}-${activityIndex}`} variant="ghost" icon="x" onPress={() => setPendingActivityDeletion(null)}>Annulla</Button>
                      </View>
                    ) : null}
                    <Button testID={`inspect-reposition-${dayIndex}-${activityIndex}`} variant="ghost" icon="shuffle" onPress={() => inspectRepositioning(dayIndex, activityIndex)}>Valuta posizione nel giorno</Button>
                    {repositionProposal?.dayIndex === dayIndex && repositionProposal.suggestion.activityIndex === activityIndex ? (
                      <View testID={`reposition-proposal-${dayIndex}-${activityIndex}`} style={[s.reposition, { backgroundColor: C.primaryContainer, borderColor: C.primary }]}>
                        <Text style={[s.repositionTitle, { color: C.foreground }]}>Proposta di riposizionamento</Text>
                        <Text style={[s.repositionText, { color: C.mutedForeground }]}>{repositionProposal.suggestion.reason}</Text>
                        <View style={[s.repositionCompare, { borderColor: C.border }]}>
                          <Text style={[s.repositionText, { color: C.foreground }]}>Attuale → posizione {repositionProposal.suggestion.currentOrder}</Text>
                          <Text style={[s.repositionText, { color: C.foreground }]}>Suggerito → posizione {repositionProposal.suggestion.suggestedOrder}</Text>
                        </View>
                        {repositionProposal.suggestion.distanceDifferenceKm !== undefined ? <Text style={[s.repositionText, { color: C.mutedForeground }]}>Riduzione del collegamento diretto: {repositionProposal.suggestion.distanceDifferenceKm.toFixed(1)} km. Durata stradale: non calcolata.</Text> : null}
                        <Text style={[s.repositionText, { color: C.mutedForeground }]}>Tratte coinvolte: collegamento precedente e successivo della giornata.</Text>
                        <Text style={[s.repositionText, { color: C.mutedForeground }]}>Dati usati: {repositionProposal.suggestion.usedData.length ? repositionProposal.suggestion.usedData.join(' · ') : 'Nessuno'}.</Text>
                        <Text style={[s.repositionText, { color: C.mutedForeground }]}>Dati mancanti: {repositionProposal.suggestion.missingData.length ? repositionProposal.suggestion.missingData.join(' · ') : 'Nessuno'}.</Text>
                        {repositionProposal.suggestion.status === 'CALCULABLE' && repositionProposal.suggestion.suggestedIndex !== activityIndex ? <Button testID={`accept-reposition-${dayIndex}-${activityIndex}`} icon="check" onPress={acceptRepositioning}>Accetta riposizionamento</Button> : null}
                        {repositionProposal.suggestion.status !== 'DISMISSED' ? <Button testID={`keep-reposition-${dayIndex}-${activityIndex}`} variant="secondary" icon="map-pin" onPress={keepRepositioning}>Mantieni posizione attuale</Button> : null}
                        <Button variant="ghost" icon="x" onPress={() => setRepositionProposal(null)}>Annulla</Button>
                      </View>
                    ) : null}
                  </View>
                ))}
                <Button testID={`add-activity-${dayIndex}`} variant="ghost" icon="plus" onPress={() => addActivity(dayIndex)}>Aggiungi attività</Button>
              </>
            ) : (
              <>
                {timelineEntries(day).map((entry, entryIndex) => entry.kind === 'route' ? (
                  <RouteCard key={`${entry.segment.id}-${entryIndex}`} segment={entry.segment} compact selected={selectedSegmentId === entry.segment.id} onSelectNode={setSelectedNodeId} onSelectSegment={setSelectedSegmentId} onToggleCompleted={toggleSegmentCompletion} onCalculateProvider={requestProviderRoute} />
                ) : (
                  <ActivityCard key={entry.activity.id ?? `${day.day}-${entry.activityIndex}`} activity={entry.activity} activityIndex={entry.activityIndex} planTransport={visiblePlan.transport} weatherNote={visiblePlan.weatherMode === 'seasonal'} tripId={tripId} selected={selectedNodeId === nodeIdForActivity(entry.activity, entry.activityIndex)} onSelectNode={setSelectedNodeId} onToggleCompleted={() => toggleActivityCompletion(day.day, entry.activityIndex)} />
                ))}
              </>
            )}
            <View style={[s.altBox, { backgroundColor: C.background, borderColor: C.border }]}>
              <Text style={[s.altTitle, { color: C.foreground }]}>Se cambia il ritmo</Text>
              <Text style={[s.altText, { color: C.mutedForeground }]}>Pioggia: {day.rainyAlternative}</Text>
              <Text style={[s.altText, { color: C.mutedForeground }]}>Stanchezza: {day.tiredAlternative}</Text>
            </View>
          </View>
        </View>
      ))}

      {isEditing ? (
        <View style={s.editActions}>
          <Button testID="save-itinerary-changes" onPress={() => void saveChanges()} disabled={saveState === 'saving'} icon="check">Salva modifiche</Button>
          <Button testID="cancel-itinerary-changes" variant="ghost" onPress={cancelEditing} disabled={saveState === 'saving'} icon="x">Annulla modifiche</Button>
          {restoreConfirmationVisible ? (
            <View testID="restore-confirmation" style={[s.restoreConfirmation, { backgroundColor: C.secondary, borderColor: C.border }]}>
              <Text style={[s.restoreConfirmTitle, { color: C.foreground }]}>Ripristinare il piano originale?</Text>
              <Text style={[s.restoreConfirmText, { color: C.mutedForeground }]}>Le modifiche in bozza verranno sostituite. Potrai ancora annullare prima di salvare.</Text>
              <Button testID="confirm-restore-original" onPress={restoreOriginal} icon="rotate-ccw">Ripristina</Button>
              <Button testID="cancel-restore-original" variant="ghost" onPress={() => setRestoreConfirmationVisible(false)} icon="x">Annulla</Button>
            </View>
          ) : (
            <Pressable testID="restore-original-plan" onPress={() => setRestoreConfirmationVisible(true)} style={s.restoreButton}><Feather name="rotate-ccw" size={16} color={C.destructive} /><Text style={[s.restoreText, { color: C.destructive }]}>Ripristina piano originale</Text></Pressable>
          )}
        </View>
      ) : !dateEditorVisible ? (
        <>
          <SectionTitle title="Prossimi passi" />
          {visiblePlan.nextSteps.map((step, index) => <View key={step} style={s.step}><View style={[s.stepNum, { backgroundColor: C.sage }]}><Text style={{ color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 12 }}>{index + 1}</Text></View><Text style={[s.stepText, { color: C.foreground }]}>{step}</Text></View>)}
          <View style={s.actions}>
            <Button variant="secondary" icon="bookmark" onPress={() => void savePlan(visiblePlan)}>Salva viaggio</Button>
            <Button variant="ghost" icon="share-2" onPress={() => void shareTrip()}>Condividi</Button>
            <Button testID="export-trip-json" variant="ghost" icon="download" onPress={() => void exportTripJson()}>Esporta JSON</Button>
          </View>
        </>
      ) : null}
    </KeyboardAwareScrollViewCompat>
  );
}

function EditorField({ label, value, onChangeText, placeholder, testID, multiline = false }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; testID: string; multiline?: boolean }) {
  const C = useColors();
  return (
    <View>
      <Text style={[s.fieldLabel, { color: C.foreground }]}>{label}</Text>
      <TextInput testID={testID} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={C.mutedForeground} multiline={multiline} keyboardType={label.includes('Orario') ? 'numbers-and-punctuation' : 'default'} style={[s.input, multiline && s.multilineInput, { color: C.foreground, backgroundColor: C.background, borderColor: C.border }]} />
    </View>
  );
}

function NextActivityCard({
  day,
  activity,
  planTransport,
  onOpenMap,
  onToggleCompleted,
}: {
  day: Itinerary['days'][number];
  activity?: Activity;
  planTransport: Transport;
  onOpenMap: (activity: Activity, index: number) => void;
  onToggleCompleted: (activity: Activity, index: number) => void;
}) {
  const C = useColors();
  if (!activity) {
    return (
      <View testID="today-complete" style={[s.nextActivity, { backgroundColor: C.sage, borderColor: C.border }]}>
        <Feather name="check-circle" size={20} color={C.primary} />
        <View style={{ flex: 1 }}><Text style={[s.nextKicker, { color: C.primary }]}>OGGI</Text><Text style={[s.nextTitle, { color: C.foreground }]}>Giornata completata</Text><Text style={[s.nextText, { color: C.mutedForeground }]}>La mappa e la timeline della giornata restano disponibili per consultazione.</Text></View>
      </View>
    );
  }
  const activityIndex = day.activities.indexOf(activity);
  const nodeId = nodeIdForActivity(activity, activityIndex);
  const previousRoute = day.segments?.find((segment) => segment.toNodeId === nodeId);
  const nextRoute = day.segments?.find((segment) => segment.fromNodeId === nodeId);
  const selectedTransport = activity.transport ?? planTransport;
  return (
    <View testID="today-next-activity" style={[s.nextActivity, { backgroundColor: C.secondary, borderColor: C.border }]}>
      <View style={s.nextTop}><View><Text style={[s.nextKicker, { color: C.primary }]}>PROSSIMA ATTIVITÀ</Text><Text style={[s.nextTitle, { color: C.foreground }]}>{activity.title}</Text></View><Text style={[s.nextTime, { color: C.primary }]}>{activity.time || 'Orario non inserito'}</Text></View>
      <Text style={[s.nextText, { color: C.mutedForeground }]}>{activity.place?.address || activity.place?.city || 'Luogo da definire'} · {transportLabels[selectedTransport]} · Stato: In programma</Text>
      <Text style={[s.nextText, { color: C.mutedForeground }]}>Tratta precedente: {previousRoute ? `${previousRoute.origin.label} → ${previousRoute.destination.label}` : 'Da definire'}</Text>
      <Text style={[s.nextText, { color: C.mutedForeground }]}>Tratta successiva: {nextRoute ? `${nextRoute.origin.label} → ${nextRoute.destination.label}` : 'Da definire'}</Text>
      <View style={s.nextActions}>
        <Button testID="today-open-next-on-map" variant="ghost" icon="map-pin" onPress={() => onOpenMap(activity, activityIndex)}>Apri sulla mappa</Button>
        <Button testID="today-complete-next-activity" icon="check" onPress={() => onToggleCompleted(activity, activityIndex)}>Segna completata</Button>
      </View>
    </View>
  );
}

function RouteCard({ segment, compact = false, selected = false, onSelectNode, onSelectSegment, onToggleCompleted, onCalculateProvider }: { segment: RouteSegment; compact?: boolean; selected?: boolean; onSelectNode?: (nodeId: string) => void; onSelectSegment?: (segmentId: string) => void; onToggleCompleted?: (segmentId: string) => void; onCalculateProvider?: (segment: RouteSegment) => void }) {
  const C = useColors();
  return (
    <View style={[s.routeCard, compact && s.routeCardCompact, { backgroundColor: C.background, borderColor: selected ? C.primary : C.border }]}>
      <Pressable accessibilityRole={onSelectNode ? 'button' : undefined} accessibilityLabel={`Seleziona la tratta da ${segment.origin.label} a ${segment.destination.label} sulla mappa`} onPress={() => { onSelectNode?.(segment.toNodeId); onSelectSegment?.(segment.id); }} style={s.routeTop}><Feather name={segment.type === 'interurban' ? 'map' : 'navigation'} size={14} color={C.primary} /><Text style={[s.routeTitle, { color: C.foreground }]}>{segment.origin.label} → {segment.destination.label}</Text></Pressable>
      <View style={s.statusLine}><Text style={[s.routeMeta, { color: C.primary }]}>{transportLabels[segment.recommendedMode]}</Text><StatusBadge state={routeDataState(segment)} /></View>
      <Text style={[s.routeText, { color: C.mutedForeground }]}>Durata: {segment.duration ?? 'Da definire'} · {segment.distance ?? 'Distanza da definire'} · {segment.cost}</Text>
      {!compact ? <Text style={[s.routeText, { color: C.mutedForeground }]}>Comfort: {segment.comfort} · Meteo: {segment.weatherImpact}</Text> : null}
      <Text style={[s.routeText, { color: C.mutedForeground }]}>Geometria: {segment.geometry?.kind === 'route' ? 'Disponibile' : 'Da definire'}</Text>
      <Text style={[s.routeNote, { color: compact ? C.mutedForeground : C.foreground }]}>{segment.note}</Text>
      {segment.source ? <Text style={[s.routeSource, { color: C.mutedForeground }]}>Fonte: {segment.source}{segment.lastCalculatedAt ? ` · calcolata ${new Date(segment.lastCalculatedAt).toLocaleDateString('it-IT')}` : ''}</Text> : null}
      {onToggleCompleted ? <Button testID={`complete-route-${segment.id}`} variant="ghost" icon={segment.completed ? 'rotate-ccw' : 'check'} onPress={() => onToggleCompleted(segment.id)}>{segment.completed ? 'Riapri tratta' : 'Segna completata'}</Button> : null}
      {onCalculateProvider && (segment.recommendedMode === 'a piedi' || segment.recommendedMode === 'auto' || segment.recommendedMode === 'taxi') ? <Button variant="ghost" icon="refresh-cw" onPress={() => onCalculateProvider(segment)}>Aggiorna percorso online</Button> : null}
    </View>
  );
}

function ActivityCard({ activity, activityIndex, planTransport, weatherNote, tripId, selected = false, onSelectNode, onToggleCompleted }: { activity: Activity; activityIndex: number; planTransport: Transport; weatherNote: boolean; tripId?: string; selected?: boolean; onSelectNode?: (nodeId: string) => void; onToggleCompleted?: () => void }) {
  const C = useColors();
  const router = useRouter();
  const selectedTransport = activity.transport ?? planTransport;
  const selectedDetail = transportDetails(selectedTransport);
  const suggested = weatherNote && selectedTransport === 'a piedi' ? 'Trasporto pubblico' : selectedTransport === 'a piedi' ? 'A piedi' : selectedTransport === 'misto' ? 'Trasporto pubblico' : transportLabels[selectedTransport];
  const reason = weatherNote
    ? 'Suggerimento provvisorio basato su distanza e preferenze. Il meteo sarà considerato quando entrerà nella finestra previsionale.'
    : selectedTransport === 'a piedi'
      ? 'Percorso breve e gratuito, adatto al ritmo della giornata.'
      : 'Scelta consigliata per contenere il tempo di spostamento.';
  const activityState = activityDataState(activity.completed ? 'COMPLETED' : activity.status ?? activityStatusFor(activity));
  const locationState = placeDataState(activity);
  return (
    <View style={[s.activity, { backgroundColor: C.card, borderColor: selected ? C.primary : C.border, opacity: activity.completed ? 0.72 : 1 }]}>
      <View style={[s.time, { backgroundColor: C.sand }]}><Text style={{ color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 11 }}>{activity.time}</Text></View>
      <View style={{ flex: 1 }}>
        <Pressable testID={`open-place-${activity.place?.id ?? activity.title}`} onPress={() => router.push({ pathname: '/place', params: { data: JSON.stringify(activity.place), tripId: tripId ?? '' } })}>
          <Text style={[s.activityTitle, { color: C.foreground }]}>{activity.title} <Feather name="arrow-up-right" size={12} /></Text>
        </Pressable>
        <Text style={[s.activityDetail, { color: C.mutedForeground }]}>{activity.detail}</Text>
        <View style={s.activityMeta}>
          <Text style={[s.metaText, { color: C.primary }]}>{transportLabels[selectedTransport]}</Text>
          <Text style={[s.metaText, { color: C.mutedForeground }]}>· {settingLabels[activity.setting ?? 'outdoor']}</Text>
          {activity.requiresBooking && <Text style={[s.metaText, { color: C.primary }]}>· Prenotazione</Text>}
        </View>
        <View style={s.activityBadges}><StatusBadge state={activityState} /><StatusBadge state={locationState} detail="Posizione" /></View>
        {activity.duration ? <Text style={[s.activityStatus, { color: C.mutedForeground }]}>Durata: {activity.duration}</Text> : null}
        {activity.notes ? <Text style={[s.activityStatus, { color: C.mutedForeground }]}>Note: {activity.notes}</Text> : null}
        <Pressable testID={`select-timeline-node-${nodeIdForActivity(activity, activityIndex)}`} accessibilityRole="button" onPress={() => onSelectNode?.(nodeIdForActivity(activity, activityIndex))} style={s.selectNodeButton}>
          <Feather name="map-pin" size={12} color={C.primary} /><Text style={[s.selectNodeText, { color: C.primary }]}>Apri sulla mappa</Text>
        </Pressable>
        {onToggleCompleted ? <Button testID={`complete-activity-${nodeIdForActivity(activity, activityIndex)}`} variant="ghost" icon={activity.completed ? 'rotate-ccw' : 'check'} onPress={onToggleCompleted}>{activity.completed ? 'Riapri attività' : 'Segna completata'}</Button> : null}
        <View style={[s.transportBlock, { borderColor: C.border }]}>
          <Text style={[s.transportTitle, { color: C.foreground }]}>Come vuoi spostarti?</Text>
          {activityTransportOptions.map((option) => {
            const detail = transportDetails(option);
            return <Text key={option} style={[s.transportOption, { color: option === selectedTransport ? C.primary : C.mutedForeground }]}>{transportLabels[option]} · {detail.duration} · {detail.distance} · {detail.cost} · {detail.comfort}</Text>;
          })}
          <Text style={[s.transportSuggestion, { color: C.foreground }]}>Suggerimento: {suggested}</Text>
          <Text style={[s.transportReason, { color: C.mutedForeground }]}>{reason} I dati non sono verificati da un provider.</Text>
          {selectedTransport === 'a piedi' && <Text style={[s.transportReason, { color: C.mutedForeground }]}>A piedi: comfort {selectedDetail.comfort}; verifica il meteo prima di una distanza elevata.</Text>}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 42 },
  status: { borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  statusText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, flex: 1 },
  hero: { borderRadius: 24, padding: 18 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between' },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.1 },
  heroTitle: { fontFamily: 'Inter_700Bold', fontSize: 24, marginTop: 5 },
  weatherIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  profile: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 12, lineHeight: 18 },
  infoGrid: { marginTop: 17 },
  budgetHint: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 14, marginTop: -5, marginBottom: 10 },
  weather: { borderRadius: 14, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8 },
  weatherText: { fontFamily: 'Inter_400Regular', fontSize: 11, flex: 1 },
  warning: { borderRadius: 12, borderWidth: 1, padding: 10, marginTop: 10, flexDirection: 'row', gap: 8 },
  warningText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 16 },
  topActions: { gap: 9, marginTop: 18 },
  modeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  editorIntro: { borderRadius: 18, borderWidth: 1, padding: 15, marginTop: 18, gap: 2 },
  editorTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  editorHint: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, marginTop: 3 },
  geoIssue: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10, paddingTop: 10, gap: 5 },
  geoIssueTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  geoIssueText: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 15 },
  geoCandidate: { borderRadius: 10, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3 },
  editorLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 14, marginBottom: 7 },
  editorPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 4 },
  formError: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 11 },
  confirmation: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 8, marginTop: 14 },
  confirmTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  confirmText: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 14, marginBottom: 7 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  todayHeader: { borderRadius: 16, borderWidth: 1, padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  todayNavButton: { minHeight: 34, borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 2 },
  todayNavText: { fontFamily: 'Inter_600SemiBold', fontSize: 9 },
  todayLabel: { flex: 1, alignItems: 'center' },
  todayDate: { fontFamily: 'Inter_600SemiBold', fontSize: 9, textTransform: 'uppercase' },
  todayTitle: { fontFamily: 'Inter_700Bold', fontSize: 12, marginTop: 2, textAlign: 'center' },
  nextActivity: { borderRadius: 17, borderWidth: 1, padding: 13, marginTop: 12, gap: 6 },
  nextTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  nextKicker: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.9 },
  nextTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, marginTop: 3 },
  nextTime: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  nextText: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 15 },
  nextActions: { gap: 7, marginTop: 4 },
  todayTimeline: { marginTop: 16 },
  todayTimelineTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, marginBottom: 8 },
  day: { flexDirection: 'row', gap: 12, marginTop: 18 },
  rail: { width: 13, alignItems: 'center' },
  dot: { width: 11, height: 11, borderRadius: 6, marginTop: 4 },
  line: { flex: 1, width: 1, marginTop: 7 },
  dayDate: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.7 },
  dayTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, marginTop: 5, marginBottom: 11 },
  originBar: { borderRadius: 12, borderWidth: 1, padding: 10, marginBottom: 9, gap: 3 },
  originText: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  routeList: { marginTop: 3 },
  routeHeading: { fontFamily: 'Inter_700Bold', fontSize: 15, marginTop: 2, marginBottom: 8 },
  routeCard: { borderRadius: 14, borderWidth: 1, padding: 10, marginBottom: 8, gap: 3 },
  routeCardCompact: { marginBottom: 7, padding: 9 },
  routeTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  routeTitle: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  routeMeta: { fontFamily: 'Inter_700Bold', fontSize: 10 },
  routeText: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 14 },
  routeNote: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 14, marginTop: 2 },
  routeSource: { fontFamily: 'Inter_400Regular', fontSize: 9, lineHeight: 13, marginTop: 2 },
  discoverPlaces: { marginTop: 15 },
  discoveryCard: { borderRadius: 16, borderWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  discoveryIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  discoveryTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  discoveryText: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 14, marginTop: 2 },
  activity: { borderRadius: 17, borderWidth: 1, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  activityEditor: { borderRadius: 17, borderWidth: 1, padding: 13, marginBottom: 10 },
  reposition: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 7, marginTop: 8 },
  repositionCompare: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 7, gap: 3 },
  repositionTitle: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  repositionText: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
  geoSearchResult: { borderRadius: 12, borderWidth: 1, padding: 9, gap: 5, marginTop: 7 },
  orderActions: { gap: 7, marginTop: 9 },
  deleteConfirmation: { borderRadius: 12, borderWidth: 1, padding: 10, gap: 7, marginTop: 10 },
  providerNotice: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8, marginTop: 12 },
  editorActivityHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  editorActivityNumber: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.8 },
  time: { borderRadius: 10, paddingVertical: 7, paddingHorizontal: 6 },
  activityTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginBottom: 4 },
  activityDetail: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 15 },
  activityMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginTop: 7 },
  activityBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  metaText: { fontFamily: 'Inter_500Medium', fontSize: 10 },
  activityStatus: { fontFamily: 'Inter_600SemiBold', fontSize: 10, marginTop: 6 },
  transportBlock: { borderTopWidth: 1, marginTop: 9, paddingTop: 8 },
  transportTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 11, marginBottom: 4 },
  transportOption: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 15 },
  transportSuggestion: { fontFamily: 'Inter_600SemiBold', fontSize: 10, marginTop: 6 },
  transportReason: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 14, marginTop: 2 },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontFamily: 'Inter_400Regular', fontSize: 13 },
  multilineInput: { minHeight: 72, textAlignVertical: 'top' },
  deleteButton: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 5 },
  deleteText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  bookingToggle: { minHeight: 45, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, marginTop: 14 },
  bookingText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  altBox: { borderRadius: 15, padding: 12, borderWidth: 1, marginTop: 3 },
  altTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 5 },
  altText: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
  editActions: { gap: 10, marginTop: 25 },
  restoreButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  restoreText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  restoreConfirmation: { borderRadius: 16, borderWidth: 1, padding: 13, gap: 6 },
  restoreConfirmTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  restoreConfirmText: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 12 },
  stepNum: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  actions: { gap: 10, marginTop: 12 },
  selectNodeButton: { alignSelf: 'flex-start', minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  selectNodeText: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
});