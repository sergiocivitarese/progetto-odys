import type { Activity, DayPlan, Itinerary, RouteSegment, Transport } from '../types/travel';
import { TRANSPORT_LABELS, timelineEntries } from './itineraryEditing';

/*
 * Il giorno per ore (TP-05, TP-07): programma orario con durate, spostamenti tra
 * le tappe con mezzo e durata, tappe numerate e percorso del giorno per la mappa.
 * Funzioni pure: le usano sia i viaggi personali sia i viaggi di gruppo prenotati.
 */

export interface AgendaActivity {
  kind: 'activity';
  /** Numero della tappa sulla mappa (solo per le attività con posizione). */
  stop?: number;
  activityIndex: number;
  time?: string;
  endTime?: string;
  durationLabel?: string;
  title: string;
  detail: string;
  place?: string;
}

export interface AgendaTransfer {
  kind: 'transfer';
  mode: Transport;
  modeLabel: string;
  durationLabel?: string;
  distanceLabel?: string;
  /** true: stima (tratta locale o suggerita); false: calcolata da un fornitore. */
  estimated: boolean;
  /** true: proposta qui perché l'itinerario non aveva una tratta tra le due tappe. */
  suggested: boolean;
  from: string;
  to: string;
}

export type AgendaEntry = AgendaActivity | AgendaTransfer;

export interface AgendaStop {
  stop: number;
  activityIndex: number;
  title: string;
  time?: string;
  latitude: number;
  longitude: number;
}

export interface DayAgenda {
  day: DayPlan;
  entries: AgendaEntry[];
  stops: AgendaStop[];
  /** Percorso del giorno come coordinate [longitudine, latitudine]. */
  path: Array<[number, number]>;
  /** Se nessuna attività ha una posizione: il punto noto più vicino (alloggio, partenza del giorno o destinazione). */
  anchor?: { label: string; latitude: number; longitude: number };
}

function clock(value: string | undefined): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? '');
  if (!match) return undefined;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes < 24 * 60 ? minutes : undefined;
}

function formatClock(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** «1 h 30 min», «45 min», «2 h». */
export function formatMinutes(minutes: number): string {
  const rounded = Math.max(1, Math.round(minutes / 5) * 5);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** Durata scritta nell'attività («90 min», «2 h», «1 h 30»), in minuti. */
function parseDuration(value: string | undefined): number | undefined {
  const text = value?.toLowerCase().replace(',', '.') ?? '';
  const hours = /(\d+(?:\.\d+)?)\s*(h|ore|ora)/.exec(text);
  const minutes = /(\d+)\s*(min|m\b|')/.exec(text) ?? (hours ? /h\s*(\d{1,2})\b/.exec(text) : null);
  const total = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
  return total > 0 ? total : undefined;
}

/** Distanza in linea d'aria in km (formula dell'emisenoverso). */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Spostamento suggerito tra due tappe senza tratta: a piedi fino a 1,5 km,
 * altrimenti il mezzo del viaggio (auto o bus). Velocità medie prudenti; il
 * percorso reale è più lungo della linea d'aria (fattore 1,3).
 */
export function suggestTransfer(km: number, planTransport: Transport | undefined): { mode: Transport; minutes: number } {
  const road = km * 1.3;
  if (road <= 1.5) return { mode: 'a piedi', minutes: (road / 4.5) * 60 };
  if (planTransport === 'auto' || planTransport === 'taxi') return { mode: planTransport, minutes: (road / 35) * 60 + 5 };
  if (planTransport === 'traghetto') return { mode: 'traghetto', minutes: (road / 25) * 60 + 15 };
  if (road <= 3 && planTransport === 'a piedi') return { mode: 'a piedi', minutes: (road / 4.5) * 60 };
  return { mode: 'autobus', minutes: (road / 20) * 60 + 8 };
}

function activityPlace(activity: Activity): { latitude: number; longitude: number; label?: string } | undefined {
  const place = activity.place;
  if (place?.latitude === undefined || place.longitude === undefined) return undefined;
  if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return undefined;
  return { latitude: place.latitude, longitude: place.longitude, label: place.title };
}

/** Solo valori veri («12 min», «1,4 km»): i segnaposto come «Tempo da definire» non si mostrano. */
function measured(value: string | undefined): string | undefined {
  return value && /\d/.test(value) ? value : undefined;
}

function transferFromSegment(segment: RouteSegment): AgendaTransfer {
  return {
    kind: 'transfer',
    mode: segment.recommendedMode,
    modeLabel: TRANSPORT_LABELS[segment.recommendedMode as keyof typeof TRANSPORT_LABELS] ?? segment.recommendedMode,
    durationLabel: measured(segment.duration),
    distanceLabel: measured(segment.distance),
    estimated: segment.status !== 'VERIFIED',
    suggested: false,
    from: segment.origin.label,
    to: segment.destination.label,
  };
}

/** Il programma di un giorno: attività in ordine, tratte, tappe numerate e percorso. */
export function dayAgenda(itinerary: Itinerary, dayNumber: number): DayAgenda | null {
  const day = itinerary.days.find((item) => item.day === dayNumber);
  if (!day) return null;
  const timeline = timelineEntries(day);
  const entries: AgendaEntry[] = [];
  const stops: AgendaStop[] = [];
  const path: Array<[number, number]> = [];
  let previousStop: AgendaStop | undefined;
  let routeBeforeNext: RouteSegment | undefined;

  timeline.forEach((entry, index) => {
    if (entry.kind === 'route') {
      entries.push(transferFromSegment(entry.segment));
      routeBeforeNext = entry.segment;
      return;
    }
    const { activity, activityIndex } = entry;
    const coordinates = activityPlace(activity);
    let stop: AgendaStop | undefined;
    if (coordinates) {
      stop = { stop: stops.length + 1, activityIndex, title: activity.title, time: clock(activity.time) !== undefined ? activity.time.trim() : undefined, latitude: coordinates.latitude, longitude: coordinates.longitude };
      // Tra due tappe con posizione e senza tratta nell'itinerario, si propone uno spostamento.
      if (previousStop && !routeBeforeNext) {
        const suggestion = suggestTransfer(distanceKm(previousStop, stop), itinerary.transport);
        entries.push({
          kind: 'transfer', mode: suggestion.mode, modeLabel: TRANSPORT_LABELS[suggestion.mode as keyof typeof TRANSPORT_LABELS] ?? suggestion.mode,
          durationLabel: formatMinutes(suggestion.minutes), distanceLabel: `${distanceKm(previousStop, stop).toFixed(1).replace('.', ',')} km in linea d'aria`,
          estimated: true, suggested: true, from: previousStop.title, to: activity.title,
        });
      }
      const geometry = routeBeforeNext?.geometry?.coordinates;
      if (previousStop && geometry?.length) path.push(...geometry);
      else path.push([coordinates.longitude, coordinates.latitude]);
      stops.push(stop);
      previousStop = stop;
    }
    routeBeforeNext = undefined;

    // Durata: quella scritta nell'attività, altrimenti fino all'orario dell'attività successiva.
    const start = clock(activity.time);
    const written = parseDuration(activity.duration);
    const nextActivity = timeline.slice(index + 1).find((item) => item.kind === 'activity');
    const nextStart = nextActivity?.kind === 'activity' ? clock(nextActivity.activity.time) : undefined;
    const minutes = written ?? (start !== undefined && nextStart !== undefined && nextStart > start ? nextStart - start : undefined);
    entries.push({
      kind: 'activity',
      stop: stop?.stop,
      activityIndex,
      time: start !== undefined ? formatClock(start) : undefined,
      endTime: start !== undefined && written ? formatClock(start + written) : undefined,
      durationLabel: minutes ? formatMinutes(minutes) : undefined,
      title: activity.title,
      detail: activity.detail,
      place: activity.place?.title && activity.place.title !== activity.title ? activity.place.title : undefined,
    });
  });
  const known = [day.origin, day.finalDestination, itinerary.lodging?.latitude !== undefined ? { label: itinerary.lodging.name ?? 'Alloggio', latitude: itinerary.lodging.latitude, longitude: itinerary.lodging.longitude } : undefined, itinerary.destinationNode]
    .find((node) => node && Number.isFinite(node.latitude) && Number.isFinite(node.longitude));
  const anchor = !stops.length && known ? { label: known.label ?? itinerary.destination, latitude: known.latitude as number, longitude: known.longitude as number } : undefined;
  return { day, entries, stops, path, anchor };
}
