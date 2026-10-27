import assert from 'node:assert/strict';
import test from 'node:test';
import * as domain from '../src/index.ts';


const memoryStorage = new Map();
const AsyncStorage = {
  getItem: async (key) => memoryStorage.get(key) ?? null,
  setItem: async (key, value) => { memoryStorage.set(key, value); },
};
const routeModel = domain;
const geocoding = domain;
const weather = domain;

const node = (id, city = 'Lisbona', confidence = 0.95) => ({
  id,
  label: `${id}, ${city}`,
  type: 'activity',
  city,
  country: 'Portogallo',
  latitude: 38.72,
  longitude: -9.14,
  confidence,
  source: 'Test provider',
  updatedAt: '2026-08-25T12:00:00.000Z',
  reliabilityStatus: 'VERIFIED',
  geoStatus: 'CONFIRMED',
});

function adapter(results, available = true) {
  let calls = 0;
  return {
    provider: 'Test provider',
    source: 'Test provider',
    available,
    get calls() { return calls; },
    search: async () => {
      calls += 1;
      return typeof results === 'function' ? results() : results;
    },
  };
}

test('il catalogo locale espone Lisbona come demo dichiarata, non come posizione verificata', async () => {
  const client = new geocoding.GeocodingClient(adapter([]));
  const result = await client.geocode({ query: 'Lisbona', type: 'final' });
  assert.equal(result.status, 'DEMO');
  assert.equal(result.node.geoStatus, 'DEMO');
  assert.match(result.node.source, /catalogo locale demo/i);
  assert.match(result.message, /da verificare/i);
});

test('un risultato nella città attesa viene confermato e riusato dalla cache locale', async () => {
  const provider = adapter([node('museo')]);
  const client = new geocoding.GeocodingClient(provider);
  const first = await client.geocode({ query: 'Museo, Lisbona', city: 'Lisbona', type: 'activity' });
  const second = await client.geocode({ query: 'Museo, Lisbona', city: 'Lisbona', type: 'activity' });
  assert.equal(first.status, 'CONFIRMED');
  assert.equal(second.status, 'CONFIRMED');
  assert.equal(provider.calls, 1);
});

test('un risultato di una città diversa non viene associato al viaggio', async () => {
  const client = new geocoding.GeocodingClient(adapter([node('museo-roma', 'Roma')]));
  const result = await client.geocode({ query: 'Museo', city: 'Lisbona', type: 'activity' });
  assert.equal(result.status, 'CITY_MISMATCH');
  assert.equal(result.node, undefined);
});

test('una città non restituita dal provider non supera il vincolo cittadino', async () => {
  const provider = adapter([Object.fromEntries(Object.entries(node('luogo')).filter(([key]) => key !== 'city'))]);
  const client = new geocoding.GeocodingClient(provider);
  const result = await client.geocode({ query: 'Luogo', city: 'Lisbona', type: 'activity' });
  assert.equal(result.status, 'CITY_MISMATCH');
});

test('risultati vicini per affidabilità richiedono conferma esplicita', async () => {
  const client = new geocoding.GeocodingClient(adapter([node('primo', 'Lisbona', 0.87), node('secondo', 'Lisbona', 0.84)]));
  const result = await client.geocode({ query: 'Piazza', city: 'Lisbona', type: 'activity' });
  assert.equal(result.status, 'AMBIGUOUS');
  assert.equal(result.candidates.every((candidate) => candidate.geoStatus === 'TO_VERIFY'), true);
});

test('un provider non raggiungibile dichiara lo stato offline senza inventare coordinate', async () => {
  const client = new geocoding.GeocodingClient(adapter(() => { throw new Error('offline'); }));
  const result = await client.geocode({ query: 'Quartiere', city: 'Lisbona', type: 'activity' });
  assert.equal(result.status, 'UNAVAILABLE_OFFLINE');
  assert.equal(result.node, undefined);
});

test('un provider non configurato non effettua chiamate e lascia il testo disponibile localmente', async () => {
  const provider = adapter([], false);
  const client = new geocoding.GeocodingClient(provider);
  const result = await client.geocode({ query: 'Quartiere nuovo', city: 'Lisbona', type: 'activity' });
  assert.equal(provider.calls, 0);
  assert.equal(result.status, 'MISSING');
  assert.match(result.message, /non configurato/i);
});

test('il meteo usa solo nodi confermati, non coordinate demo', () => {
  const base = {
    destination: 'Lisbona',
    days: [{ day: 1, date: '2026-08-26', label: 'G1', rainyAlternative: '—', tiredAlternative: '—', activities: [] }],
    lodging: {},
  };
  const demo = { ...base, destinationNode: { ...node('lisbona-demo'), geoStatus: 'DEMO', reliabilityStatus: 'DEMO' } };
  const confirmed = { ...base, destinationNode: node('lisbona-confermata') };
  assert.equal(weather.weatherRequestForDay(demo, 1), null);
  assert.equal(weather.weatherRequestForDay(confirmed, 1).nodeId, 'lisbona-confermata');
});