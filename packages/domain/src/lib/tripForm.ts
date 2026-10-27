import type { ArrivalTransport, LocationNode, Pace, RecommendedInterest, TripForm } from '../types/travel';
import { nodeIdForLabel } from './routeModel';
import { validateArrivalDate, validateDateRange, validateSchedule, validateTime } from './generateItinerary';

/*
 * Regole del modulo "Pianifica il mio viaggio" (app/create.tsx di Triply).
 */

export const RECOMMENDED_INTERESTS: RecommendedInterest[] = ['Arte', 'Cibo', 'Natura', 'Storia', 'Benessere', 'Design'];
export const PACE_OPTIONS: Pace[] = ['rilassato', 'equilibrato', 'intenso'];

export function initialTripForm(): TripForm {
  return {
    destination: '',
    departure: '',
    returnDate: '',
    arrivalTime: '',
    departureTime: '',
    travelers: '2',
    budget: '800€',
    budgetPerTraveler: '800€',
    pace: 'equilibrato',
    interests: ['Cibo', 'Natura'],
    customInterests: [],
    constraints: '',
    transport: 'trasporto pubblico',
    arrivalTransport: 'aereo',
    arrivalDayOffset: 0,
    arrivalDestinationKind: 'first-activity',
    stops: [],
    lodging: {},
  };
}

function slug(value: string): string {
  return value.toLocaleLowerCase('it').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'destinazione';
}

function pointType(mode: ArrivalTransport): LocationNode['type'] {
  if (mode === 'aereo') return 'airport';
  if (mode === 'treno') return 'station';
  if (mode === 'traghetto') return 'port';
  return 'custom';
}

export function arrivalPointLabel(mode: ArrivalTransport, destination: string): string {
  const city = destination.trim() || 'la destinazione';
  if (mode === 'aereo') return `Aeroporto di ${city}`;
  if (mode === 'treno') return `Stazione di ${city}`;
  if (mode === 'traghetto') return `Porto o terminal di ${city}`;
  if (mode === 'autobus') return `Terminal autobus di ${city}`;
  return mode === 'auto' ? `Città o indirizzo a ${city}` : `Punto di arrivo a ${city}`;
}

export function arrivalPointFieldLabel(mode: ArrivalTransport | undefined): string {
  if (mode === 'aereo') return 'Aeroporto di arrivo';
  if (mode === 'treno') return 'Stazione di arrivo';
  if (mode === 'traghetto') return 'Porto o terminal di arrivo';
  return 'Punto di arrivo';
}

/** Punto di arrivo demo proposto in base a mezzo e destinazione. */
export function arrivalOption(mode: ArrivalTransport, destination: string): LocationNode {
  return {
    id: `arrival-${slug(destination)}-${mode}`,
    label: arrivalPointLabel(mode, destination),
    type: pointType(mode),
    placeId: `demo-arrivo-${mode}-${slug(destination)}`,
    city: destination.trim() || undefined,
    country: 'Da verificare',
    timezone: 'Da verificare',
    source: 'Catalogo demo locale Odys',
    updatedAt: '2026-08-25',
    reliabilityStatus: 'DEMO',
    geoStatus: 'DEMO',
  };
}

/** Punto inserito a mano: resta "mancante" finché non viene cercato. */
export function locationFromText(label: string, type: LocationNode['type'] = 'custom'): LocationNode | undefined {
  const value = label.trim();
  return value ? { id: nodeIdForLabel(value, 'manual'), label: value, type, placeId: `manual-${slug(value)}`, source: 'Inserito manualmente', reliabilityStatus: 'MISSING', geoStatus: 'MISSING' } : undefined;
}

export function validateTripForm(form: TripForm): string | null {
  if (!form.destination.trim()) return 'Inserisci una destinazione.';
  if (!form.departure) return 'Scegli la data di partenza.';
  if (!form.returnDate) return 'Scegli la data di rientro.';
  const dateError = validateDateRange(form.departure, form.returnDate);
  if (dateError) return dateError;
  if (form.arrivalPoint) {
    const arrivalDateError = validateArrivalDate(form.departure, form.returnDate, form.arrivalDayOffset, form.arrivalDate);
    if (arrivalDateError) return arrivalDateError;
    if (form.arrivalDestinationKind === 'custom' && !form.arrivalDestinationPoint?.label?.trim()) return 'Inserisci il punto personalizzato dopo l’arrivo oppure scegli un’altra prima destinazione.';
  }
  if (form.arrivalTime) {
    const arrivalError = validateTime(form.arrivalTime, 'Orario di arrivo');
    if (arrivalError) return arrivalError;
  }
  if (form.departureTime) {
    const departureError = validateTime(form.departureTime, 'Orario di partenza');
    if (departureError) return departureError;
  }
  return form.arrivalTime && form.departureTime ? validateSchedule(form.departure, form.returnDate, form.arrivalTime, form.departureTime) : null;
}

/** Controlli sull'aggiunta di un interesse personalizzato. */
export function customInterestError(form: TripForm, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Scrivi un interesse prima di aggiungerlo.';
  if ([...form.interests, ...form.customInterests].some((item) => item.toLocaleLowerCase('it') === trimmed.toLocaleLowerCase('it'))) return 'Questo interesse è già selezionato.';
  return null;
}

export function stopError(form: TripForm, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if ((form.stops ?? []).some((stop) => stop.toLocaleLowerCase('it') === trimmed.toLocaleLowerCase('it'))) return 'Questa tappa è già presente.';
  return null;
}
