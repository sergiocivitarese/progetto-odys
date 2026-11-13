/*
 * Generatore di itinerari del Traveller Premium (TP-01…TP-03).
 *
 * Trasforma i parametri della schermata (meta o «Sorprendimi», date precise o
 * mesi flessibili, durata, budget a persona, interessi) in un modulo per il
 * motore di itinerari di Odys e stima i costi per giorno.
 *
 * Il fornitore AI è un punto aperto del cliente: oggi l'itinerario lo produce
 * il motore locale (`generateItinerary`). Le stime di costo sono indicative e
 * vanno presentate come tali.
 */
import type { Itinerary, TripForm } from '../types/travel';
import { generateItinerary } from './generateItinerary';
import { normalizePlan } from './itineraryEditing';

export type GeneratorDuration = 'weekend' | '3-5' | '7' | '7+';

export const GENERATOR_DURATIONS: Record<GeneratorDuration, { label: string; days: number }> = {
  weekend: { label: 'Weekend', days: 3 },
  '3-5': { label: '3-5 gg', days: 4 },
  '7': { label: '7 gg', days: 7 },
  '7+': { label: '>7 gg', days: 9 },
};

export type GeneratorDates =
  | { mode: 'precise'; departure: string; returnDate: string }
  | { mode: 'flexible'; months: number[] };

export interface GeneratorParams {
  /** Campo libero; vuoto con `surprise` = la meta la sceglie Odys. */
  destination?: string;
  surprise?: boolean;
  dates: GeneratorDates;
  duration: GeneratorDuration;
  budgetPerPersonCents: number;
  interests: string[];
}

export interface GeneratedDay {
  day: number;
  date: string;
  title: string;
  places: string[];
  /** Stima indicativa a persona: alloggio, pasti e attività del giorno. */
  costCents: number;
}

export interface GeneratedTrip {
  title: string;
  destination: string;
  departure: string;
  returnDate: string;
  interests: string[];
  days: GeneratedDay[];
  totalCents: number;
  budgetCents: number;
  /** Da dove viene l'itinerario, da mostrare con onestà. */
  engine: 'odys-local';
  itinerary: Itinerary;
}

/** Mete proposte da «Sorprendimi», con gli interessi per cui hanno senso. */
export const SURPRISE_DESTINATIONS: ReadonlyArray<{ name: string; interests: string[] }> = [
  { name: 'Costiera Amalfitana', interests: ['Mare', 'Cibo', 'Storia', 'Trekking'] },
  { name: 'Lisbona', interests: ['Città', 'Cibo', 'Storia', 'Surf', 'Nightlife'] },
  { name: 'Dolomiti', interests: ['Trekking', 'Natura', 'Avventura', 'Relax'] },
  { name: 'Atene', interests: ['Storia', 'Rovine', 'Mare', 'Cibo'] },
  { name: 'Copenaghen', interests: ['Arte', 'Città', 'Cibo'] },
  { name: 'Sicilia orientale', interests: ['Mare', 'Cibo', 'Storia', 'Rovine'] },
  { name: 'Marrakech', interests: ['Cibo', 'Arte', 'Avventura'] },
  { name: 'Puglia', interests: ['Mare', 'Cibo', 'Relax'] },
  { name: 'Berlino', interests: ['Arte', 'Città', 'Nightlife', 'Storia'] },
  { name: 'Islanda', interests: ['Natura', 'Avventura', 'Trekking'] },
];

/** Costi indicativi a persona, in centesimi: base giornaliera e attività per categoria. */
const DAILY_LODGING_CENTS = 4500;
const DAILY_MEALS_CENTS = 3000;
const ACTIVITY_CENTS: Record<string, number> = {
  Cibo: 2500, Arte: 1500, Storia: 1500, Rovine: 1500, Design: 1000, Benessere: 4000, Relax: 2000,
  Natura: 0, Trekking: 0, Mare: 1000, Surf: 4000, Avventura: 3500, Nightlife: 2500, Città: 500,
};

function key(value: string): string {
  return value.trim().toLocaleLowerCase('it').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Meta scelta da «Sorprendimi»: la più affine agli interessi; `seed` alterna le alternative a pari merito. */
export function surpriseDestination(interests: readonly string[], seed = 0): string {
  const wanted = new Set(interests.map(key));
  const scored = SURPRISE_DESTINATIONS
    .map((item) => ({ name: item.name, score: item.interests.filter((interest) => wanted.has(key(interest))).length }))
    .sort((a, b) => b.score - a.score);
  const best = scored.filter((item) => item.score === scored[0].score);
  return best[Math.abs(seed) % best.length].name;
}

/** Date del viaggio: precise come indicate, flessibili dal 10 del primo mese scelto ancora da venire. */
export function resolveGeneratorDates(params: Pick<GeneratorParams, 'dates' | 'duration'>, today = new Date()): { departure: string; returnDate: string } {
  if (params.dates.mode === 'precise') {
    const { departure, returnDate } = params.dates;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(departure) || !/^\d{4}-\d{2}-\d{2}$/.test(returnDate) || returnDate < departure) {
      throw new Error('Indica una data di partenza e una di ritorno valide.');
    }
    if (addDays(departure, 20) < returnDate) throw new Error('Il generatore prepara viaggi fino a 21 giorni.');
    return { departure, returnDate };
  }
  const months = [...new Set(params.dates.months)].filter((month) => Number.isInteger(month) && month >= 1 && month <= 12).sort((a, b) => a - b);
  if (!months.length) throw new Error('Scegli almeno un mese.');
  const todayKey = today.toISOString().slice(0, 10);
  const year = today.getUTCFullYear();
  const candidates = months.flatMap((month) => [year, year + 1].map((y) => `${y}-${String(month).padStart(2, '0')}-10`)).filter((date) => date > todayKey).sort();
  const departure = candidates[0];
  return { departure, returnDate: addDays(departure, GENERATOR_DURATIONS[params.duration].days - 1) };
}

/** Modulo per il motore di itinerari a partire dai parametri della schermata. */
export function generatorTripForm(params: GeneratorParams, seed = 0, today = new Date()): TripForm {
  const destination = params.surprise || !params.destination?.trim() ? surpriseDestination(params.interests, seed) : params.destination.trim();
  const { departure, returnDate } = resolveGeneratorDates(params, today);
  // Rigenera: stessi parametri, interessi in un altro ordine, così cambiano le attività proposte.
  const interests = params.interests.length ? params.interests.map((_, index, list) => list[(index + seed) % list.length]) : ['Storia', 'Cibo'];
  return {
    destination,
    departure,
    returnDate,
    arrivalTime: '12:00',
    departureTime: '17:00',
    travelers: '1',
    budget: `${Math.round(params.budgetPerPersonCents / 100)}€`,
    budgetPerTraveler: `${Math.round(params.budgetPerPersonCents / 100)}€`,
    budgetReliability: 'USER_ENTERED',
    pace: 'equilibrato',
    interests,
    customInterests: [],
    constraints: '',
    transport: 'misto',
    stops: [],
    lodging: {},
  };
}

/** Costo indicativo di un giorno a persona: alloggio (non l'ultimo giorno), pasti, attività per categoria. */
export function estimateDayCost(categories: readonly string[], lastDay: boolean): number {
  const activities = categories.reduce((total, category) => total + (ACTIVITY_CENTS[category] ?? 1000), 0);
  return (lastDay ? 0 : DAILY_LODGING_CENTS) + DAILY_MEALS_CENTS + activities;
}

/** Genera l'itinerario giorno per giorno con le stime di costo (TP-02). */
export function generateTrip(params: GeneratorParams, seed = 0, today = new Date()): GeneratedTrip {
  if (!Number.isInteger(params.budgetPerPersonCents) || params.budgetPerPersonCents < 0) throw new Error('Budget non valido.');
  const form = generatorTripForm(params, seed, today);
  const itinerary = normalizePlan(generateItinerary(form));
  const days = itinerary.days.map((day, index): GeneratedDay => {
    const places = [...new Set(day.activities.map((activity) => activity.place?.title || activity.title).filter(Boolean))].slice(0, 3);
    return {
      day: day.day,
      date: day.date,
      title: day.label,
      places,
      costCents: estimateDayCost(day.activities.map((activity) => String(activity.category)), index === itinerary.days.length - 1),
    };
  });
  return {
    title: `${form.destination} in ${days.length} ${days.length === 1 ? 'giorno' : 'giorni'}`,
    destination: form.destination,
    departure: form.departure,
    returnDate: form.returnDate,
    interests: params.interests,
    days,
    totalCents: days.reduce((total, day) => total + day.costCents, 0),
    budgetCents: params.budgetPerPersonCents,
    engine: 'odys-local',
    itinerary,
  };
}
