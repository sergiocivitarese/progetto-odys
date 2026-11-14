import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardRange, summarizeDashboard, weekStart, type AnalyticsEvent, type AnalyticsPayment } from '../src/lib/coordinatorDashboard.ts';

const now = new Date('2027-03-17T10:00:00Z'); // mercoledì

test('periodi e periodo di confronto della stessa lunghezza', () => {
  const month = dashboardRange('month', now);
  assert.deepEqual([month.from, month.to, month.previousFrom, month.previousTo], ['2027-03-01T00:00:00.000Z', now.toISOString(), '2027-02-01T00:00:00.000Z', '2027-02-17T10:00:00.000Z']);
  const last = dashboardRange('last_month', now);
  assert.deepEqual([last.from, last.to, last.previousFrom], ['2027-02-01T00:00:00.000Z', '2027-03-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z']);
  // 31 marzo → 28 febbraio: il giorno si riduce al mese più corto.
  assert.equal(dashboardRange('month', new Date('2027-03-31T09:00:00Z')).previousTo, '2027-02-28T09:00:00.000Z');
  assert.equal(dashboardRange('year', now).previousTo, '2026-03-17T10:00:00.000Z');
  assert.equal(weekStart(now).toISOString(), '2027-03-15T00:00:00.000Z');
});

test('guadagni del periodo al netto del servizio, variazione, prenotazioni per settimana (CP-01)', () => {
  const payments: AnalyticsPayment[] = [
    { tripId: 't1', kind: 'deposit', amountCents: 20000, currency: 'EUR', at: '2027-03-02T09:00:00Z' },
    { tripId: 't1', kind: 'balance', amountCents: 50000, currency: 'EUR', at: '2027-03-17T10:00:00Z' }, // proprio adesso: conta
    { tripId: 't1', kind: 'deposit', amountCents: 30000, currency: 'EUR', at: '2027-02-10T09:00:00Z' },
    { tripId: 't1', kind: 'deposit', amountCents: 99999, currency: 'EUR', at: '2027-02-20T09:00:00Z' }, // dopo il 17 febbraio: fuori dal confronto
  ];
  const events: AnalyticsEvent[] = [
    { tripId: 't1', kind: 'booking_confirmed', at: '2027-03-16T08:00:00Z' },
    { tripId: 't1', kind: 'booking_confirmed', at: '2027-03-15T00:00:00Z' },
    { tripId: 't1', kind: 'booking_confirmed', at: '2027-01-20T12:00:00Z' }, // 8 settimane fa
    { tripId: 't1', kind: 'booking_confirmed', at: '2026-12-01T12:00:00Z' }, // troppo vecchia
  ];
  const summary = summarizeDashboard({ range: dashboardRange('month', now), now, events, payments, trips: [], serviceRate: 0.1 });
  assert.deepEqual(summary.earnings, { grossCents: 70000, serviceCents: 7000, netCents: 63000, previousNetCents: 27000, changePercent: 133 });
  assert.equal(summary.weeklyBookings.length, 8);
  assert.deepEqual(summary.weeklyBookings.at(-1), { weekStart: '2027-03-15', count: 2 });
  assert.deepEqual(summary.weeklyBookings[0], { weekStart: '2027-01-25', count: 0 });
  assert.equal(summary.weeklyBookings.reduce((total, week) => total + week.count, 0), 2);
  const empty = summarizeDashboard({ range: dashboardRange('month', now), now, events: [], payments: [], trips: [], serviceRate: 0.1 });
  assert.equal(empty.earnings.changePercent, null);
});

test('funnel con tasso di passaggio, posti venduti e viaggi attivi (CP-02, CP-04, CP-05)', () => {
  const at = '2027-03-10T10:00:00Z';
  const events: AnalyticsEvent[] = [
    ...Array.from({ length: 40 }, () => ({ tripId: 't1', kind: 'view' as const, at })),
    ...Array.from({ length: 10 }, () => ({ tripId: 't1', kind: 'save' as const, at })),
    ...Array.from({ length: 4 }, () => ({ tripId: 't1', kind: 'request' as const, at })),
    ...Array.from({ length: 3 }, () => ({ tripId: 't1', kind: 'booking_confirmed' as const, at })),
    { tripId: 't1', kind: 'view', at: '2027-02-10T10:00:00Z' }, // fuori periodo
  ];
  const trips = [
    { id: 't2', title: 'B', destination: 'Bari', capacity: 8, sold: 8, effectiveStatus: 'published', startDate: '2027-06-01' },
    { id: 't1', title: 'A', destination: 'Amalfi', capacity: 12, sold: 3, effectiveStatus: 'published', startDate: '2027-05-01' },
    { id: 't3', title: 'C', destination: 'Como', capacity: 10, sold: 0, effectiveStatus: 'draft' },
    { id: 't4', title: 'D', destination: 'Dolomiti', capacity: 10, sold: 10, effectiveStatus: 'completed' },
  ];
  const summary = summarizeDashboard({ range: dashboardRange('month', now), now, events, payments: [], trips, serviceRate: 0.1 });
  assert.deepEqual(summary.funnel.map((stage) => [stage.count, stage.rate]), [[40, null], [10, 25], [4, 40], [3, 75]]);
  assert.deepEqual(summary.seats, { sold: 11, offered: 20 });
  assert.deepEqual(summary.activeTrips.map((trip) => [trip.id, trip.fill, trip.soldOut]), [['t1', 0.25, false], ['t2', 1, true]]);
});
