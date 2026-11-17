/*
 * Dashboard dell'agenzia (AG-07): fatturato lordo del periodo, riempimento
 * medio, viaggi pubblicati, coordinatori attivi, prenotazioni per canale e
 * classifica dei coordinatori per ricavi e riempimento. Dati grezzi dal server
 * (`agency_dashboard_data()`), aggregati qui con funzioni pure.
 */
import type { DashboardRange } from './coordinatorDashboard';

export type BookingChannel = 'odys' | 'direct';
export const BOOKING_CHANNEL_LABELS: Record<BookingChannel, string> = { odys: 'Community Odys', direct: 'Canali diretti' };

export interface AgencyDashboardTrip {
  id: string;
  title: string;
  coordinatorId: string | null;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
  capacity?: number | null;
  sold: number;
}
export interface AgencyDashboardPayment { tripId: string; amountCents: number; at: string }
export interface AgencyDashboardBooking { tripId: string; channel: BookingChannel; at: string }
export interface AgencyDashboardCoordinator { userId: string; name: string; licensed?: boolean }

export interface AgencyLeaderboardRow {
  userId: string;
  name: string;
  licensed: boolean;
  revenueCents: number;
  /** Riempimento medio dei suoi viaggi in vendita o in corso, da 0 a 1; null se non ne ha. */
  fill: number | null;
  trips: number;
}

export interface AgencyDashboardSummary {
  range: DashboardRange;
  revenue: { grossCents: number; previousGrossCents: number; changePercent: number | null };
  /** Riempimento medio dei viaggi in vendita o in corso, da 0 a 1; null se nessuno. */
  averageFill: number | null;
  publishedTrips: number;
  activeCoordinators: number;
  coordinators: number;
  channels: Record<BookingChannel, number> & { directShare: number | null };
  leaderboard: AgencyLeaderboardRow[];
}

/** Stato «in vendita o in corso»: pubblicato e non ancora concluso. */
function onSaleOrRunning(trip: AgencyDashboardTrip, today: string): boolean {
  return trip.status === 'published' && (!trip.endDate || trip.endDate >= today);
}

function averageFill(trips: AgencyDashboardTrip[]): number | null {
  const withSeats = trips.filter((trip) => trip.capacity && trip.capacity > 0);
  if (!withSeats.length) return null;
  return withSeats.reduce((total, trip) => total + Math.min(1, trip.sold / trip.capacity!), 0) / withSeats.length;
}

export function summarizeAgencyDashboard(input: {
  range: DashboardRange;
  now?: Date;
  trips: readonly AgencyDashboardTrip[];
  payments: readonly AgencyDashboardPayment[];
  bookings: readonly AgencyDashboardBooking[];
  coordinators: readonly AgencyDashboardCoordinator[];
}): AgencyDashboardSummary {
  const now = input.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const ms = (value: string) => Date.parse(value);
  const inRange = (at: string, from: string, to: string) => ms(at) >= ms(from) && ms(at) <= ms(to);
  const current = input.payments.filter((payment) => inRange(payment.at, input.range.from, input.range.to));
  const grossCents = current.reduce((total, payment) => total + payment.amountCents, 0);
  const previousGrossCents = input.payments
    .filter((payment) => ms(payment.at) >= ms(input.range.previousFrom) && ms(payment.at) < ms(input.range.previousTo))
    .reduce((total, payment) => total + payment.amountCents, 0);

  const live = input.trips.filter((trip) => onSaleOrRunning(trip, today));
  const bookings = input.bookings.filter((booking) => inRange(booking.at, input.range.from, input.range.to));
  const odys = bookings.filter((booking) => booking.channel === 'odys').length;
  const direct = bookings.length - odys;

  const tripById = new Map(input.trips.map((trip) => [trip.id, trip]));
  const leaderboard = input.coordinators.map((coordinator): AgencyLeaderboardRow => {
    const theirs = live.filter((trip) => trip.coordinatorId === coordinator.userId);
    const revenueCents = current.filter((payment) => tripById.get(payment.tripId)?.coordinatorId === coordinator.userId).reduce((total, payment) => total + payment.amountCents, 0);
    return { userId: coordinator.userId, name: coordinator.name, licensed: Boolean(coordinator.licensed), revenueCents, fill: averageFill(theirs), trips: theirs.length };
  }).sort((a, b) => b.revenueCents - a.revenueCents || (b.fill ?? -1) - (a.fill ?? -1) || a.name.localeCompare(b.name, 'it'));

  return {
    range: input.range,
    revenue: { grossCents, previousGrossCents, changePercent: previousGrossCents > 0 ? Math.round(((grossCents - previousGrossCents) / previousGrossCents) * 100) : null },
    averageFill: averageFill(live),
    publishedTrips: live.length,
    activeCoordinators: new Set(live.map((trip) => trip.coordinatorId).filter(Boolean)).size,
    coordinators: input.coordinators.length,
    channels: { odys, direct, directShare: bookings.length ? Math.round((direct / bookings.length) * 100) : null },
    leaderboard,
  };
}
