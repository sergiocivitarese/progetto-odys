import type {
  Activity,
  ActivitySetting,
  ActivityStatus,
  ActivityTransport,
  ArrivalTransport,
  DataState,
  Itinerary,
  ItinerarySnapshot,
  LocationNode,
  LodgingInfo,
  PlaceMetadata,
  RouteSegment,
  TripDateFields,
  TripForm,
  Transport,
} from '../types/travel';
import {
  activityStatusFor,
  ensureLocationNode,
  nodeIdForActivity,
  normalizeActivity,
  normalizeDayRouteModel,
  normalizeRouteSegment,
} from './routeModel';
import {
  calculateDuration,
  generateItinerary,
  mergeItineraryDaysForDateChange,
  parseBudgetAmount,
  parseCalendarDate,
  parseTravelerCount,
  recalculateDayRoutes,
  recalculateRoutes,
  validateArrivalDate,
  validateDateRange,
  validateSchedule,
  validateTime,
} from './generateItinerary';
import { applyRepositioning } from './repositioning';
import type { RepositionSuggestion } from './repositioning';
import { synchronizeItineraryMap } from './mapModel';
import { patchRouteInPlan } from './routing';
import { demoPlaces, placeForActivity } from '../data/places';

/*
 * Regole della schermata itinerario del progetto Triply (app/itinerary.tsx),
 * estratte come funzioni pure. Ogni funzione riceve un piano e restituisce un
 * nuovo piano: il frontend le usa sulla bozza, il backend sul salvataggio.
 */

// ---------------------------------------------------------------------------
// Etichette e opzioni condivise
// ---------------------------------------------------------------------------

export const TRIP_TRANSPORT_OPTIONS: Transport[] = ['a piedi', 'trasporto pubblico', 'treno', 'autobus', 'auto', 'taxi', 'aereo', 'traghetto', 'misto'];
export const ACTIVITY_TRANSPORT_OPTIONS: ActivityTransport[] = ['a piedi', 'trasporto pubblico', 'treno', 'autobus', 'taxi', 'auto', 'aereo', 'traghetto'];
export const SETTING_OPTIONS: ActivitySetting[] = ['indoor', 'outdoor'];
export const EDITABLE_ACTIVITY_STATUSES: ActivityStatus[] = ['TO_DEFINE', 'TO_VERIFY', 'CONFIRMED'];
export const ARRIVAL_MODES: ArrivalTransport[] = ['aereo', 'treno', 'auto', 'autobus', 'traghetto', 'altro'];

export const TRANSPORT_LABELS: Record<ActivityTransport, string> = {
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

export const ARRIVAL_TRANSPORT_LABELS: Record<ArrivalTransport, string> = { aereo: 'Aereo', treno: 'Treno', auto: 'Auto', autobus: 'Autobus', traghetto: 'Traghetto', altro: 'Altro' };
export const SETTING_LABELS: Record<ActivitySetting, string> = { indoor: 'Indoor', outdoor: 'Outdoor' };

export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  CONFIRMED: 'Confermato',
  SIMULATED: 'Simulato',
  TO_VERIFY: 'Da verificare',
  MISSING: 'Mancante',
  OFFLINE: 'Offline',
  TO_DEFINE: 'Da definire',
  COMPLETED: 'Completata',
};

export const DATA_STATE_LABELS: Record<DataState, string> = {
  confermato: 'Confermato',
  simulato: 'Simulato',
  offline: 'Offline',
  'da-verificare': 'Da verificare',
  mancante: 'Mancante',
  'da-definire': 'Da definire',
  'non-disponibile': 'Non disponibile',
  completata: 'Completata',
};

export const AUTOMATIC_ARRIVAL_TITLES = new Set(['Arrivo nella destinazione', 'Check-in o deposito bagagli']);

export function activityDataState(status: ActivityStatus): DataState {
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

export function placeDataState(activity: Activity): DataState {
  if (!activity.place) return 'da-definire';
  if (activity.place.geoStatus === 'CONFIRMED') return 'confermato';
  if (activity.place.geoStatus === 'DEMO' || activity.place.geoStatus === 'ESTIMATED') return 'simulato';
  if (activity.place.geoStatus === 'TO_VERIFY') return 'da-verificare';
  if (activity.place.geoStatus === 'UNAVAILABLE_OFFLINE') return 'offline';
  return 'mancante';
}

export function routeDataState(segment: RouteSegment): DataState {
  if (segment.completed) return 'completata';
  if (segment.reliability === 'VERIFIED') return 'confermato';
  if (segment.reliability === 'ESTIMATED' || segment.reliability === 'DEMO') return 'simulato';
  if (segment.reliability === 'TO_VERIFY') return 'da-verificare';
  return 'mancante';
}

// ---------------------------------------------------------------------------
// Normalizzazione del piano
// ---------------------------------------------------------------------------

export const FALLBACK_TRIP_FORM: TripForm = {
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
};

export function cloneSnapshot<T>(snapshot: T): T {
  return JSON.parse(JSON.stringify(snapshot)) as T;
}

export function snapshotOf(plan: Itinerary): ItinerarySnapshot {
  const { original: _original, ...snapshot } = plan;
  return cloneSnapshot(snapshot);
}

/** Porta un piano (anche importato o legacy) nella forma completa attesa dalla UI. */
export function normalizePlan(plan: Itinerary): Itinerary {
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

export function fallbackItinerary(): Itinerary {
  return normalizePlan(generateItinerary(FALLBACK_TRIP_FORM));
}

export function formFromPlan(plan: Itinerary, dates?: TripDateFields): TripForm {
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

export function dateFieldsOf(plan: Itinerary): TripDateFields {
  return {
    departure: plan.departure ?? '',
    returnDate: plan.returnDate ?? '',
    arrivalTime: plan.arrivalTime ?? '',
    departureTime: plan.departureTime ?? '',
    arrivalDayOffset: plan.arrivalDayOffset ?? 0,
    arrivalDate: plan.arrivalDate,
    arrivalDestinationKind: plan.arrivalDestinationKind ?? 'first-activity',
    arrivalDestinationPoint: plan.arrivalDestinationPoint,
  };
}

// ---------------------------------------------------------------------------
// Valori derivati per la visualizzazione
// ---------------------------------------------------------------------------

export type TimelineEntry =
  | { kind: 'activity'; activity: Activity; activityIndex: number }
  | { kind: 'route'; segment: RouteSegment };

/** Intercala attività e tratte nell'ordine di percorrenza della giornata. */
export function timelineEntries(day: Itinerary['days'][number]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const remaining = [...(day.segments ?? [])];
  const activityIds = new Set(day.activities.map((activity, index) => nodeIdForActivity(activity, index)));
  day.activities.forEach((activity, index) => {
    if (AUTOMATIC_ARRIVAL_TITLES.has(activity.title)) entries.push({ kind: 'activity', activity, activityIndex: index });
  });
  const leadingRouteIndex = remaining.findIndex((segment) => segment.origin.id === day.origin?.id && !activityIds.has(segment.destination.id));
  if (leadingRouteIndex >= 0) entries.push({ kind: 'route', segment: remaining.splice(leadingRouteIndex, 1)[0] });
  day.activities.forEach((activity, index) => {
    if (AUTOMATIC_ARRIVAL_TITLES.has(activity.title)) return;
    const nodeId = nodeIdForActivity(activity, index);
    const inboundRouteIndex = remaining.findIndex((segment) => segment.toNodeId === nodeId);
    if (inboundRouteIndex >= 0) entries.push({ kind: 'route', segment: remaining.splice(inboundRouteIndex, 1)[0] });
    entries.push({ kind: 'activity', activity, activityIndex: index });
  });
  remaining.forEach((segment) => entries.push({ kind: 'route', segment }));
  return entries;
}

export function dayForToday(plan: Itinerary, today = new Date()): number | undefined {
  const departure = parseCalendarDate(plan.departure ?? '');
  if (!departure || !plan.days.length) return plan.days[0]?.day;
  const now = new Date(today);
  now.setHours(12, 0, 0, 0);
  const offset = Math.floor((now.getTime() - departure.getTime()) / (24 * 60 * 60 * 1000));
  return plan.days[Math.max(0, Math.min(plan.days.length - 1, offset))]?.day;
}

export function displayDayDate(value: string): string {
  const parsed = parseCalendarDate(value);
  return parsed ? new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(parsed) : value;
}

export function arrivalDayLabel(plan: Itinerary): string {
  return plan.arrivalDate
    ? `Data specifica · ${plan.arrivalDate}`
    : plan.arrivalDayOffset === 1 ? 'Il giorno successivo' : 'Lo stesso giorno';
}

export function firstDestinationLabel(plan: Itinerary): string {
  if (plan.arrivalDestinationKind === 'lodging') return plan.lodging?.name || 'Alloggio non ancora inserito';
  if (plan.arrivalDestinationKind === 'custom') return plan.arrivalDestinationPoint?.label || 'Punto personalizzato da definire';
  return 'Prima attività del giorno';
}

export interface BudgetSummary {
  confirmed: boolean;
  perTraveler: string;
  travelerCount: number | null;
  estimatedTotal: string | null;
}

export function budgetSummary(plan: Itinerary): BudgetSummary {
  const confirmed = plan.budgetReliability === 'USER_ENTERED';
  const perTraveler = plan.budgetPerTraveler ?? plan.budget ?? 'Budget non inserito';
  const travelerCount = parseTravelerCount(plan.travelers);
  const amount = parseBudgetAmount(perTraveler);
  const estimatedTotal = confirmed && travelerCount !== null && amount !== null
    ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(amount * travelerCount)
    : null;
  return { confirmed, perTraveler, travelerCount, estimatedTotal };
}

export function discoveryPlaceFor(plan: Itinerary): PlaceMetadata {
  return demoPlaces.find((place) => place.city?.toLocaleLowerCase('it') === plan.destination.toLocaleLowerCase('it'))
    ?? placeForActivity('Luogo da scoprire', plan.destination, 'Storia', 'outdoor');
}

// ---------------------------------------------------------------------------
// Modifiche alle attività (modalità modifica / bozza)
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function randomActivityId(): string {
  return `activity-${Date.now().toString()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function newActivity(transport: Transport, dayId: string, order: number): Activity {
  return {
    id: randomActivityId(),
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
    updatedAt: nowIso(),
  };
}

export function statusForNode(node: LocationNode): ActivityStatus {
  if (node.geoStatus === 'CONFIRMED') return 'CONFIRMED';
  if (node.geoStatus === 'DEMO' || node.geoStatus === 'ESTIMATED') return 'SIMULATED';
  if (node.geoStatus === 'TO_VERIFY') return 'TO_VERIFY';
  if (node.geoStatus === 'UNAVAILABLE_OFFLINE') return 'OFFLINE';
  return node.geoStatus === 'MISSING' ? 'MISSING' : 'TO_DEFINE';
}

export function placeFromNode(node: LocationNode, category: Activity['category'], setting: ActivitySetting): PlaceMetadata {
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
    updatedAt: node.updatedAt ?? nowIso(),
    geoStatus: node.geoStatus,
    category,
    setting,
    whyRecommended: 'Luogo scelto dall’utente: verifica orari, accesso e dettagli prima di partire.',
  };
}

function mapDay(plan: Itinerary, dayIndex: number, update: (day: Itinerary['days'][number]) => Itinerary['days'][number]): Itinerary {
  return { ...plan, days: plan.days.map((day, index) => index === dayIndex ? update(day) : day) };
}

export function updateActivity(plan: Itinerary, dayIndex: number, activityIndex: number, patch: Partial<Activity>): Itinerary {
  return mapDay(plan, dayIndex, (day) => ({
    ...day,
    activities: day.activities.map((activity, innerIndex) => innerIndex !== activityIndex ? activity : {
      ...activity,
      ...patch,
      repositioningDecision: patch.repositioningDecision ?? (Object.keys(patch).some((key) => ['place', 'time', 'duration', 'title'].includes(key)) ? undefined : activity.repositioningDecision),
      repositioningCheckedAt: patch.repositioningDecision ? nowIso() : activity.repositioningCheckedAt,
      updatedAt: nowIso(),
    }),
  }));
}

export function addActivity(plan: Itinerary, dayIndex: number): Itinerary {
  return mapDay(plan, dayIndex, (day) => ({
    ...day,
    activities: [...day.activities, newActivity(plan.transport, `day-${day.date ?? day.day}`, day.activities.length)],
  }));
}

export function deleteActivity(plan: Itinerary, dayIndex: number, activityIndex: number): Itinerary {
  return mapDay(plan, dayIndex, (day) => ({ ...day, activities: day.activities.filter((_, index) => index !== activityIndex) }));
}

export function moveActivityWithinDay(plan: Itinerary, dayIndex: number, activityIndex: number, targetIndex: number): Itinerary {
  return mapDay(plan, dayIndex, (day) => ({
    ...day,
    activities: applyRepositioning(day.activities, activityIndex, targetIndex).map((activity, order) => ({
      ...activity,
      order,
      updatedAt: activity.id === day.activities[activityIndex]?.id ? nowIso() : activity.updatedAt,
    })),
  }));
}

export function moveActivityToDay(plan: Itinerary, fromDayIndex: number, activityIndex: number, toDayIndex: number): Itinerary {
  if (fromDayIndex === toDayIndex) return plan;
  const activity = plan.days[fromDayIndex]?.activities[activityIndex];
  if (!activity) return plan;
  return {
    ...plan,
    days: plan.days.map((day, index) => {
      if (index === fromDayIndex) return { ...day, activities: day.activities.filter((_, innerIndex) => innerIndex !== activityIndex).map((item, order) => ({ ...item, order })) };
      if (index === toDayIndex) return {
        ...day,
        activities: [...day.activities, { ...activity, dayId: `day-${day.date ?? day.day}`, order: day.activities.length, updatedAt: nowIso() }],
      };
      return day;
    }),
  };
}

/** L'utente scrive il nome di un luogo: la posizione torna "da definire". */
export function updateActivityPlaceQuery(plan: Itinerary, dayIndex: number, activityIndex: number, value: string): Itinerary {
  const activity = plan.days[dayIndex]?.activities[activityIndex];
  if (!activity) return plan;
  return updateActivity(plan, dayIndex, activityIndex, {
    place: {
      ...(activity.place ?? {
        id: `place-${activity.id ?? activityIndex}`,
        category: activity.category,
        setting: activity.setting,
        whyRecommended: 'Luogo inserito dall’utente.',
      }),
      title: value,
      city: plan.destination,
      latitude: undefined,
      longitude: undefined,
      placeId: undefined,
      source: 'Inserito dall’utente',
      updatedAt: nowIso(),
      geoStatus: 'MISSING',
      category: activity.category,
      setting: activity.setting,
      whyRecommended: 'Luogo inserito dall’utente: cerca o conferma una posizione prima di usare la mappa.',
    },
    status: value.trim() ? 'MISSING' : 'TO_DEFINE',
  });
}

export function applyActivityGeoNode(plan: Itinerary, dayIndex: number, activityIndex: number, node: LocationNode): Itinerary {
  const activity = plan.days[dayIndex]?.activities[activityIndex];
  if (!activity) return plan;
  return updateActivity(plan, dayIndex, activityIndex, {
    place: placeFromNode(node, activity.category, activity.setting ?? 'outdoor'),
    status: statusForNode(node),
  });
}

/** Aggiunge alla giornata indicata un luogo trovato con la ricerca in mappa. */
export function addPlaceFromSearch(plan: Itinerary, dayNumber: number | undefined, node: LocationNode): Itinerary {
  const activity: Activity = {
    id: randomActivityId(),
    time: 'Da definire',
    title: node.label,
    detail: 'Luogo cercato online: verifica orari, accesso e dettagli prima di partire.',
    category: 'Storia',
    transport: plan.transport,
    setting: 'outdoor',
    requiresBooking: false,
    nodeId: node.id,
    status: statusForNode(node),
    updatedAt: nowIso(),
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
      updatedAt: node.updatedAt ?? nowIso(),
      geoStatus: node.geoStatus,
      category: 'Storia',
      whyRecommended: 'Risultato di ricerca da verificare e confermare nel tuo itinerario.',
    },
  };
  const targetDay = dayNumber ?? plan.days[0]?.day;
  return normalizePlan({ ...plan, days: plan.days.map((day) => day.day === targetDay ? { ...day, activities: [...day.activities, activity] } : day) });
}

export function acceptRepositioning(plan: Itinerary, dayIndex: number, suggestion: RepositionSuggestion): Itinerary {
  if (suggestion.status !== 'CALCULABLE' || suggestion.suggestedIndex === suggestion.activityIndex) return plan;
  return mapDay(plan, dayIndex, (day) => {
    const movedId = day.activities[suggestion.activityIndex]?.id;
    return {
      ...day,
      activities: applyRepositioning(day.activities, suggestion.activityIndex, suggestion.suggestedIndex).map((activity, index) => ({
        ...activity,
        order: index,
        repositioningDecision: activity.id === movedId ? 'ACCEPTED' : activity.repositioningDecision,
        repositioningCheckedAt: activity.id === movedId ? nowIso() : activity.repositioningCheckedAt,
        updatedAt: activity.id === movedId ? nowIso() : activity.updatedAt,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Aggiornamenti operativi (salvati subito, anche fuori dalla modifica)
// ---------------------------------------------------------------------------

export function toggleActivityCompletion(plan: Itinerary, dayNumber: number, activityIndex: number): Itinerary {
  return {
    ...plan,
    days: plan.days.map((day) => day.day !== dayNumber ? day : {
      ...day,
      activities: day.activities.map((activity, index) => index !== activityIndex ? activity : {
        ...activity,
        completed: !activity.completed,
        status: !activity.completed ? 'COMPLETED' : activityStatusFor({ ...activity, completed: false, status: undefined }),
        updatedAt: nowIso(),
      }),
    }),
  };
}

export function toggleSegmentCompletion(plan: Itinerary, routeId: string): Itinerary {
  const route = [...plan.days.flatMap((day) => day.segments ?? []), ...(plan.interurbanRoutes ?? [])].find((segment) => segment.id === routeId);
  return route ? patchRouteInPlan(plan, routeId, { completed: !route.completed }) : plan;
}

/**
 * Chiude la modalità modifica: ricalcola le tratte solo dei giorni toccati e
 * sincronizza la mappa (logica di `saveChanges`).
 */
export function finalizeDraft(draft: Itinerary, dayIndexesToRefresh: number[]): Itinerary {
  const refreshed = dayIndexesToRefresh.reduce((current, dayIndex) => {
    const day = current.days[dayIndex];
    return day ? recalculateDayRoutes(current, day.day) : current;
  }, draft);
  return normalizePlan(synchronizeItineraryMap(refreshed, draft.mapSnapshot?.updatedAt));
}

export function restoreOriginal(draft: Itinerary): Itinerary {
  if (!draft.original) return draft;
  const original = cloneSnapshot(draft.original);
  return normalizePlan({ ...original, original });
}

// ---------------------------------------------------------------------------
// Editor di date, budget e alloggio
// ---------------------------------------------------------------------------

export interface DateChangeCheck {
  error: string | null;
  /** true quando cambiano durata o dati di arrivo: serve una conferma esplicita. */
  requiresConfirmation: boolean;
}

export function checkDateChanges(plan: Itinerary, fields: TripDateFields): DateChangeCheck {
  const error = validateDateRange(fields.departure, fields.returnDate)
    ?? validateArrivalDate(fields.departure, fields.returnDate, fields.arrivalDayOffset, fields.arrivalDate)
    ?? (fields.arrivalTime ? validateTime(fields.arrivalTime, 'Orario di arrivo') : null)
    ?? (fields.departureTime ? validateTime(fields.departureTime, 'Orario di partenza') : null)
    ?? (fields.arrivalTime && fields.departureTime ? validateSchedule(fields.departure, fields.returnDate, fields.arrivalTime, fields.departureTime) : null)
    ?? (fields.arrivalDestinationKind === 'custom' && !fields.arrivalDestinationPoint?.label?.trim()
      ? 'Inserisci il punto personalizzato dopo l’arrivo oppure scegli un’altra prima destinazione.'
      : null);
  if (error) return { error, requiresConfirmation: false };
  const arrivalChanged = fields.arrivalTime !== (plan.arrivalTime ?? '')
    || fields.arrivalDayOffset !== (plan.arrivalDayOffset ?? 0)
    || fields.arrivalDate !== plan.arrivalDate
    || fields.arrivalDestinationKind !== (plan.arrivalDestinationKind ?? 'first-activity')
    || fields.arrivalDestinationPoint?.label !== plan.arrivalDestinationPoint?.label;
  return { error: null, requiresConfirmation: calculateDuration(fields.departure, fields.returnDate) !== plan.duration || arrivalChanged };
}

/** Rigenera le giornate per le nuove date conservando attività, ordine e note. */
export function applyDateChanges(plan: Itinerary, fields: TripDateFields): Itinerary {
  const regenerated = generateItinerary(formFromPlan(plan, fields));
  const original = plan.original ? cloneSnapshot(plan.original) : snapshotOf(plan);
  const preservedDays = mergeItineraryDaysForDateChange(plan.days, regenerated.days);
  const next = recalculateRoutes({
    ...regenerated,
    days: preservedDays,
    scheduleNote: fields.arrivalDayOffset === 1
      ? 'Arrivo il giorno successivo: le attività restano nel loro ordine. Controlla la loro coerenza temporale prima di partire.'
      : regenerated.scheduleNote,
  }, regenerated.lodging);
  return normalizePlan({ ...next, original });
}

export function confirmBudget(plan: Itinerary, fields: { travelers: string; budgetPerTraveler?: string }): { plan: Itinerary | null; error: string | null } {
  const confirmedBudget = fields.budgetPerTraveler?.trim() ?? '';
  const amount = parseBudgetAmount(confirmedBudget);
  const travelers = parseTravelerCount(fields.travelers);
  if (amount === null || travelers === null) {
    return { plan: null, error: 'Inserisci un budget per viaggiatore e un numero di viaggiatori validi prima di confermare.' };
  }
  const original = plan.original ? cloneSnapshot(plan.original) : snapshotOf(plan);
  const nextForm = { ...formFromPlan(plan), travelers: fields.travelers.trim(), budgetPerTraveler: confirmedBudget, budgetReliability: 'USER_ENTERED' as const };
  const recalculated = generateItinerary(nextForm);
  return {
    plan: normalizePlan({ ...plan, travelers: nextForm.travelers, budget: nextForm.budgetPerTraveler, budgetPerTraveler: nextForm.budgetPerTraveler, budgetReliability: 'USER_ENTERED', profile: recalculated.profile, estimate: recalculated.estimate, original }),
    error: null,
  };
}

export function previewOriginRoutes(plan: Itinerary, lodging: LodgingInfo): Itinerary {
  return recalculateRoutes(plan, lodging);
}

export function confirmOriginRoutes(plan: Itinerary, preview: Itinerary): Itinerary {
  const original = plan.original ? cloneSnapshot(plan.original) : snapshotOf(plan);
  return normalizePlan({ ...preview, original });
}
