import assert from 'node:assert/strict';
import test from 'node:test';
import { affinity, sharesInterest } from '../src/lib/affinity.ts';

test('l’affinità è la quota degli interessi del viaggio condivisi dall’utente (TB-04)', () => {
  const result = affinity(['rovine', 'Mare', 'Cibo'], ['Rovine', 'Mare', 'Avventura', 'Città']);
  assert.equal(result?.percent, 50);
  assert.deepEqual(result?.shared, ['Rovine', 'Mare']);
  assert.equal(result?.explanation, 'Rovine e mare: i tuoi interessi');
  assert.equal(affinity(['Città'], ['citta'])?.percent, 100, 'accenti e maiuscole non contano');
  assert.equal(affinity(['Mare'], ['Trekking'])?.percent, 0);
});

test('senza interessi dell’utente o del viaggio non c’è alcun badge', () => {
  assert.equal(affinity([], ['Mare']), null);
  assert.equal(affinity(['Mare'], []), null);
  assert.ok(sharesInterest(['Mare', 'Cibo'], ['cibo']));
  assert.ok(!sharesInterest(['Mare'], ['Arte']));
});
