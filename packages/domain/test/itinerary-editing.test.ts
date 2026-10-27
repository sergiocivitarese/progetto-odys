import assert from 'node:assert/strict';
import test from 'node:test';
import * as domain from '../src/index.ts';

const form = { ...domain.FALLBACK_TRIP_FORM, destination: 'Roma', departure: '2026-10-01', returnDate: '2026-10-03' };
const plan = () => domain.normalizePlan(domain.generateItinerary(form));

test('il piano generato ha una giornata per ogni data e conserva l’originale', () => {
  const itinerary = plan();
  assert.equal(itinerary.days.length, 3);
  assert.equal(itinerary.original?.destination, 'Roma');
});

test('aggiungere, spostare ed eliminare attività non tocca le altre giornate', () => {
  let itinerary = plan();
  const otherDay = JSON.stringify(itinerary.days[2]);
  itinerary = domain.addActivity(itinerary, 1);
  const count = itinerary.days[1].activities.length;
  assert.equal(itinerary.days[1].activities[count - 1].title, 'Nuova attività');
  itinerary = domain.moveActivityWithinDay(itinerary, 1, count - 1, 0);
  assert.equal(itinerary.days[1].activities[0].title, 'Nuova attività');
  itinerary = domain.deleteActivity(itinerary, 1, 0);
  assert.equal(itinerary.days[1].activities.length, count - 1);
  assert.equal(JSON.stringify(itinerary.days[2]), otherDay);
});

test('spostare un’attività in un altro giorno la accoda alla giornata di destinazione', () => {
  const itinerary = plan();
  const moved = itinerary.days[1].activities[0];
  const next = domain.moveActivityToDay(itinerary, 1, 0, 2);
  assert.equal(next.days[2].activities.at(-1)?.title, moved.title);
  assert.equal(next.days[1].activities.length, itinerary.days[1].activities.length - 1);
});

test('il completamento di un’attività è reversibile', () => {
  const itinerary = plan();
  const done = domain.toggleActivityCompletion(itinerary, 2, 0);
  assert.equal(done.days[1].activities[0].status, 'COMPLETED');
  const undone = domain.toggleActivityCompletion(done, 2, 0);
  assert.notEqual(undone.days[1].activities[0].status, 'COMPLETED');
});

test('cambiare la durata richiede conferma e conserva le attività esistenti', () => {
  const itinerary = plan();
  const fields = { ...domain.dateFieldsOf(itinerary), returnDate: '2026-10-04' };
  assert.deepEqual(domain.checkDateChanges(itinerary, fields), { error: null, requiresConfirmation: true });
  const next = domain.applyDateChanges(itinerary, fields);
  assert.equal(next.days.length, 4);
  assert.equal(next.days[1].activities[0].title, itinerary.days[1].activities[0].title);
});

test('date incoerenti vengono rifiutate con un messaggio leggibile', () => {
  const itinerary = plan();
  const result = domain.checkDateChanges(itinerary, { ...domain.dateFieldsOf(itinerary), returnDate: '2026-09-01' });
  assert.match(result.error ?? '', /rientro/);
});

test('il budget confermato calcola il totale per viaggiatori', () => {
  const { plan: next, error } = domain.confirmBudget(plan(), { travelers: '3', budgetPerTraveler: '1.000€' });
  assert.equal(error, null);
  const summary = domain.budgetSummary(next!);
  assert.equal(summary.confirmed, true);
  assert.match(summary.estimatedTotal ?? '', /3000|3\.000/);
});

test('un budget non numerico non viene confermato', () => {
  assert.ok(domain.confirmBudget(plan(), { travelers: '2', budgetPerTraveler: 'flessibile' }).error);
});

test('inserire un alloggio attiva la pianificazione dettagliata delle tratte', () => {
  const itinerary = plan();
  const preview = domain.previewOriginRoutes(itinerary, { name: 'Hotel Centrale' });
  assert.equal(preview.planningMode, 'detailed');
  const confirmed = domain.confirmOriginRoutes(itinerary, preview);
  assert.equal(confirmed.days[1].origin?.label, 'Hotel Centrale');
});

test('ripristina originale riporta la bozza al piano generato', () => {
  const itinerary = plan();
  const edited = domain.deleteActivity(itinerary, 1, 0);
  const restored = domain.restoreOriginal(edited);
  assert.equal(restored.days[1].activities.length, itinerary.days[1].activities.length);
});

test('il modulo di creazione valida destinazione e date', () => {
  const empty = domain.initialTripForm();
  assert.equal(domain.validateTripForm(empty), 'Inserisci una destinazione.');
  assert.equal(domain.validateTripForm({ ...empty, destination: 'Roma', departure: '2026-10-01', returnDate: '2026-10-02' }), null);
});

test('upsert dei viaggi salvati mantiene createdAt e ordina per ultima modifica', () => {
  const first = domain.upsertSavedTrip([], plan(), undefined, 'Roma');
  const second = domain.upsertSavedTrip(first.trips, plan(), first.trip.id, 'Roma rinominata');
  assert.equal(second.trips.length, 1);
  assert.equal(second.trip.createdAt, first.trip.createdAt);
  assert.equal(second.trip.title, 'Roma rinominata');
});
