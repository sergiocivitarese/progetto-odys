import assert from 'node:assert/strict';
import test from 'node:test';
import * as domain from '../src/index.ts';


const locationServices = domain;

const node = (id) => ({
  id,
  label: id,
  type: 'activity',
  latitude: 41.9,
  longitude: 12.5,
});

test('senza chiave GraphHopper il routing non effettua richieste e mantiene il fallback locale', async () => {
  delete process.env.EXPO_PUBLIC_GRAPHHOPPER_KEY;
  let calls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls += 1; throw new Error('fetch non previsto'); };
  try {
    const result = await locationServices.calculateGraphHopperRoute(node('origine'), node('destinazione'), 'a piedi');
    assert.equal(result, null);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('senza chiave MapTiler il provider cartografico online resta disattivato', () => {
  // In Odys la chiave vive sul backend: il dominio riceve solo il flag di disponibilità.
  locationServices.configureDomain({ mapProviderAvailable: false });
  const snapshot = locationServices.deriveMapSnapshot({ destination: 'Roma', days: [], duration: 1, profile: '', pace: 'equilibrato', transport: 'a piedi', estimate: '', weatherMode: 'seasonal', weatherNote: '', nextSteps: [] });
  assert.equal(snapshot.provider, 'Locale');
});