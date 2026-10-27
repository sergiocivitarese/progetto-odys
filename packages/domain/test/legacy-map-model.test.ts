import assert from 'node:assert/strict';
import test from 'node:test';
import * as domain from '../src/index.ts';


const routeModel = domain;
const mapModel = domain;
const repositioning = domain;

const node = (id, label, latitude, longitude, type = 'activity') => ({
  id, label, type, latitude, longitude, source: 'Test locale', reliabilityStatus: 'DEMO', geoStatus: 'DEMO',
});
const activity = (id, latitude, longitude) => ({
  time: '10:00', title: id, detail: 'Test', category: 'Storia', place: {
    id, placeId: id, title: id, latitude, longitude, source: 'Test locale', updatedAt: '2026-08-25', geoStatus: 'DEMO', category: 'Storia', whyRecommended: 'Test',
  },
});
const segment = (id, from, to, order = 0) => ({
  id, day: 1, order, fromNodeId: from.id, toNodeId: to.id, origin: from, destination: to, type: 'intracity', recommendedMode: 'a piedi', alternatives: [], cost: '—', changes: '—', comfort: '—', weatherImpact: '—', reliability: 'DEMO', status: 'DEMO', note: 'Collegamento test', source: 'Test locale',
});

function plan() {
  const start = node('start', 'Partenza', 41.9, 12.5, 'accommodation');
  const museum = node('activity-museo', 'Museo', 41.91, 12.51);
  const duplicateMuseum = node('activity-museo', 'Museo duplicato', 41.91, 12.51);
  return {
    destination: 'Roma', duration: 1, profile: 'Test', pace: 'equilibrato', transport: 'a piedi', estimate: '—', weatherNote: '—', days: [{
      day: 1, date: '2026-09-12', label: 'Giorno 1', activities: [activity('museo', 41.91, 12.51), activity('archivio', undefined, undefined)],
      rainyAlternative: '—', tiredAlternative: '—', origin: start, finalDestination: museum, segments: [segment('route-1', start, duplicateMuseum)],
    }], nextSteps: [], version: 5, interurbanRoutes: [],
  };
}

test('la mappa deduplica marker e non disegna collegamenti senza geometria reale', () => {
  const duplicatePlan = plan();
  duplicatePlan.days[0].segments.push({ ...duplicatePlan.days[0].segments[0], id: 'route-duplicate-with-another-id' });
  const snapshot = mapModel.deriveMapSnapshot(duplicatePlan);
  assert.equal(snapshot.markers.filter((marker) => marker.nodeId === 'activity-museo').length, 1);
  assert.equal(snapshot.markers.some((marker) => marker.label === 'archivio'), false);
  assert.equal(snapshot.routeLinks.length, 0);
});

test('la sincronizzazione è idempotente e conserva lo stato offline', () => {
  const initial = mapModel.synchronizeItineraryMap(plan(), '2026-08-25T10:00:00.000Z');
  const repeated = mapModel.synchronizeItineraryMap(initial, '2026-08-25T11:00:00.000Z');
  assert.equal(repeated.mapSnapshot.signature, initial.mapSnapshot.signature);
  assert.equal(repeated.mapSnapshot.updatedAt, initial.mapSnapshot.updatedAt);
  assert.equal(repeated.mapSnapshot.offline.status, 'NOT_DOWNLOADED');
});

test('senza chiave MapTiler lo snapshot dichiara il fallback locale', () => {
  delete process.env.EXPO_PUBLIC_MAPTILER_KEY;
  const snapshot = mapModel.deriveMapSnapshot(plan());
  const daily = mapModel.deriveDayMapSnapshot(plan(), 1);
  assert.equal(snapshot.provider, 'Locale');
  assert.equal(daily.provider, 'Locale');
});

test('il filtro del giorno conserva soltanto marker e tratte pertinenti', () => {
  const snapshot = mapModel.deriveMapSnapshot(plan());
  const filtered = mapModel.filterMapSnapshot(snapshot, 'day', 1);
  assert.equal(filtered.markers.every((marker) => marker.day === 1), true);
  assert.equal(filtered.routeLinks.every((link) => link.day === 1), true);
});

test('la mappa giornaliera ordina i marker e non inventa percorsi senza geometria', () => {
  const dailyPlan = plan();
  const [route] = dailyPlan.days[0].segments;
  dailyPlan.days[0].segments = [{
    ...route,
    geometry: { kind: 'route', coordinates: [[12.5, 41.9], [12.51, 41.91]] },
  }];
  const withGeometry = mapModel.deriveDayMapSnapshot(dailyPlan, 1);
  assert.deepEqual(withGeometry.markers.map((marker) => marker.sequence), [1, 2]);
  assert.equal(withGeometry.markers[0].label, 'Partenza');
  assert.equal(withGeometry.routeLinks.length, 1);
  assert.equal(withGeometry.routeLinks[0].geometry.kind, 'route');

  dailyPlan.days[0].segments = [route];
  const withoutGeometry = mapModel.deriveDayMapSnapshot(dailyPlan, 1);
  assert.equal(withoutGeometry.routeLinks.length, 0);
  assert.equal(withoutGeometry.markers.some((marker) => marker.label === 'archivio'), false);
});

test('la mappa giornaliera non aggiunge rientri o nodi di altri giorni', () => {
  const twoDays = plan();
  const hotel = node('hotel', 'Hotel', 41.89, 12.49, 'accommodation');
  const secondStop = node('activity-secondo', 'Secondo giorno', 41.88, 12.48);
  twoDays.days.push({
    day: 2, date: '2026-09-13', label: 'Giorno 2', activities: [activity('secondo', 41.88, 12.48)],
    rainyAlternative: '—', tiredAlternative: '—', origin: hotel, finalDestination: secondStop,
    segments: [segment('route-2', hotel, secondStop)],
  });
  twoDays.days[1].segments[0].day = 2;
  const firstDay = mapModel.deriveDayMapSnapshot(twoDays, 1);
  const secondDay = mapModel.deriveDayMapSnapshot(twoDays, 2);
  assert.equal(firstDay.markers.some((marker) => marker.label === 'Secondo giorno'), false);
  assert.equal(secondDay.markers.some((marker) => marker.label === 'Partenza'), false);
  assert.equal(secondDay.markers.some((marker) => marker.label === 'Hotel'), true);
});

test('la mappa giornaliera conserva la destinazione geocodificata come contesto senza inventare tratte', () => {
  const destinationOnly = plan();
  destinationOnly.days[0].activities = [activity('senza-coordinate', undefined, undefined)];
  destinationOnly.days[0].segments = [];
  destinationOnly.destinationNode = node('destinazione-lisbona', 'Lisbona, Portogallo', 38.7223, -9.1393, 'final');
  const snapshot = mapModel.deriveDayMapSnapshot(destinationOnly, 1);
  assert.equal(snapshot.markers.some((marker) => marker.nodeId === 'destinazione-lisbona'), true);
  assert.equal(snapshot.routeLinks.length, 0);
});

test('il riposizionamento propone senza riordinare automaticamente', () => {
  const day = {
    day: 1, date: '2026-09-12', label: 'Giorno 1', rainyAlternative: '—', tiredAlternative: '—',
    activities: [activity('a', 41.9, 12.5), activity('c', 41.92, 12.52), activity('b', 41.91, 12.51)],
  };
  day.activities.forEach((item) => { item.place.geoStatus = 'CONFIRMED'; });
  const suggestion = repositioning.proposeRepositioning(day, 2);
  assert.equal(day.activities[2].title, 'b');
  assert.equal(suggestion.status, 'CALCULABLE');
  assert.equal(suggestion.suggestedIndex < 2, true);
  const accepted = repositioning.applyRepositioning(day.activities, suggestion.activityIndex, suggestion.suggestedIndex);
  assert.equal(accepted[suggestion.suggestedIndex].title, 'b');
});

test('il riposizionamento dichiara dati insufficienti senza scegliere un ordine', () => {
  const day = { day: 1, date: '2026-09-12', label: 'Giorno 1', rainyAlternative: '—', tiredAlternative: '—', activities: [activity('a', 41.9, 12.5), activity('b', undefined, undefined), activity('c', 41.92, 12.52)] };
  const suggestion = repositioning.proposeRepositioning(day, 1);
  assert.equal(suggestion.status, 'NOT_CALCULABLE');
  assert.equal(suggestion.suggestedIndex, 1);
  assert.match(suggestion.reason, /Riposizionamento non calcolabile/);
  assert.equal(suggestion.missingData.length > 0, true);
});

test('un rifiuto persistito non ripropone automaticamente lo stesso spostamento', () => {
  const day = {
    day: 1, date: '2026-09-12', label: 'Giorno 1', rainyAlternative: '—', tiredAlternative: '—',
    activities: [activity('a', 41.9, 12.5), activity('b', 41.91, 12.51), { ...activity('c', 41.92, 12.52), repositioningDecision: 'KEPT' }],
  };
  day.activities.forEach((item) => { item.place.geoStatus = 'CONFIRMED'; });
  const suggestion = repositioning.proposeRepositioning(day, 2);
  assert.equal(suggestion.status, 'DISMISSED');
  assert.equal(suggestion.suggestedIndex, 2);
});

test('la normalizzazione assegna identità e nodo stabili alle attività locali', () => {
  const normalized = routeModel.normalizeDayRouteModel({
    day: 1,
    date: '2026-09-12',
    label: 'Giorno 1',
    rainyAlternative: '—',
    tiredAlternative: '—',
    activities: [{ time: '10:00', title: 'Museo', detail: 'Test', category: 'Storia' }],
  }, 0);
  const original = normalized.activities[0];
  const renamed = routeModel.normalizeDayRouteModel({
    ...normalized,
    activities: [{ ...original, title: 'Museo aggiornato' }],
  }, 0).activities[0];
  assert.ok(original.id);
  assert.equal(renamed.id, original.id);
  assert.equal(renamed.nodeId, original.nodeId);
});