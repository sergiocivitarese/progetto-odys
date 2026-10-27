import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadTransfer() {
  const source = readFileSync(new URL('../lib/tripTransfer.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', compiled)(
    (id) => { throw new Error(`Import non previsto: ${id}`); },
    module.exports,
    module,
  );
  return module.exports;
}

const { serializeTripExport, parseTripExport } = loadTransfer();
const savedTrip = {
  id: 'roma-2026',
  title: 'Weekend a Roma',
  itinerary: { destination: 'Roma', version: 5, days: [] },
  createdAt: '2026-08-25T08:00:00.000Z',
  updatedAt: '2026-08-25T08:00:00.000Z',
  planVersion: 5,
};

test('un export JSON v5 valido conserva un viaggio locale leggibile', () => {
  const raw = serializeTripExport(savedTrip, '2026-08-25T10:00:00.000Z');
  const result = parseTripExport(raw);
  assert.equal(result.error, null);
  assert.deepEqual(result.trip, savedTrip);
});

test('un JSON corrotto viene rifiutato con un messaggio leggibile', () => {
  const result = parseTripExport('{"format":');
  assert.equal(result.trip, null);
  assert.match(result.error, /corrotto|non valido/i);
});

test('un formato o una versione incompatibile non può sovrascrivere un viaggio locale', () => {
  const result = parseTripExport(JSON.stringify({ format: 'altro-formato', version: 4, trip: savedTrip }));
  assert.equal(result.trip, null);
  assert.match(result.error, /formato non supportato/i);
});

test('un export v5 conserva metadati completi di attività, nodi, cache meteo e mappa', () => {
  const richTrip = {
    ...savedTrip,
    itinerary: {
      ...savedTrip.itinerary,
      weatherNote: 'Cache locale da aggiornare.',
      days: [{
        day: 1,
        date: '2026-09-12',
        label: 'Giorno 1',
        rainyAlternative: 'Da definire',
        tiredAlternative: 'Da definire',
        activities: [{
          id: 'activity-1',
          dayId: 'day-2026-09-12',
          order: 0,
          time: '10:00',
          title: 'Museo',
          detail: 'Visita',
          category: 'Storia',
          duration: '90 min',
          notes: 'Prenotare',
          nodeId: 'node-museo',
          status: 'TO_VERIFY',
          updatedAt: '2026-08-25T10:00:00.000Z',
          place: {
            id: 'place-museo',
            title: 'Museo',
            source: 'Inserito localmente',
            updatedAt: '2026-08-25T10:00:00.000Z',
            geoStatus: 'TO_VERIFY',
            category: 'Storia',
            whyRecommended: 'Test integrità',
          },
        }],
      }],
      weather: [{
        id: 'weather-1',
        nodeId: 'node-museo',
        nodeLabel: 'Museo',
        latitude: 41.9,
        longitude: 12.5,
        localDate: '2026-09-12',
        timezone: 'Europe/Rome',
        status: 'OFFLINE',
        dataset: 'forecast',
        provider: 'Open-Meteo',
        source: 'Open-Meteo Free API',
      }],
      mapSnapshot: { version: 1, signature: 'sig', provider: 'Locale', markers: [], routeLinks: [], offline: { status: 'NOT_DOWNLOADED', areas: [], note: 'Locale' } },
    },
  };
  const result = parseTripExport(serializeTripExport(richTrip));
  assert.equal(result.error, null);
  assert.deepEqual(result.trip, richTrip);
});

test('un export con attività duplicate o cache meteo corrotta viene rifiutato in profondità', () => {
  const duplicate = {
    ...savedTrip,
    itinerary: {
      ...savedTrip.itinerary,
      days: [{
        day: 1,
        date: '2026-09-12',
        label: 'Giorno 1',
        rainyAlternative: 'Da definire',
        tiredAlternative: 'Da definire',
        activities: [
          { id: 'same', time: '09:00', title: 'A', detail: '', category: 'Storia' },
          { id: 'same', time: '10:00', title: 'B', detail: '', category: 'Storia' },
        ],
      }],
    },
  };
  const invalidWeather = {
    ...savedTrip,
    itinerary: {
      ...savedTrip.itinerary,
      weather: [{ nodeId: 'weather-without-coordinates' }],
    },
  };
  assert.match(parseTripExport(serializeTripExport(duplicate)).error, /duplica.*attività/i);
  assert.match(parseTripExport(serializeTripExport(invalidWeather)).error, /dato meteo non valido/i);
  assert.equal(parseTripExport(JSON.stringify({ format: 'travel-companion-trip', version: 5, trip: { ...savedTrip, itinerary: { destination: 'Roma' } } })).trip, null);
});

test('un’attività senza campi obbligatori non raggiunge la migrazione locale', () => {
  const malformed = {
    ...savedTrip,
    itinerary: {
      ...savedTrip.itinerary,
      days: [{ day: 1, date: '2026-09-12', label: 'Giorno 1', rainyAlternative: 'Da definire', tiredAlternative: 'Da definire', activities: [{}] }],
    },
  };
  const result = parseTripExport(serializeTripExport(malformed));
  assert.equal(result.trip, null);
  assert.match(result.error, /campi attività obbligatori/i);
});

test('campi testuali usati dalla migrazione rifiutano tipi corrotti e i nodi parziali restano validi', () => {
  const corruptBudget = {
    ...savedTrip,
    itinerary: { ...savedTrip.itinerary, budget: 1 },
  };
  const partialNode = {
    ...savedTrip,
    itinerary: {
      ...savedTrip.itinerary,
      days: [{
        day: 1,
        date: '2026-09-12',
        label: 'Giorno 1',
        rainyAlternative: 'Da definire',
        tiredAlternative: 'Da definire',
        origin: { id: 'origin-partial', label: 'Origine manuale', type: 'custom', geoStatus: 'MISSING' },
        activities: [],
      }],
    },
  };
  assert.match(parseTripExport(serializeTripExport(corruptBudget)).error, /itinerario non ha una struttura valida/i);
  assert.equal(parseTripExport(serializeTripExport(partialNode)).error, null);
});

test('uno snapshot mappa annidato corrotto o con riferimenti nodo inesistenti viene rifiutato', () => {
  const malformedMap = {
    ...savedTrip,
    itinerary: {
      ...savedTrip.itinerary,
      mapSnapshot: {
        version: 1,
        signature: 'bad-map',
        provider: 'Locale',
        markers: [],
        routeLinks: [{ id: 'link-incompleto' }],
        offline: { status: 'NOT_DOWNLOADED', areas: [], note: 'Locale' },
      },
    },
  };
  const unknownMarker = {
    ...savedTrip,
    itinerary: {
      ...savedTrip.itinerary,
      mapSnapshot: {
        version: 1,
        signature: 'missing-node',
        provider: 'Locale',
        markers: [{ id: 'marker-ghost', nodeId: 'ghost-node', label: 'Fantasma', type: 'activity', latitude: 41.9, longitude: 12.5, source: 'Test', reliabilityStatus: 'MISSING' }],
        routeLinks: [],
        offline: { status: 'NOT_DOWNLOADED', areas: [], note: 'Locale' },
      },
    },
  };
  assert.match(parseTripExport(serializeTripExport(malformedMap)).error, /collegamento.*non valido/i);
  assert.match(parseTripExport(serializeTripExport(unknownMarker)).error, /marker.*senza nodo/i);
});

test('un nodeId riusato con dati diversi viene rifiutato prima del salvataggio', () => {
  const conflictingNodes = {
    ...savedTrip,
    itinerary: {
      ...savedTrip.itinerary,
      days: [{
        day: 1,
        date: '2026-09-12',
        label: 'Giorno 1',
        rainyAlternative: 'Da definire',
        tiredAlternative: 'Da definire',
        origin: { id: 'shared-node', label: 'Origine', type: 'custom', geoStatus: 'MISSING', source: 'Inserito localmente' },
        activities: [{
          id: 'activity-shared-node',
          dayId: 'day-2026-09-12',
          order: 0,
          time: '10:00',
          title: 'Attività diversa',
          detail: '',
          category: 'Storia',
          nodeId: 'shared-node',
          place: { id: 'place-shared-node', title: 'Attività diversa', source: 'Inserito localmente', updatedAt: '2026-08-25T10:00:00.000Z', geoStatus: 'MISSING', category: 'Storia', whyRecommended: 'Test' },
        }],
      }],
    },
  };
  const result = parseTripExport(serializeTripExport(conflictingNodes));
  assert.equal(result.trip, null);
  assert.match(result.error, /identificativo nodo.*incoerenti/i);
});