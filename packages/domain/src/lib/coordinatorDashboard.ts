/*
 * Dashboard del Coordinatore Premium (CP-01…CP-05): dai dati grezzi registrati
 * dal server (eventi dei viaggi e pagamenti confermati) ai numeri mostrati.
 * Funzioni pure: le usa l'API sia con Supabase sia con l'archivio in memoria.
 * Date e settimane in UTC.
 */

export type DashboardPeriodKey = 'month' | 'last_month' | '90d' | 'year';

export const DASHBOARD_PERIODS: Record<DashboardPeriodKey, string> = {
  month: 'Questo mese',
  last_month: 'Mese scorso',
  '90d': 'Ultimi 90 giorni',
  year: 'Quest’anno',
};

export interface DashboardRange {
  key: DashboardPeriodKey;
  label: string;
  /** Inizio incluso, fine esclusa (ISO). */
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
}

export type AnalyticsEventKind = 'view' | 'save' | 'request' | 'payment_confirmed' | 'booking_confirmed';
export interface AnalyticsEvent { tripId: string; kind: AnalyticsEventKind; at: string }
export interface AnalyticsPayment { tripId: string; kind: 'deposit' | 'balance'; amountCents: number; currency: string; at: string }
export interface DashboardTripInput {
  id: string;
  title: string;
  destination: string;
  capacity?: number;
  /** Posti venduti (confermati, con o senza saldo). */
  sold: number;
  effectiveStatus: string;
  startDate?: string;
}

export interface FunnelStage { key: 'view' | 'save' | 'request' | 'booking_confirmed'; label: string; count: number; /** Passaggio dalla fase precedente, in %. */ rate: number | null }

export interface DashboardSummary {
  range: DashboardRange;
  earnings: { grossCents: number; serviceCents: number; netCents: number; previousNetCents: number; changePercent: number | null };
  /** Prenotazioni confermate per settimana, ultime 8 settimane (lunedì → domenica), la più vecchia per prima. */
  weeklyBookings: Array<{ weekStart: string; count: number }>;
  seats: { sold: number; offered: number };
  funnel: FunnelStage[];
  activeTrips: Array<DashboardTripInput & { fill: number; soldOut: boolean }>;
}

const DAY = 86_400_000;

function utcDate(year: number, month: number, day = 1): Date {
  return new Date(Date.UTC(year, month, day));
}

/** Stesso istante spostato di `months` mesi, con il giorno ridotto se il mese è più corto. */
function shiftMonths(date: Date, months: number): Date {
  const target = utcDate(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
  const lastDay = utcDate(target.getUTCFullYear(), target.getUTCMonth() + 1, 0).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date.getUTCDate(), lastDay), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}

/** Periodo scelto e periodo di confronto della stessa lunghezza, subito prima. */
export function dashboardRange(key: DashboardPeriodKey, now = new Date()): DashboardRange {
  const iso = (date: Date) => date.toISOString();
  const label = DASHBOARD_PERIODS[key];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (key === 'month') {
    const from = utcDate(y, m);
    return { key, label, from: iso(from), to: iso(now), previousFrom: iso(utcDate(y, m - 1)), previousTo: iso(shiftMonths(now, -1)) };
  }
  if (key === 'last_month') {
    return { key, label, from: iso(utcDate(y, m - 1)), to: iso(utcDate(y, m)), previousFrom: iso(utcDate(y, m - 2)), previousTo: iso(utcDate(y, m - 1)) };
  }
  if (key === '90d') {
    return { key, label, from: iso(new Date(now.getTime() - 90 * DAY)), to: iso(now), previousFrom: iso(new Date(now.getTime() - 180 * DAY)), previousTo: iso(new Date(now.getTime() - 90 * DAY)) };
  }
  return { key, label, from: iso(utcDate(y, 0)), to: iso(now), previousFrom: iso(utcDate(y - 1, 0)), previousTo: iso(shiftMonths(now, -12)) };
}

export function isDashboardPeriod(value: unknown): value is DashboardPeriodKey {
  return typeof value === 'string' && value in DASHBOARD_PERIODS;
}

/** Lunedì 00:00 UTC della settimana che contiene `date`. */
export function weekStart(date: Date): Date {
  const day = (date.getUTCDay() + 6) % 7;
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day);
}

const FUNNEL: Array<{ key: FunnelStage['key']; label: string }> = [
  { key: 'view', label: 'Visualizzazioni' },
  { key: 'save', label: 'Salvataggi' },
  { key: 'request', label: 'Richieste con acconto' },
  { key: 'booking_confirmed', label: 'Prenotazioni confermate' },
];

const ON_SALE = new Set(['published', 'active']);

export function summarizeDashboard(input: {
  range: DashboardRange;
  now?: Date;
  events: readonly AnalyticsEvent[];
  payments: readonly AnalyticsPayment[];
  trips: readonly DashboardTripInput[];
  serviceRate: number;
}): DashboardSummary {
  const { range } = input;
  const now = input.now ?? new Date();
  // Confronto in millisecondi: i formati ISO in arrivo differiscono (`Z`, `.000Z`, `+00:00`).
  const ms = (value: string) => Date.parse(value);
  const within = (at: string, from: string, to: string) => ms(at) >= ms(from) && ms(at) < ms(to);
  const sumNet = (from: string, to: string) => {
    const gross = input.payments.filter((payment) => within(payment.at, from, to)).reduce((total, payment) => total + payment.amountCents, 0);
    const service = Math.round(gross * input.serviceRate);
    return { gross, service, net: gross - service };
  };
  // La fine del periodo corrente è «adesso»: un pagamento di questo istante deve contare.
  const current = sumNet(range.from, ms(range.to) === now.getTime() ? new Date(now.getTime() + 1).toISOString() : range.to);
  const previous = sumNet(range.previousFrom, range.previousTo);

  const thisWeek = weekStart(now);
  const weeks = Array.from({ length: 8 }, (_, index) => new Date(thisWeek.getTime() - (7 - index) * 7 * DAY));
  const weeklyBookings = weeks.map((start) => {
    const end = new Date(start.getTime() + 7 * DAY).toISOString();
    return { weekStart: start.toISOString().slice(0, 10), count: input.events.filter((event) => event.kind === 'booking_confirmed' && within(event.at, start.toISOString(), end)).length };
  });

  const inPeriod = input.events.filter((event) => ms(event.at) >= ms(range.from) && ms(event.at) <= ms(range.to));
  const counts = FUNNEL.map((stage) => inPeriod.filter((event) => event.kind === stage.key).length);
  const funnel = FUNNEL.map((stage, index) => ({
    ...stage,
    count: counts[index],
    rate: index === 0 || counts[index - 1] === 0 ? null : Math.round((counts[index] / counts[index - 1]) * 100),
  }));

  const activeTrips = input.trips
    .filter((trip) => ON_SALE.has(trip.effectiveStatus))
    .map((trip) => ({ ...trip, fill: trip.capacity ? Math.min(1, trip.sold / trip.capacity) : 0, soldOut: Boolean(trip.capacity && trip.sold >= trip.capacity) }))
    .sort((a, b) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999'));

  return {
    range,
    earnings: {
      grossCents: current.gross,
      serviceCents: current.service,
      netCents: current.net,
      previousNetCents: previous.net,
      changePercent: previous.net > 0 ? Math.round(((current.net - previous.net) / previous.net) * 100) : null,
    },
    weeklyBookings,
    seats: { sold: activeTrips.reduce((total, trip) => total + trip.sold, 0), offered: activeTrips.reduce((total, trip) => total + (trip.capacity ?? 0), 0) },
    funnel,
    activeTrips,
  };
}
