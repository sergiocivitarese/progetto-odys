import { placeForActivity } from '@/data/places';
import type {
  Activity,
  ArrivalDestinationKind,
  ArrivalTransport,
  DayPlan,
  Interest,
  Itinerary,
  LocationNode,
  LodgingInfo,
  RecommendedInterest,
  RouteSegment,
  Transport,
  TripForm,
  WeatherMode,
} from '@/types/travel';
import { ensureLocationNode, LOCAL_ROUTE_SOURCE, nodeIdForActivity, nodeIdForLabel } from '@/lib/routeModel';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ARRIVAL_TIME = '15:30';
const DEFAULT_DEPARTURE_TIME = '11:00';
const DEMO_SOURCE = LOCAL_ROUTE_SOURCE;

const recommendedActivities: Record<RecommendedInterest, [string, string][]> = {
  Arte: [['Museo e quartiere creativo', 'Una visita lenta tra collezioni locali e atelier indipendenti'], ['Galleria al tramonto', 'Spazio contemporaneo con guida audio demo']],
  Cibo: [['Mercato del mattino', 'Assaggi regionali e botteghe da esplorare senza fretta'], ['Cena in trattoria', 'Un indirizzo demo da verificare prima di partire']],
  Natura: [['Passeggiata panoramica', 'Un percorso accessibile con punti sosta e vista aperta'], ['Giardino segreto', 'Verde, ombra e tempo per respirare']],
  Storia: [['Centro storico', 'Le tracce più importanti della città in un percorso compatto'], ['Sito storico', 'Un luogo simbolo con tempo per approfondire']],
  Benessere: [['Mattina lenta', 'Yoga o rituale benessere per iniziare con energia'], ['Pausa rigenerante', 'Un momento per rallentare lontano dal rumore']],
  Design: [['Design district', 'Architettura, oggetti e studi da scoprire a piedi'], ['Concept store', 'Una selezione di progetti e artigiani contemporanei']],
};

export function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : null;
}

function localNoon(value: string): Date { return parseCalendarDate(value) ?? new Date(); }
function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calculateDuration(departure: string, returnDate: string): number {
  const start = parseCalendarDate(departure); const end = parseCalendarDate(returnDate);
  return start && end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1) : 0;
}

export function validateDateRange(departure: string, returnDate: string): string | null {
  if (!departure || !returnDate) return 'Inserisci entrambe le date del viaggio.';
  const start = parseCalendarDate(departure); const end = parseCalendarDate(returnDate);
  if (!start || !end) return 'Usa date valide nel formato AAAA-MM-GG (YYYY-MM-DD).';
  return end.getTime() < start.getTime() ? 'Il rientro deve essere successivo o uguale alla partenza.' : null;
}

export function parseTime(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function validateTime(value: string, label: string): string | null {
  return parseTime(value) === null ? `${label}: inserisci un orario valido nel formato HH:MM.` : null;
}

export function parseBudgetAmount(value?: string): number | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().replace(/[^\d,.-]/g, '');
  if (!normalized) return null;
  const comma = normalized.lastIndexOf(',');
  const dot = normalized.lastIndexOf('.');
  const onlyDotsAreThousands = comma === -1 && /^\d{1,3}(?:\.\d{3})+$/.test(normalized);
  const decimalSeparator = comma > dot ? ',' : dot > comma ? '.' : null;
  const numberValue = onlyDotsAreThousands
    ? Number(normalized.replace(/\./g, ''))
    : decimalSeparator
      ? Number(normalized.replace(decimalSeparator === ',' ? /\./g : /,/g, '').replace(decimalSeparator, '.'))
      : Number(normalized);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

export function parseTravelerCount(value?: string): number | null {
  const count = Number(value?.trim());
  return Number.isInteger(count) && count > 0 ? count : null;
}

export function formatBudgetEstimate(budgetPerTraveler?: string, travelers?: string, reliability?: 'USER_ENTERED' | 'TO_VERIFY'): string {
  const individual = budgetPerTraveler?.trim() || 'Budget non inserito';
  if (reliability === 'TO_VERIFY') return `Valore migrato ${individual} · da verificare prima di considerarlo per viaggiatore`;
  const amount = parseBudgetAmount(budgetPerTraveler);
  const count = parseTravelerCount(travelers);
  if (amount !== null && count !== null) {
    const total = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(amount * count);
    return `${individual} per viaggiatore · totale stimato ${total} per ${count}`;
  }
  return `${individual} per viaggiatore · totale da definire: inserisci i viaggiatori`;
}

export function validateArrivalDate(
  departure: string,
  returnDate: string,
  arrivalDayOffset?: 0 | 1,
  arrivalDate?: string,
): string | null {
  const rangeError = validateDateRange(departure, returnDate);
  if (rangeError) return rangeError;
  if (arrivalDayOffset !== undefined && arrivalDayOffset !== 0 && arrivalDayOffset !== 1) return 'Scegli un giorno di arrivo valido.';
  if (arrivalDayOffset === 1) {
    const start = parseCalendarDate(departure);
    const end = parseCalendarDate(returnDate);
    if (start && end) {
      const nextDay = new Date(start);
      nextDay.setDate(nextDay.getDate() + 1);
      if (nextDay.getTime() > end.getTime()) return 'L’arrivo il giorno successivo non rientra nell’intervallo del viaggio.';
    }
  }
  if (arrivalDate) {
    const arrival = parseCalendarDate(arrivalDate);
    const start = parseCalendarDate(departure);
    const end = parseCalendarDate(returnDate);
    if (!arrival || !start || !end) return 'La data di arrivo specifica non è valida.';
    if (arrival.getTime() < start.getTime() || arrival.getTime() > end.getTime()) return 'La data di arrivo è fuori dall’intervallo del viaggio: controllala prima di continuare.';
  }
  return null;
}

function arrivalDayIndex(departure: string, arrivalDayOffset?: 0 | 1, arrivalDate?: string): number {
  if (arrivalDate) {
    const start = parseCalendarDate(departure);
    const arrival = parseCalendarDate(arrivalDate);
    if (start && arrival) return Math.max(0, Math.round((arrival.getTime() - start.getTime()) / DAY_MS));
  }
  return arrivalDayOffset === 1 ? 1 : 0;
}

export function validateSchedule(departure: string, returnDate: string, arrivalTime: string, departureTime: string): string | null {
  if (departure !== returnDate) return null;
  const arrival = parseTime(arrivalTime); const end = parseTime(departureTime);
  return arrival !== null && end !== null && end <= arrival ? 'Per un viaggio in giornata, l’orario di partenza deve essere successivo all’arrivo.' : null;
}

function formatTime(minutes: number): string {
  const safe = Math.max(0, Math.min(1439, minutes));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function uniqueInterests(form: TripForm): Interest[] {
  const values = [...(form.interests ?? []), ...(form.customInterests ?? [])].map((value) => value.trim()).filter(Boolean);
  const unique: Interest[] = [];
  values.forEach((value) => { if (!unique.some((item) => item.toLocaleLowerCase('it') === value.toLocaleLowerCase('it'))) unique.push(value); });
  return unique.length ? unique : ['Cibo', 'Natura', 'Storia'];
}

function activityFor(interest: Interest, destination: string, index: number, time: string): Activity {
  const base = recommendedActivities[interest as RecommendedInterest];
  const [title, detail] = base?.[index % base.length] ?? [`Esperienza dedicata: ${interest}`, `Un momento dedicato a ${interest.toLowerCase()} a ${destination}, da adattare alle disponibilità locali`];
  const setting = interest === 'Natura' ? 'outdoor' : 'indoor';
  return { time, title: title.replace('quartiere creativo', `a ${destination}`), detail, category: interest, setting, transport: interest === 'Natura' ? 'a piedi' : 'trasporto pubblico', requiresBooking: interest === 'Cibo' && index === 1, place: placeForActivity(title, destination, interest, setting) };
}

function arrivalActivities(interests: Interest[], destination: string, arrival?: number): Activity[] {
  const arrivalLabel = arrival === undefined ? 'Orario non inserito' : formatTime(arrival);
  const result: Activity[] = [
    { time: arrivalLabel, title: 'Arrivo nella destinazione', detail: 'Bagagli, trasferimento e primo orientamento. I tempi di tragitto saranno dettagliati dopo l’inserimento dell’origine.', category: 'Storia', transport: 'trasporto pubblico', setting: 'indoor', place: placeForActivity('Arrivo nella destinazione', destination, 'Storia', 'indoor') },
    { time: arrival === undefined ? 'Orario non inserito' : formatTime(Math.min(arrival + 55, 21 * 60)), title: 'Check-in o deposito bagagli', detail: 'Blocco prudenziale: non viene conteggiato come visita.', category: 'Storia', transport: 'taxi', setting: 'indoor', place: placeForActivity('Check-in o deposito bagagli', destination, 'Storia', 'indoor') },
  ];
  if (arrival === undefined) {
    result.push(activityFor(interests[0], destination, 0, 'Orario non inserito'));
  } else if (arrival < 18 * 60) {
    result.push(activityFor(interests[0], destination, 0, formatTime(Math.min(arrival + 180, 20 * 60))));
  }
  return result;
}

function departureActivities(interests: Interest[], destination: string, departure: number): Activity[] {
  const result: Activity[] = [];
  if (departure >= 11 * 60) result.push(activityFor(interests[0], destination, 1, formatTime(Math.max(7 * 60, departure - 190))));
  result.push({ time: formatTime(Math.max(6 * 60, departure - 120)), title: 'Check-out e trasferimento', detail: 'Bagagli, margine prudenziale e spostamento verso il punto di partenza.', category: 'Storia', transport: 'taxi', setting: 'indoor', place: placeForActivity('Check-out e trasferimento', destination, 'Storia', 'indoor') });
  result.push({ time: formatTime(departure), title: 'Partenza dalla destinazione', detail: 'Partenza pianificata con un margine prudenziale.', category: 'Storia', transport: 'trasporto pubblico', setting: 'indoor', place: placeForActivity('Partenza dalla destinazione', destination, 'Storia', 'indoor') });
  return result;
}

function regularActivities(interests: Interest[], destination: string, day: number): Activity[] {
  return [0, 1, 2].map((index) => activityFor(interests[(day + index) % interests.length], destination, index, ['09:30', '13:00', '18:30'][index]));
}

function nodeFromActivity(activity: Activity): LocationNode {
  const place = activity.place;
  return ensureLocationNode({
    id: nodeIdForActivity(activity),
    label: activity.title,
    type: 'activity',
    address: place?.address,
    city: place?.city,
    zone: place?.zone,
    latitude: place?.latitude,
    longitude: place?.longitude,
    placeId: place?.placeId,
    country: place?.country,
    timezone: place?.timezone,
    source: place?.source,
    updatedAt: place?.updatedAt,
    reliabilityStatus: place?.geoStatus === 'DEMO' ? 'DEMO' : 'TO_VERIFY',
    geoStatus: place?.geoStatus ?? 'MISSING',
  }, activity.title, nodeIdForActivity(activity));
}

function noOriginNode(): LocationNode { return ensureLocationNode({ type: 'undefined', source: DEMO_SOURCE, geoStatus: 'MISSING' }, 'Origine da definire', 'undefined-origin'); }

function arrivalNode(form: Pick<TripForm, 'arrivalPoint' | 'arrivalTransport'>): LocationNode | null {
  if (form.arrivalPoint?.label) return ensureLocationNode(form.arrivalPoint, form.arrivalPoint.label, `arrival-${nodeIdForLabel(form.arrivalPoint.label)}`);
  return null;
}

export function lodgingNode(lodging?: LodgingInfo): LocationNode | null {
  if (!lodging) return null;
  const label = lodging.customStartingPoint || lodging.name || lodging.arrivalStation || lodging.departureStation || lodging.port;
  if (!label) return null;
  const type = lodging.arrivalStation || lodging.departureStation ? 'station' : lodging.port ? 'port' : lodging.customStartingPoint ? 'custom' : 'accommodation';
  const latitude = typeof lodging.latitude === 'number' ? lodging.latitude : undefined;
  const longitude = typeof lodging.longitude === 'number' ? lodging.longitude : undefined;
  return ensureLocationNode({ id: nodeIdForLabel(label, 'lodging'), label, type, address: lodging.address, zone: lodging.zone, latitude, longitude, source: lodging.source ?? DEMO_SOURCE, reliabilityStatus: 'DEMO', geoStatus: 'DEMO' }, label, nodeIdForLabel(label, 'lodging'));
}

function routeId(day: number, index: number, type: 'interurban' | 'intracity', origin: LocationNode, destination: LocationNode): string {
  return `${type}-${day}-${index}-${origin.id}-${destination.id}`;
}

function intracitySegment(day: number, index: number, origin: LocationNode, destination: LocationNode, hasPreciseOrigin: boolean): RouteSegment {
  const id = routeId(day, index, 'intracity', origin, destination);
  const base = { id, day, order: index, fromNodeId: origin.id, toNodeId: destination.id, origin, destination, type: 'intracity' as const, recommendedMode: 'a piedi' as const, alternatives: ['a piedi', 'trasporto pubblico', 'taxi', 'auto', 'autobus'] as Transport[] };
  if (!hasPreciseOrigin || origin.geoStatus === 'MISSING' || destination.geoStatus === 'MISSING') {
    return { ...base, duration: 'Tempo da definire', distance: 'Distanza da definire', cost: 'Costo da definire', changes: 'Da definire', comfort: 'Da definire', weatherImpact: 'Da valutare', reliability: 'MISSING', status: 'MISSING', note: 'Percorso non ancora calcolabile: manca il punto di partenza o la posizione precisa della tappa. Inserisci alloggio o punto di partenza per calcolare.', source: DEMO_SOURCE };
  }
  return { ...base, duration: 'Stima demo da verificare', distance: 'Distanza demo da verificare', cost: 'Costo da verificare', changes: 'Nessun cambio stimato', comfort: 'Adatto a tappe vicine', weatherImpact: 'Verifica meteo prima di camminare', reliability: 'DEMO', status: 'DEMO', note: `${DEMO_SOURCE}. Stima media demo, da verificare: non rappresenta un tempo reale o garantito.`, source: DEMO_SOURCE };
}

function buildDayRoutes(
  day: DayPlan,
  lodging?: LodgingInfo,
  initialArrival?: LocationNode | null,
  finalReturn?: LocationNode,
  arrivalDestinationKind?: ArrivalDestinationKind,
  arrivalDestinationPoint?: LocationNode,
  isArrivalDayOverride?: boolean,
): DayPlan {
  const lodgingStart = lodgingNode(lodging);
  const activities = day.activities;
  const isArrivalDay = (isArrivalDayOverride ?? day.day === 1) && Boolean(initialArrival);
  const isReturnDay = Boolean(finalReturn) && day.label.includes('rientro');
  const origin = isArrivalDay ? initialArrival! : lodgingStart ?? noOriginNode();
  const automaticArrivalTitles = new Set(['Arrivo nella destinazione', 'Check-in o deposito bagagli']);
  const routeActivities = isArrivalDay
    ? activities.filter((activity) => !automaticArrivalTitles.has(activity.title))
    : activities;
  const activityNodes = routeActivities.map(nodeFromActivity);
  const firstActivityTarget = activityNodes[0]
    ?? ensureLocationNode({ type: 'undefined', source: DEMO_SOURCE, reliabilityStatus: 'MISSING', geoStatus: 'MISSING' }, 'Prima attività da definire', 'undefined-first-activity');
  const missingLodgingTarget: LocationNode = ensureLocationNode({ type: 'undefined', source: DEMO_SOURCE, reliabilityStatus: 'MISSING', geoStatus: 'MISSING' }, 'Alloggio da definire', 'undefined-lodging');
  const missingCustomTarget: LocationNode = ensureLocationNode({ type: 'undefined', source: DEMO_SOURCE, reliabilityStatus: 'MISSING', geoStatus: 'MISSING' }, 'Punto personalizzato da definire', 'undefined-custom');
  const arrivalTarget = isArrivalDay
    ? arrivalDestinationKind === 'lodging' ? lodgingStart ?? missingLodgingTarget
      : arrivalDestinationKind === 'custom' ? arrivalDestinationPoint ?? missingCustomTarget
        : firstActivityTarget
    : undefined;
  const targetIsFirstActivity = isArrivalDay
    && arrivalDestinationKind !== 'lodging'
    && arrivalDestinationKind !== 'custom'
    && arrivalTarget?.label === activityNodes[0]?.label;
  const nodes = [
    origin,
    ...(arrivalTarget && !targetIsFirstActivity ? [arrivalTarget] : []),
    ...activityNodes,
    ...(isReturnDay ? [finalReturn!] : []),
  ];
  const segments = nodes.slice(1).map((node, index) => intracitySegment(day.day, index, nodes[index], node, Boolean(lodgingStart)));
  const finalDestination = finalReturn && isReturnDay ? finalReturn : lodgingStart ?? nodes[nodes.length - 1] ?? noOriginNode();
  if (lodgingStart && nodes.length > 1 && !isReturnDay) segments.push(intracitySegment(day.day, segments.length, nodes[nodes.length - 1], lodgingStart, true));
  return { ...day, origin, finalDestination, segments };
}

export function mergeItineraryDaysForDateChange(existingDays: DayPlan[], regeneratedDays: DayPlan[]): DayPlan[] {
  const automaticArrivalTitles = new Set(['Arrivo nella destinazione', 'Check-in o deposito bagagli']);
  const preserved = regeneratedDays.map((template, index) => {
    const existing = existingDays[index];
    const existingActivities = existing?.activities ?? [];
    const existingNormalActivities = existingActivities.filter((activity) => !automaticArrivalTitles.has(activity.title));
    const existingHasAutomaticArrival = existingActivities.some((activity) => automaticArrivalTitles.has(activity.title));
    const regeneratedNormalActivities = template.activities.filter((activity) => !automaticArrivalTitles.has(activity.title));
    const normalActivities = existing
      ? existingNormalActivities.length || !existingHasAutomaticArrival ? existingNormalActivities : regeneratedNormalActivities
      : regeneratedNormalActivities;
    const automaticArrivalActivities = template.activities.filter((activity) => automaticArrivalTitles.has(activity.title));
    return { ...template, activities: [...automaticArrivalActivities, ...normalActivities] };
  });
  const overflow = existingDays
    .slice(regeneratedDays.length)
    .flatMap((day) => day.activities.filter((activity) => !automaticArrivalTitles.has(activity.title)));
  if (overflow.length && preserved.length) {
    const lastIndex = preserved.length - 1;
    preserved[lastIndex] = { ...preserved[lastIndex], activities: [...preserved[lastIndex].activities, ...overflow] };
  }
  return preserved;
}

function normalizedStops(stops: string[] | undefined, destination: string): string[] {
  const values = [...(stops ?? []), destination].map((item) => item.trim()).filter(Boolean);
  return values.filter((value, index) => !values.slice(0, index).some((previous) => previous.toLowerCase() === value.toLowerCase()));
}

function interurbanSegments(stops: string[], destination: string): RouteSegment[] {
  const route = normalizedStops(stops, destination);
  if (route.length < 2) return [];
  return route.slice(1).map((to, index) => {
    const from = route[index];
    const mexicoToCancun = from.toLowerCase().includes('città del messico') && to.toLowerCase().includes('canc');
    const cancunToIsla = from.toLowerCase().includes('canc') && to.toLowerCase().includes('isla mujeres');
    const mode: Transport = mexicoToCancun ? 'aereo' : cancunToIsla ? 'traghetto' : 'treno';
    return {
      id: `interurban-${index}`,
      origin: ensureLocationNode({ id: nodeIdForLabel(from, 'city'), label: from, type: 'previous-stop', city: from, source: DEMO_SOURCE, geoStatus: 'DEMO' }, from, nodeIdForLabel(from, 'city')),
      destination: ensureLocationNode({ id: nodeIdForLabel(to, 'city'), label: to, type: 'final', city: to, source: DEMO_SOURCE, geoStatus: 'DEMO' }, to, nodeIdForLabel(to, 'city')),
      type: 'interurban',
      recommendedMode: mode,
      alternatives: mexicoToCancun ? ['aereo', 'treno', 'altro'] : cancunToIsla ? ['traghetto', 'taxi', 'trasporto pubblico'] : ['treno', 'auto', 'aereo'],
      duration: 'Durata da verificare con dati aggiornati',
      distance: 'Distanza da verificare',
      cost: 'Costo da verificare',
      changes: cancunToIsla ? 'Transfer verso il porto + traghetto' : 'Passaggi da verificare',
      comfort: 'Da valutare in base agli orari',
      weatherImpact: mode === 'traghetto' ? 'Sensibile alle condizioni marine' : 'Da verificare prima della partenza',
      reliability: 'TO_VERIFY',
      status: 'TO_VERIFY',
      note: 'Percorso interurbano da verificare. La modalità è suggerita sulla base della rete di trasporto, senza orari o prezzi reali.',
      source: DEMO_SOURCE,
      day: 0,
      order: index,
      fromNodeId: nodeIdForLabel(from, 'city'),
      toNodeId: nodeIdForLabel(to, 'city'),
    };
  });
}

export function getWeatherMode(startDate: string, today = new Date()): WeatherMode {
  const start = parseCalendarDate(startDate); if (!start) return 'seasonal';
  const current = new Date(today); current.setHours(12, 0, 0, 0);
  const daysUntil = Math.max(0, Math.floor((start.getTime() - current.getTime()) / DAY_MS));
  return daysUntil <= 3 ? 'operational-high' : daysUntil <= 10 ? 'operational-medium' : daysUntil <= 15 ? 'trend' : 'seasonal';
}

export function weatherNoteFor(mode: WeatherMode, destination: string): string {
  if (mode === 'operational-high') return `Meteo operativo · Demo locale per ${destination}. Condizioni solo indicative.`;
  if (mode === 'operational-medium') return `Previsione operativa · Demo locale per ${destination}. Tendenza indicativa, affidabilità media.`;
  if (mode === 'trend') return `Tendenza meteo di medio periodo · Demo locale per ${destination}. Il piano non viene modificato automaticamente.`;
  return `Previsione non ancora disponibile · Per ${destination} usiamo soltanto stagionalità demo.`;
}

export function recalculateRoutes(itinerary: Itinerary, lodging?: LodgingInfo): Itinerary {
  const nextLodging = lodging ?? itinerary.lodging;
  const targetArrivalDay = arrivalDayIndex(itinerary.departure ?? '', itinerary.arrivalDayOffset, itinerary.arrivalDate) + 1;
  const days = itinerary.days.map((day) => buildDayRoutes(
    day,
    nextLodging,
    itinerary.arrivalPoint,
    itinerary.returnPoint,
    itinerary.arrivalDestinationKind,
    itinerary.arrivalDestinationPoint,
    day.day === targetArrivalDay,
  ));
  return {
    ...itinerary,
    lodging: nextLodging,
    planningMode: lodgingNode(nextLodging) ? 'detailed' : 'initial',
    routeSummary: lodgingNode(nextLodging) ? 'Percorsi dettagliati demo dopo inserimento alloggio' : 'Pianificazione iniziale: i tempi intraurbani restano da definire',
    days,
    version: 5,
  };
}

/** Aggiorna la sola giornata interessata da una modifica attività. */
export function recalculateDayRoutes(itinerary: Itinerary, dayNumber: number): Itinerary {
  const targetArrivalDay = arrivalDayIndex(itinerary.departure ?? '', itinerary.arrivalDayOffset, itinerary.arrivalDate) + 1;
  return {
    ...itinerary,
    days: itinerary.days.map((day) => day.day === dayNumber
      ? buildDayRoutes(
        day,
        itinerary.lodging,
        itinerary.arrivalPoint,
        itinerary.returnPoint,
        itinerary.arrivalDestinationKind,
        itinerary.arrivalDestinationPoint,
        day.day === targetArrivalDay,
      )
      : day),
    version: 5,
  };
}

export function generateItinerary(form: TripForm): Itinerary {
  const duration = calculateDuration(form.departure, form.returnDate) || 1;
  const arrivalTime = form.arrivalTime?.trim() || undefined;
  const departureTime = form.departureTime?.trim() || undefined;
  const arrival = arrivalTime ? parseTime(arrivalTime) ?? undefined : undefined;
  const departure = parseTime(departureTime ?? DEFAULT_DEPARTURE_TIME)!;
  const interests = uniqueInterests(form);
  const arrivalPoint = arrivalNode(form);
  const arrivalIndex = Math.min(Math.max(arrivalDayIndex(form.departure, form.arrivalDayOffset, form.arrivalDate), 0), Math.max(duration - 1, 0));
  const days = Array.from({ length: duration }, (_, index) => {
    const date = new Date(localNoon(form.departure)); date.setDate(date.getDate() + index);
    const arrivalDay = index === arrivalIndex; const last = index === duration - 1;
    const activities = arrivalDay && last
      ? [...arrivalActivities(interests, form.destination, arrival).filter((activity) => { const time = parseTime(activity.time); return time === null || time <= departure; }), ...departureActivities(interests, form.destination, departure).slice(-1)]
      : arrivalDay ? arrivalActivities(interests, form.destination, arrival)
        : last ? departureActivities(interests, form.destination, departure)
          : regularActivities(interests, form.destination, index);
    return buildDayRoutes({
      day: index + 1,
      date: localDateKey(date),
      label: arrivalDay && last ? 'Arrivo, esperienza e rientro' : arrivalDay ? 'Arrivo e primo assaggio' : last ? 'Ultimi passi e rientro' : `Giornata ${index + 1}`,
      activities,
      rainyAlternative: 'Museo, caffetteria storica e laboratorio artigiano al coperto',
      tiredAlternative: 'Riduci a una sola zona: pranzo vicino e rientro anticipato',
    }, form.lodging, arrivalPoint, form.returnPoint, form.arrivalDestinationKind, form.arrivalDestinationPoint, arrivalDay);
  });
  const weatherMode = getWeatherMode(form.departure);
  const interurban = interurbanSegments(form.stops ?? [], form.destination);
  const planningMode = lodgingNode(form.lodging) ? 'detailed' : 'initial';
  return {
    destination: form.destination.trim(),
    destinationNode: ensureLocationNode({
      id: nodeIdForLabel(form.destination.trim(), 'destination'),
      label: form.destination.trim(),
      type: 'final',
      city: form.destination.trim(),
      source: 'Inserito dall’utente',
      reliabilityStatus: 'MISSING',
      geoStatus: 'MISSING',
    }, form.destination.trim(), nodeIdForLabel(form.destination.trim(), 'destination')),
    departure: form.departure,
    returnDate: form.returnDate,
    arrivalTime,
    departureTime,
    travelers: form.travelers,
    budget: form.budgetPerTraveler ?? form.budget ?? 'budget flessibile',
    budgetPerTraveler: form.budgetPerTraveler ?? form.budget ?? 'budget flessibile',
    budgetReliability: form.budgetReliability ?? (form.budgetPerTraveler ? 'USER_ENTERED' : 'TO_VERIFY'),
    interests,
    customInterests: form.customInterests ?? [],
    constraints: form.constraints ?? '',
    stops: form.stops ?? [],
    lodging: form.lodging,
    arrivalTransport: form.arrivalTransport,
    departurePoint: form.departurePoint,
    arrivalPoint: arrivalPoint ?? undefined,
    arrivalDayOffset: form.arrivalDate ? undefined : form.arrivalDayOffset ?? 0,
    arrivalDate: form.arrivalDate,
    arrivalDestinationKind: form.arrivalDestinationKind ?? 'first-activity',
    arrivalDestinationPoint: form.arrivalDestinationPoint,
    returnTransport: form.returnTransport,
    returnPoint: form.returnPoint,
    duration,
    profile: `${form.travelers || 'Numero viaggiatori non inserito'} viaggiatori · ${form.budgetPerTraveler ?? form.budget ?? 'budget flessibile'} per viaggiatore · interessi ${interests.join(', ')}`,
    pace: form.pace,
    transport: form.transport,
    estimate: `${formatBudgetEstimate(form.budgetPerTraveler ?? form.budget, form.travelers, form.budgetReliability ?? (form.budgetPerTraveler ? 'USER_ENTERED' : 'TO_VERIFY'))} · stima locale per ${duration} ${duration === 1 ? 'giorno' : 'giorni'}`,
    weatherMode,
    weatherNote: weatherNoteFor(weatherMode, form.destination),
    scheduleNote: arrival !== undefined && arrival >= 17 * 60 ? 'Arrivo nel tardo pomeriggio: il primo giorno contiene tappe brevi e margine per bagagli.' : departure <= 9 * 60 ? 'Partenza al mattino presto: l’ultimo giorno privilegia check-out e trasferimento.' : undefined,
    planningMode,
    routeSummary: planningMode === 'detailed' ? 'Percorsi dettagliati demo dopo inserimento alloggio' : 'Pianificazione iniziale: aggiungi un alloggio per calcolare percorsi intraurbani demo',
    days,
    nextSteps: [
      planningMode === 'initial' ? 'Completa punto di partenza per aggiornare le tratte' : 'Controlla gli orari e le disponibilità direttamente',
      interurban.length ? 'Verifica gli spostamenti tra città con dati aggiornati' : 'Aggiungi eventuali tappe intermedie',
      'Salva le tappe che vuoi tenere',
    ],
    version: 5,
    ...(interurban.length ? { routeSummary: `${planningMode === 'detailed' ? 'Percorsi dettagliati demo' : 'Pianificazione iniziale'} · ${interurban.length} tratta interurbana da verificare`, interurbanRoutes: interurban } : {}),
  };
}