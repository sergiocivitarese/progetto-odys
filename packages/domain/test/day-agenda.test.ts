import assert from 'node:assert/strict';
import test from 'node:test';
import { dayAgenda, formatMinutes, suggestTransfer, type Itinerary } from '../src/index.ts';

const place = (title: string, latitude: number, longitude: number) => ({ id: title, title, latitude, longitude, geoStatus: 'CONFIRMED' as const });
const activity = (time: string, title: string, coords?: [number, number], duration?: string) => ({
  time, title, detail: `${title}: dettaglio`, category: 'Storia', duration,
  place: coords ? place(title, coords[0], coords[1]) : undefined,
});

const plan = {
  destination: 'Roma', departure: '2027-04-10', returnDate: '2027-04-10', transport: 'trasporto pubblico',
  days: [{
    day: 1, date: '2027-04-10', label: 'Roma antica', rainyAlternative: '', tiredAlternative: '',
    activities: [
      activity('09:00', 'Colosseo', [41.8902, 12.4922], '2 h'),
      activity('11:30', 'Fori Imperiali', [41.8925, 12.4853]),
      activity('Orario non inserito', 'Pranzo libero'),
      activity('15:00', 'Pantheon', [41.8986, 12.4769]),
      activity('17:00', 'Gianicolo', [41.8916, 12.4613]),
    ],
  }],
} as unknown as Itinerary;

test('il giorno per ore: orari, durate scritte o fino all’attività successiva, tappe numerate (TP-05)', () => {
  const agenda = dayAgenda(plan, 1)!;
  const activities = agenda.entries.filter((entry) => entry.kind === 'activity');
  assert.deepEqual(activities.map((entry) => [entry.time, entry.endTime, entry.durationLabel, entry.stop]), [
    ['09:00', '11:00', '2 h', 1],
    ['11:30', undefined, undefined, 2], // l'attività dopo non ha un orario valido
    [undefined, undefined, undefined, undefined],
    ['15:00', undefined, '2 h', 3],
    ['17:00', undefined, undefined, 4],
  ]);
  assert.deepEqual(agenda.stops.map((stop) => stop.title), ['Colosseo', 'Fori Imperiali', 'Pantheon', 'Gianicolo']);
  assert.equal(agenda.path.length, 4);
  assert.equal(dayAgenda(plan, 9), null);
});

test('tra due tappe senza tratta si suggerisce uno spostamento con mezzo e durata (TP-07)', () => {
  const transfers = dayAgenda(plan, 1)!.entries.filter((entry) => entry.kind === 'transfer');
  assert.equal(transfers.length, 3);
  assert.deepEqual(transfers.map((entry) => [entry.from, entry.to, entry.mode, entry.suggested, entry.estimated]), [
    ['Colosseo', 'Fori Imperiali', 'a piedi', true, true],
    ['Fori Imperiali', 'Pantheon', 'a piedi', true, true],
    ['Pantheon', 'Gianicolo', 'autobus', true, true],
  ]);
  assert.match(transfers[0].durationLabel!, /min$/);
});

test('mezzi suggeriti e durate leggibili', () => {
  assert.equal(suggestTransfer(0.8, 'trasporto pubblico').mode, 'a piedi');
  assert.equal(suggestTransfer(12, 'auto').mode, 'auto');
  assert.equal(suggestTransfer(12, 'traghetto').mode, 'traghetto');
  assert.equal(suggestTransfer(12, 'trasporto pubblico').mode, 'autobus');
  assert.deepEqual([formatMinutes(45), formatMinutes(90), formatMinutes(120)], ['45 min', '1 h 30 min', '2 h']);
});

test('tratte senza misure: niente segnaposto; giorno senza tappe localizzate: punto di riferimento', () => {
  const segment = { id: 's', day: 1, order: 0, fromNodeId: 'a', toNodeId: 'b', origin: { id: 'a', label: 'A', type: 'custom', geoStatus: 'MISSING' }, destination: { id: 'b', label: 'B', type: 'custom', geoStatus: 'MISSING' },
    type: 'intracity', recommendedMode: 'a piedi', alternatives: [], duration: 'Tempo da definire', distance: 'Distanza da definire', cost: '', changes: '', comfort: '', weatherImpact: '', reliability: 'MISSING', status: 'MISSING', note: '' };
  const generic = { ...plan, destinationNode: { id: 'roma', label: 'Roma, Italia', type: 'final', latitude: 41.9, longitude: 12.5, geoStatus: 'CONFIRMED' },
    days: [{ ...plan.days[0], activities: [activity('10:00', 'Museo'), activity('12:00', 'Pranzo')], segments: [segment] }] } as unknown as Itinerary;
  const agenda = dayAgenda(generic, 1)!;
  const transfer = agenda.entries.find((entry) => entry.kind === 'transfer');
  assert.deepEqual([transfer?.durationLabel, transfer?.distanceLabel], [undefined, undefined]);
  assert.deepEqual(agenda.anchor, { label: 'Roma, Italia', latitude: 41.9, longitude: 12.5 });
  assert.equal(dayAgenda(plan, 1)!.anchor, undefined, 'con tappe localizzate non serve');
});
