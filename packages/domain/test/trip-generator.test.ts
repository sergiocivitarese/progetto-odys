import assert from 'node:assert/strict';
import test from 'node:test';
import { generateTrip, resolveGeneratorDates, surpriseDestination, type GeneratorParams } from '../src/lib/tripGenerator.ts';

const today = new Date('2026-11-13T10:00:00Z');
const params: GeneratorParams = { destination: 'Costiera Amalfitana', dates: { mode: 'flexible', months: [5, 6] }, duration: '3-5', budgetPerPersonCents: 65000, interests: ['Mare', 'Cibo', 'Storia'] };

test('date flessibili: il primo mese scelto ancora da venire, con la durata richiesta (TP-01)', () => {
  assert.deepEqual(resolveGeneratorDates(params, today), { departure: '2027-05-10', returnDate: '2027-05-13' });
  assert.deepEqual(resolveGeneratorDates({ dates: { mode: 'flexible', months: [12] }, duration: 'weekend' }, today), { departure: '2026-12-10', returnDate: '2026-12-12' });
  assert.throws(() => resolveGeneratorDates({ dates: { mode: 'flexible', months: [] }, duration: '7' }, today), /almeno un mese/);
  assert.throws(() => resolveGeneratorDates({ dates: { mode: 'precise', departure: '2027-05-10', returnDate: '2027-05-01' }, duration: '7' }, today), /valide/);
});

test('l’itinerario ha un giorno per data, luoghi e costi stimati confrontabili col budget (TP-02)', () => {
  const trip = generateTrip(params, 0, today);
  assert.equal(trip.title, 'Costiera Amalfitana in 4 giorni');
  assert.equal(trip.days.length, 4);
  assert.deepEqual(trip.days.map((day) => day.date), ['2027-05-10', '2027-05-11', '2027-05-12', '2027-05-13']);
  assert.ok(trip.days.every((day) => day.costCents > 0 && day.places.length > 0));
  assert.equal(trip.totalCents, trip.days.reduce((sum, day) => sum + day.costCents, 0));
  assert.equal(trip.budgetCents, 65000);
  assert.equal(trip.itinerary.days.length, 4);
});

test('«Sorprendimi» sceglie una meta affine; Rigenera cambia il risultato a parità di parametri (TP-01, TP-03)', () => {
  assert.equal(surpriseDestination(['Trekking', 'Natura', 'Avventura']), 'Dolomiti');
  const surprised = generateTrip({ ...params, destination: '', surprise: true }, 0, today);
  assert.equal(surprised.destination, 'Costiera Amalfitana');
  const first = generateTrip(params, 0, today);
  const again = generateTrip(params, 1, today);
  assert.notDeepEqual(first.days.map((day) => day.places), again.days.map((day) => day.places));
});
