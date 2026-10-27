import assert from 'node:assert/strict';
import test from 'node:test';

const STORAGE_KEY = 'travel-companion:saved-trips';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFixture() {
  const original = {
    destination: 'Lisbona',
    duration: 1,
    profile: '2 viaggiatori',
    pace: 'equilibrato',
    transport: 'misto',
    estimate: '800€ a persona',
    weatherNote: 'Non è una previsione reale.',
    days: [{
      day: 1,
      date: '12 set',
      label: 'Arrivo',
      activities: [{
        time: '09:30',
        title: 'Mercato del mattino',
        detail: 'Assaggi regionali',
        category: 'Cibo',
        transport: 'a piedi',
        setting: 'outdoor',
        requiresBooking: false,
      }],
      rainyAlternative: 'Museo',
      tiredAlternative: 'Rientro anticipato',
    }],
    nextSteps: ['Controlla gli orari'],
  };
  return { ...clone(original), original: clone(original) };
}

function updateActivity(plan, dayIndex, activityIndex, patch) {
  const next = clone(plan);
  next.days[dayIndex].activities[activityIndex] = {
    ...next.days[dayIndex].activities[activityIndex],
    ...patch,
  };
  return next;
}

function addActivity(plan, dayIndex, activity) {
  const next = clone(plan);
  next.days[dayIndex].activities.push(activity);
  return next;
}

function deleteActivity(plan, dayIndex, activityIndex) {
  const next = clone(plan);
  next.days[dayIndex].activities.splice(activityIndex, 1);
  return next;
}

function restoreOriginal(plan) {
  return { ...clone(plan.original), original: clone(plan.original) };
}

function save(storage, plan) {
  storage.setItem(STORAGE_KEY, JSON.stringify(plan));
}

function load(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

test('aggiunta attività mantiene il piano originale separato', () => {
  const plan = createFixture();
  const next = addActivity(plan, 0, {
    time: '20:00',
    title: 'Cena sul fiume',
    detail: 'Un tavolo tranquillo',
    category: 'Cibo',
    transport: 'auto',
    setting: 'indoor',
    requiresBooking: true,
  });

  assert.equal(next.days[0].activities.length, 2);
  assert.equal(next.days[0].activities[1].title, 'Cena sul fiume');
  assert.equal(plan.days[0].activities.length, 1);
  assert.equal(next.original.days[0].activities.length, 1);
});

test('modifica attività aggiorna testo, trasporto, ambiente e prenotazione', () => {
  const plan = createFixture();
  const next = updateActivity(plan, 0, 0, {
    title: 'Mercato coperto',
    time: '11:00',
    detail: 'Botteghe selezionate',
    transport: 'treno',
    setting: 'indoor',
    requiresBooking: true,
  });

  assert.deepEqual(next.days[0].activities[0], {
    time: '11:00',
    title: 'Mercato coperto',
    detail: 'Botteghe selezionate',
    category: 'Cibo',
    transport: 'treno',
    setting: 'indoor',
    requiresBooking: true,
  });
  assert.equal(plan.days[0].activities[0].title, 'Mercato del mattino');
});

test('eliminazione attività rimuove solo la bozza selezionata', () => {
  const plan = addActivity(createFixture(), 0, {
    time: '18:30',
    title: 'Tramonto',
    detail: 'Vista sulla città',
    category: 'Natura',
    setting: 'outdoor',
    requiresBooking: false,
  });
  const next = deleteActivity(plan, 0, 0);

  assert.equal(next.days[0].activities.length, 1);
  assert.equal(next.days[0].activities[0].title, 'Tramonto');
  assert.equal(plan.days[0].activities[0].title, 'Mercato del mattino');
});

test('annullamento modifiche lascia invariato il viaggio salvato', () => {
  const storage = new Map();
  const browserStorage = {
    setItem: (key, value) => storage.set(key, value),
    getItem: (key) => storage.get(key) ?? null,
  };
  const saved = createFixture();
  save(browserStorage, saved);

  const draft = updateActivity(saved, 0, 0, { title: 'Modifica non salvata' });
  assert.equal(draft.days[0].activities[0].title, 'Modifica non salvata');
  assert.equal(load(browserStorage).days[0].activities[0].title, 'Mercato del mattino');
});

test('salvataggio e refresh ricaricano l’itinerario aggiornato', () => {
  const storage = new Map();
  const firstBrowser = {
    setItem: (key, value) => storage.set(key, value),
    getItem: (key) => storage.get(key) ?? null,
  };
  const saved = updateActivity(createFixture(), 0, 0, { title: 'Museo aggiornato' });
  save(firstBrowser, saved);

  const secondBrowser = {
    getItem: (key) => storage.get(key) ?? null,
  };
  assert.equal(load(secondBrowser).days[0].activities[0].title, 'Museo aggiornato');
});

test('ripristino piano originale elimina le modifiche ma conserva la baseline', () => {
  const modified = updateActivity(createFixture(), 0, 0, {
    title: 'Titolo modificato',
    time: '17:00',
    setting: 'indoor',
    requiresBooking: true,
  });
  const restored = restoreOriginal(modified);

  assert.equal(restored.days[0].activities[0].title, 'Mercato del mattino');
  assert.equal(restored.days[0].activities[0].time, '09:30');
  assert.equal(restored.days[0].activities[0].requiresBooking, false);
  assert.deepEqual(restored.original, modified.original);
});

test('le modifiche restano associate al viaggio corretto dopo il refresh', () => {
  const storage = new Map();
  const trips = [
    { id: 'lisbona-id', title: 'Lisbona', itinerary: createFixture() },
    { id: 'kyoto-id', title: 'Kyoto', itinerary: { ...createFixture(), destination: 'Kyoto' } },
  ];
  trips[1].itinerary = updateActivity(trips[1].itinerary, 0, 0, { title: 'Tempio aggiornato' });
  storage.set(STORAGE_KEY, JSON.stringify(trips));

  const reloaded = load({ getItem: (key) => storage.get(key) ?? null });
  assert.equal(reloaded[0].itinerary.days[0].activities[0].title, 'Mercato del mattino');
  assert.equal(reloaded[1].itinerary.days[0].activities[0].title, 'Tempio aggiornato');
});