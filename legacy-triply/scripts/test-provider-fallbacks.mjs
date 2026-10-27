import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function compileModule(relativePath, modules = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', compiled)(
    (id) => modules[id] ?? (() => { throw new Error(`Import non previsto: ${id}`); })(),
    module.exports,
    module,
  );
  return module.exports;
}

const locationServices = compileModule('../lib/locationServices.ts', {
  '@/lib/geocoding': { GeocodingClient: class {} },
});

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
  delete process.env.EXPO_PUBLIC_MAPTILER_KEY;
  assert.equal(locationServices.mapTilerStyleUrl(), null);
});