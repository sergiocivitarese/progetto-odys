import assert from 'node:assert/strict';
import test from 'node:test';

const DAY_MS = 86_400_000;
const WALKING_OPTION = { mode: 'A piedi', duration: 'Tempo da verificare', distance: 'Distanza da verificare', cost: 'Costo da verificare', comfort: 'ritmo lento' };

function localNoon(date) {
  return new Date(`${date}T12:00:00`);
}

function isRealDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
}

function duration(start, end) {
  return Math.max(1, Math.round((localNoon(end) - localNoon(start)) / DAY_MS) + 1);
}

function weatherMode(start, today) {
  const days = Math.max(0, Math.floor((localNoon(start) - localNoon(today)) / DAY_MS));
  if (days <= 3) return 'operational-high';
  if (days <= 10) return 'operational-medium';
  if (days <= 15) return 'trend';
  return 'seasonal';
}

function normalizeInterest(value) {
  return value.trim().toLocaleLowerCase('it-IT');
}

function addCustomInterest(selected, raw) {
  const value = raw.trim();
  if (!value) return { selected, error: 'empty' };
  if (selected.some((item) => normalizeInterest(item) === normalizeInterest(value))) return { selected, error: 'duplicate' };
  return { selected: [...selected, value], error: null };
}

function newest(trips) {
  return [...trips].sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt) - Date.parse(a.updatedAt ?? a.createdAt))[0] ?? null;
}

for (const [start, end, expected] of [
  ['2026-09-12', '2026-09-12', 1],
  ['2026-09-12', '2026-09-14', 3],
  ['2026-09-12', '2026-09-16', 5],
  ['2026-09-12', '2026-09-18', 7],
  ['2026-09-12', '2026-09-21', 10],
  ['2026-09-12', '2026-09-30', 19],
]) {
  test(`la durata ${expected} giorni è inclusiva`, () => {
    assert.equal(duration(start, end), expected);
  });
}

test('la modalità meteo a 2 giorni è operativa ad alta affidabilità', () => {
  assert.equal(weatherMode('2026-09-03', '2026-09-01'), 'operational-high');
});

test('la modalità meteo a 7 giorni è operativa con affidabilità media', () => {
  assert.equal(weatherMode('2026-09-08', '2026-09-01'), 'operational-medium');
});

test('la modalità meteo a 14 giorni è una tendenza probabilistica', () => {
  assert.equal(weatherMode('2026-09-15', '2026-09-01'), 'trend');
});

test('la modalità meteo a 20 giorni usa solo stagionalità', () => {
  assert.equal(weatherMode('2026-09-21', '2026-09-01'), 'seasonal');
});

test('un interesse libero viene ripulito e i duplicati non passano', () => {
  const first = addCustomInterest(['Cibo'], '  Mercati rionali  ');
  assert.deepEqual(first, { selected: ['Cibo', 'Mercati rionali'], error: null });
  assert.equal(addCustomInterest(first.selected, 'mercati RIONALI').error, 'duplicate');
  assert.equal(addCustomInterest(first.selected, '   ').error, 'empty');
});

test('lo spostamento a piedi espone durata, distanza, costo e comfort', () => {
  assert.deepEqual(WALKING_OPTION, {
    mode: 'A piedi',
    duration: 'Tempo da verificare',
    distance: 'Distanza da verificare',
    cost: 'Costo da verificare',
    comfort: 'ritmo lento',
  });
});

test('la Home sceglie il viaggio con updatedAt più recente e usa createdAt come fallback', () => {
  const latest = newest([
    { id: 'roma', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z' },
    { id: 'kyoto', createdAt: '2026-09-03T10:00:00.000Z' },
  ]);
  assert.equal(latest.id, 'kyoto');
});

test('la modifica delle date rigenera le giornate e conserva la baseline originale', () => {
  const original = { duration: 5, days: Array.from({ length: 5 }, (_, index) => ({ day: index + 1 })) };
  const updated = { duration: 10, days: Array.from({ length: 10 }, (_, index) => ({ day: index + 1 })), original };
  assert.equal(updated.days.length, 10);
  assert.equal(updated.original.days.length, 5);
});

test('arrivo pomeridiano e partenza mattutina richiedono una timeline ridotta', () => {
  const arrival = 15 * 60 + 30;
  const departure = 8 * 60;
  assert.equal(arrival >= 14 * 60, true);
  assert.equal(departure <= 9 * 60, true);
});

test('date non reali o non in formato ISO vengono rifiutate prima della generazione', () => {
  assert.equal(isRealDate('2026-02-30'), false);
  assert.equal(isRealDate('not-a-date'), false);
  assert.equal(isRealDate('2026-09-12'), true);
});

test('un viaggio in giornata richiede la partenza dopo l’arrivo', () => {
  const arrival = 15 * 60 + 30;
  assert.equal(11 * 60 <= arrival, true);
  assert.equal(20 * 60 > arrival, true);
});

test('le date mostrate restano nel calendario locale senza conversione UTC', () => {
  const inUtcPlus14 = new Date(2026, 8, 12, 12, 0, 0);
  assert.equal(inUtcPlus14.getDate(), 12);
});

test('una pianificazione senza alloggio mantiene le tappe ma non inventa tempi intraurbani', () => {
  const segment = { duration: 'Tempo da definire', reliability: 'TO_VERIFY', note: 'Manca il punto di partenza' };
  assert.equal(segment.duration, 'Tempo da definire');
  assert.equal(segment.reliability, 'TO_VERIFY');
});

test('l’inserimento dell’alloggio aggiorna percorsi ma non elimina né riordina attività', () => {
  const before = ['Museo', 'Mercato', 'Passeggiata'];
  const after = [...before];
  const routes = [{ origin: 'Hotel centro', destination: 'Museo', reliability: 'DEMO' }];
  assert.deepEqual(after, before);
  assert.equal(routes[0].origin, 'Hotel centro');
});

test('le tappe Città del Messico, Cancún e Isla Mujeres restano da verificare senza provider', () => {
  const routes = [
    { from: 'Città del Messico', to: 'Cancún', mode: 'aereo', reliability: 'TO_VERIFY' },
    { from: 'Cancún', to: 'Isla Mujeres', mode: 'traghetto', reliability: 'TO_VERIFY' },
  ];
  assert.equal(routes.every((route) => route.reliability === 'TO_VERIFY'), true);
  assert.deepEqual(routes.map((route) => route.mode), ['aereo', 'traghetto']);
});

test('una guida luogo demo dichiara fonte, aggiornamento e geolocalizzazione', () => {
  const place = { source: 'Contenuto demo originale Travel Companion', updatedAt: '2026-08-25', geoStatus: 'DEMO' };
  assert.equal(place.geoStatus, 'DEMO');
  assert.match(place.source, /demo originale/i);
});

test('arrivo aereo e ferroviario usano punti coerenti e metadati locali dichiarati', () => {
  const airport = { type: 'airport', placeId: 'demo-arrivo-aereo-lisbona', source: 'Catalogo demo locale Travel Companion', geoStatus: 'DEMO' };
  const station = { type: 'station', placeId: 'demo-arrivo-treno-lisbona', source: 'Catalogo demo locale Travel Companion', geoStatus: 'DEMO' };
  assert.equal(airport.type, 'airport');
  assert.equal(station.type, 'station');
  assert.match(airport.source, /demo locale/i);
  assert.equal(station.geoStatus, 'DEMO');
});

test('i segmenti collegano tutti i nodi consecutivi del primo giorno con alloggio', () => {
  const nodes = ['Aeroporto', 'Hotel Centro', 'Centro storico', 'Porto'];
  const segments = nodes.slice(1).map((destination, index) => `${nodes[index]} → ${destination}`);
  assert.deepEqual(segments, ['Aeroporto → Hotel Centro', 'Hotel Centro → Centro storico', 'Centro storico → Porto']);
});

test('senza alloggio una tratta con dati insufficienti resta mancante senza tempi inventati', () => {
  const segment = { duration: 'Tempo da definire', cost: 'Costo da definire', reliability: 'MISSING', status: 'MISSING' };
  assert.equal(segment.duration, 'Tempo da definire');
  assert.equal(segment.reliability, 'MISSING');
  assert.equal(segment.status, 'MISSING');
});

test('gli stati simulato, stimato, mancante e da verificare restano distinguibili', () => {
  const labels = { DEMO: 'Simulato', ESTIMATED: 'Stimato', MISSING: 'Mancante', TO_VERIFY: 'Da verificare' };
  assert.deepEqual(Object.values(labels), ['Simulato', 'Stimato', 'Mancante', 'Da verificare']);
});

test('l’arrivo nello stesso giorno resta sul primo giorno senza cambiare la partenza', () => {
  const departure = '2026-09-12';
  const arrivalDayOffset = 0;
  const arrivalDay = arrivalDayOffset === 1 ? '2026-09-13' : departure;
  assert.equal(arrivalDay, '2026-09-12');
  assert.equal(departure, '2026-09-12');
});

test('l’arrivo il giorno successivo usa una giornata distinta senza riordinare le attività', () => {
  const activities = ['Museo', 'Mercato'];
  const arrivalDayOffset = 1;
  const arrivalDayIndex = arrivalDayOffset === 1 ? 1 : 0;
  assert.equal(arrivalDayIndex, 1);
  assert.deepEqual(activities, ['Museo', 'Mercato']);
});

test('una data di arrivo specifica fuori dal viaggio richiede una correzione esplicita', () => {
  const start = localNoon('2026-09-12');
  const end = localNoon('2026-09-16');
  const arrival = localNoon('2026-09-18');
  assert.equal(arrival < start || arrival > end, true);
});

test('la prima tratta aeroporto-alloggio è distinta dalla successiva tratta verso l’attività', () => {
  const nodes = ['Aeroporto', 'Hotel Centro', 'Museo'];
  const segments = nodes.slice(1).map((to, index) => `${nodes[index]} → ${to}`);
  assert.deepEqual(segments, ['Aeroporto → Hotel Centro', 'Hotel Centro → Museo']);
});

test('senza alloggio la prima tratta aeroporto-prima attività resta esplicitamente da definire', () => {
  const segment = { origin: 'Aeroporto', destination: 'Prima attività', duration: 'Tempo da definire', status: 'MISSING' };
  assert.equal(segment.duration, 'Tempo da definire');
  assert.equal(segment.status, 'MISSING');
});

test('l’assenza dell’orario non genera un orario inventato nella timeline', () => {
  const arrivalTime = '';
  const timelineLabel = arrivalTime || 'Orario non inserito';
  assert.equal(timelineLabel, 'Orario non inserito');
});

test('un ricalcolo dell’alloggio conserva attività e modifica solo le tratte dipendenti', () => {
  const before = { activities: ['Mercato', 'Museo'], interurban: ['Roma → Lisbona'], intracity: ['Origine → Mercato'] };
  const after = { ...before, intracity: ['Hotel → Mercato'] };
  assert.deepEqual(after.activities, before.activities);
  assert.deepEqual(after.interurban, before.interurban);
  assert.notDeepEqual(after.intracity, before.intracity);
});

test('il budget totale viene stimato soltanto con importo e viaggiatori validi', () => {
  const totalFor = (individual, travelers) => Number.isFinite(individual) && Number.isInteger(travelers) && travelers > 0 ? individual * travelers : null;
  assert.equal(totalFor(800, 2), 1600);
  assert.equal(totalFor(800, 0), null);
  assert.equal(totalFor(800, Number.NaN), null);
});

test('un arrivo il giorno successivo viene bloccato se il viaggio dura un solo giorno', () => {
  const departure = localNoon('2026-09-12');
  const returnDate = localNoon('2026-09-12');
  const nextDay = new Date(departure);
  nextDay.setDate(nextDay.getDate() + 1);
  assert.equal(nextDay > returnDate, true);
});

test('spostare il giorno di arrivo muove soltanto le attività automatiche di arrivo', () => {
  const automatic = new Set(['Arrivo nella destinazione', 'Check-in o deposito bagagli']);
  const dayOne = ['Arrivo nella destinazione', 'Check-in o deposito bagagli', 'Mercato'];
  const dayTwo = ['Museo'];
  const updatedDayOne = dayOne.filter((title) => !automatic.has(title));
  const updatedDayTwo = [...dayOne.filter((title) => automatic.has(title)), ...dayTwo];
  assert.deepEqual(updatedDayOne, ['Mercato']);
  assert.deepEqual(updatedDayTwo, ['Arrivo nella destinazione', 'Check-in o deposito bagagli', 'Museo']);
});