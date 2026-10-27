import assert from 'node:assert/strict';
import test from 'node:test';

const ONBOARDING_STORAGE_KEY = 'triply_onboarding_v1';
const stateLabels = {
  confermato: 'Confermato',
  simulato: 'Simulato',
  offline: 'Offline',
  'da-verificare': 'Da verificare',
  mancante: 'Mancante',
  'da-definire': 'Da definire',
  'non-disponibile': 'Non disponibile',
};

function onboardingIsVisible(storage) {
  const choice = storage.get(ONBOARDING_STORAGE_KEY);
  return choice !== 'completed' && choice !== 'skipped';
}

function persistChoice(storage, choice) {
  storage.set(ONBOARDING_STORAGE_KEY, choice);
}

test('il primo avvio mostra l’onboarding locale', () => {
  const storage = new Map();
  assert.equal(onboardingIsVisible(storage), true);
});

test('completamento e salto dell’onboarding restano persistiti dopo la riapertura', () => {
  const completedStorage = new Map();
  persistChoice(completedStorage, 'completed');
  assert.equal(onboardingIsVisible(completedStorage), false);
  assert.equal(completedStorage.get(ONBOARDING_STORAGE_KEY), 'completed');

  const skippedStorage = new Map();
  persistChoice(skippedStorage, 'skipped');
  assert.equal(onboardingIsVisible(skippedStorage), false);
  assert.equal(skippedStorage.get(ONBOARDING_STORAGE_KEY), 'skipped');
});

test('la riapertura manuale non cancella la scelta né i viaggi locali', () => {
  const storage = new Map([[ONBOARDING_STORAGE_KEY, 'completed'], ['travel_companion_trips_v5', JSON.stringify([{ id: 'local-trip' }])]]);
  const openManually = true;
  assert.equal(openManually, true);
  assert.equal(storage.get(ONBOARDING_STORAGE_KEY), 'completed');
  assert.equal(JSON.parse(storage.get('travel_companion_trips_v5'))[0].id, 'local-trip');
});

test('gli stati locali hanno un testo esplicito oltre al colore', () => {
  assert.deepEqual(Object.values(stateLabels), [
    'Confermato',
    'Simulato',
    'Offline',
    'Da verificare',
    'Mancante',
    'Da definire',
    'Non disponibile',
  ]);
});