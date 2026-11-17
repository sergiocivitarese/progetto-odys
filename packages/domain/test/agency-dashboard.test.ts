import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardRange } from '../src/lib/coordinatorDashboard.ts';
import { summarizeAgencyDashboard, type AgencyDashboardTrip } from '../src/lib/agencyDashboard.ts';

const now = new Date('2027-03-17T10:00:00Z');
const range = dashboardRange('month', now);

const trips: AgencyDashboardTrip[] = [
  { id: 'a', title: 'Gargano', coordinatorId: 'nora', status: 'published', startDate: '2027-05-20', endDate: '2027-05-24', capacity: 12, sold: 9 },
  { id: 'b', title: 'Cilento', coordinatorId: 'ivo', status: 'published', startDate: '2027-06-01', endDate: '2027-06-05', capacity: 10, sold: 2 },
  { id: 'c', title: 'Sila bozza', coordinatorId: null, status: 'draft', startDate: '2027-09-01', endDate: '2027-09-04', capacity: 12, sold: 0 },
  { id: 'd', title: 'Concluso', coordinatorId: 'nora', status: 'published', startDate: '2027-01-10', endDate: '2027-01-14', capacity: 8, sold: 8 },
];

test('fatturato lordo con variazione, riempimento medio, viaggi e coordinatori attivi (AG-07)', () => {
  const summary = summarizeAgencyDashboard({
    range, now, trips,
    payments: [
      { tripId: 'a', amountCents: 18000, at: '2027-03-02T09:00:00Z' },
      { tripId: 'a', amountCents: 54000, at: '2027-03-10T09:00:00Z' },
      { tripId: 'b', amountCents: 16000, at: '2027-03-17T10:00:00Z' },
      { tripId: 'a', amountCents: 44000, at: '2027-02-05T09:00:00Z' },
    ],
    bookings: [],
    coordinators: [{ userId: 'nora', name: 'Nora C.', licensed: true }, { userId: 'ivo', name: 'Ivo S.' }, { userId: 'lia', name: 'Lia B.' }],
  });
  assert.deepEqual(summary.revenue, { grossCents: 88000, previousGrossCents: 44000, changePercent: 100 });
  assert.equal(summary.publishedTrips, 2, 'la bozza e il viaggio concluso non contano');
  assert.equal(summary.averageFill, (9 / 12 + 2 / 10) / 2);
  assert.deepEqual([summary.activeCoordinators, summary.coordinators], [2, 3]);
  assert.deepEqual(summary.leaderboard.map((row) => [row.name, row.revenueCents, row.trips, row.licensed]), [['Nora C.', 72000, 1, true], ['Ivo S.', 16000, 1, false], ['Lia B.', 0, 0, false]]);
  assert.equal(summary.leaderboard[2].fill, null);
});

test('prenotazioni per canale con quota dei canali diretti', () => {
  const at = '2027-03-08T10:00:00Z';
  const summary = summarizeAgencyDashboard({
    range, now, trips, payments: [], coordinators: [],
    bookings: [
      { tripId: 'a', channel: 'odys', at }, { tripId: 'a', channel: 'odys', at }, { tripId: 'a', channel: 'direct', at },
      { tripId: 'b', channel: 'direct', at: '2027-02-08T10:00:00Z' },
    ],
  });
  assert.deepEqual(summary.channels, { odys: 2, direct: 1, directShare: 33 });
  const empty = summarizeAgencyDashboard({ range, now, trips: [], payments: [], bookings: [], coordinators: [] });
  assert.deepEqual([empty.channels.directShare, empty.averageFill, empty.revenue.changePercent], [null, null, null]);
});
