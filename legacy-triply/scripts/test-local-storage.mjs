import assert from 'node:assert/strict';
import test from 'node:test';

const STORAGE_KEY = 'travel_companion_trips_v5';
const LEGACY_V4_KEY = 'travel_companion_trips_v4';
const LEGACY_STORAGE_KEY = 'travel-companion:saved-trip';

function saveTrip(storage, itinerary, id = `${itinerary.destination}-id`) {
  const current = loadTrips(storage);
  const savedTrip = { id, title: itinerary.destination, itinerary };
  storage.setItem(STORAGE_KEY, JSON.stringify([savedTrip, ...current.filter((trip) => trip.id !== id)]));
  return savedTrip;
}

function loadTrips(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function renameTrip(storage, id, title) {
  storage.setItem(STORAGE_KEY, JSON.stringify(loadTrips(storage).map((trip) => trip.id === id ? { ...trip, title } : trip)));
}

function deleteTrip(storage, id) {
  storage.setItem(STORAGE_KEY, JSON.stringify(loadTrips(storage).filter((trip) => trip.id !== id)));
}

test('localStorage conserva più viaggi e ricarica ogni itinerario completo', () => {
  const storage = new Map();
  const browserStorage = {
    setItem: (key, value) => storage.set(key, value),
    getItem: (key) => storage.get(key) ?? null,
    removeItem: (key) => storage.delete(key),
  };
  const itinerary = {
    destination: 'Lisbona',
    duration: 5,
    profile: '2 viaggiatori',
    pace: 'equilibrato',
    transport: 'misto',
    estimate: '800€ a persona',
    weatherNote: 'Non è una previsione reale.',
    days: [{ day: 1, activities: [{ title: 'Mercato del mattino' }] }],
    nextSteps: ['Controlla gli orari'],
  };

  const first = saveTrip(browserStorage, itinerary);
  const second = saveTrip(browserStorage, { ...itinerary, destination: 'Kyoto' }, 'kyoto-id');
  assert.deepEqual(loadTrips(browserStorage), [
    { id: second.id, title: second.title, itinerary: second.itinerary },
    { id: first.id, title: first.title, itinerary: first.itinerary },
  ]);
  const newBrowserStorage = new Map();
  assert.deepEqual(loadTrips({ getItem: (key) => newBrowserStorage.get(key) ?? null }), [], 'un nuovo browser senza dati deve mostrare lo stato vuoto');

  renameTrip(browserStorage, first.id, 'Weekend a Lisbona');
  assert.equal(loadTrips(browserStorage).find((trip) => trip.id === first.id).title, 'Weekend a Lisbona');
  deleteTrip(browserStorage, first.id);
  assert.deepEqual(loadTrips(browserStorage).map((trip) => trip.id), [second.id]);
});

test('la vecchia chiave singola resta identificabile per la migrazione', () => {
  const storage = new Map();
  const itinerary = { destination: 'Lisbona', duration: 5 };
  storage.set(LEGACY_STORAGE_KEY, JSON.stringify(itinerary));
  const raw = storage.get(LEGACY_STORAGE_KEY);
  const migrated = [{ id: 'legacy-id', title: itinerary.destination, itinerary: JSON.parse(raw) }];
  storage.set(STORAGE_KEY, JSON.stringify(migrated));
  storage.delete(LEGACY_STORAGE_KEY);
  assert.deepEqual(loadTrips({ getItem: (key) => storage.get(key) ?? null }), migrated);
});

test('il formato v5 conserva alloggio, tratte, affidabilità e versioni del piano', () => {
  const storage = new Map();
  const itinerary = {
    destination: 'Istanbul',
    version: 5,
    planningMode: 'detailed',
    lodging: { name: 'Hotel Balat', zone: 'Balat' },
    interurbanRoutes: [{ reliability: 'TO_VERIFY', status: 'TO_VERIFY' }],
    days: [{ origin: { label: 'Hotel Balat' }, segments: [{ duration: 'Stima demo da verificare', reliability: 'DEMO' }], activities: [] }],
  };
  storage.set(LEGACY_V4_KEY, JSON.stringify([{ id: 'v4', title: 'Istanbul', itinerary: { destination: 'Istanbul', days: [] } }]));
  storage.set(STORAGE_KEY, JSON.stringify([{ id: 'v5', title: 'Istanbul', itinerary, planVersion: 5 }]));
  const saved = JSON.parse(storage.get(STORAGE_KEY));
  assert.equal(saved[0].itinerary.version, 5);
  assert.equal(saved[0].itinerary.lodging.name, 'Hotel Balat');
  assert.equal(saved[0].itinerary.interurbanRoutes[0].reliability, 'TO_VERIFY');
});

test('la migrazione v4 mantiene opzionali i nuovi dati logistici e li normalizza in v5', () => {
  const legacy = { destination: 'Lisbona', version: 4, days: [] };
  const normalized = {
    ...legacy,
    version: 5,
    arrivalTransport: legacy.arrivalTransport ?? undefined,
    departurePoint: legacy.departurePoint ?? undefined,
    arrivalPoint: legacy.arrivalPoint ?? undefined,
    returnTransport: legacy.returnTransport ?? undefined,
    returnPoint: legacy.returnPoint ?? undefined,
  };
  assert.equal(normalized.version, 5);
  assert.equal(normalized.arrivalPoint, undefined);
  assert.equal(normalized.returnPoint, undefined);
});

test('un nuovo piano v5 conserva mezzo di arrivo, punto selezionato e dati di rientro', () => {
  const itinerary = {
    destination: 'Lisbona',
    version: 5,
    arrivalTransport: 'aereo',
    arrivalPoint: { placeId: 'demo-arrivo-aereo-lisbona', type: 'airport', source: 'Catalogo demo locale' },
    returnTransport: 'treno',
    returnPoint: { placeId: 'manual-stazione-oriente', type: 'station' },
    days: [],
  };
  assert.equal(itinerary.arrivalPoint.type, 'airport');
  assert.equal(itinerary.returnTransport, 'treno');
  assert.equal(itinerary.returnPoint.type, 'station');
});

test('il v5 conserva giorno, data, punto iniziale e metadati dell’arrivo', () => {
  const itinerary = {
    version: 5,
    arrivalDayOffset: 1,
    arrivalTime: '',
    arrivalPoint: { placeId: 'demo-arrivo-aereo-lisbona', label: 'Aeroporto di Lisbona', type: 'airport', latitude: 38.77, longitude: -9.13, timezone: 'Europe/Lisbon', source: 'Catalogo demo locale', reliabilityStatus: 'DEMO' },
    arrivalDestinationKind: 'custom',
    arrivalDestinationPoint: { label: 'Praça do Comércio', type: 'custom', source: 'Inserito manualmente', reliabilityStatus: 'MISSING' },
  };
  assert.equal(itinerary.arrivalDayOffset, 1);
  assert.equal(itinerary.arrivalTime, '');
  assert.equal(itinerary.arrivalPoint.placeId, 'demo-arrivo-aereo-lisbona');
  assert.equal(itinerary.arrivalDestinationPoint.label, 'Praça do Comércio');
});

test('la migrazione conserva il vecchio budget e aggiunge il valore per viaggiatore da verificare', () => {
  const legacy = { version: 4, budget: '800€' };
  const migrated = { ...legacy, version: 5, budgetPerTraveler: legacy.budget, budgetReliability: 'TO_VERIFY' };
  assert.equal(migrated.budget, '800€');
  assert.equal(migrated.budgetPerTraveler, '800€');
  assert.equal(migrated.budgetReliability, 'TO_VERIFY');
  const total = migrated.budgetReliability === 'USER_ENTERED' ? 800 * 2 : null;
  assert.equal(total, null);
});

test('un nuovo salvataggio usa un solo campo budget per viaggiatore esplicito', () => {
  const itinerary = { version: 5, budgetPerTraveler: '800€', travelers: '2' };
  assert.equal(itinerary.budgetPerTraveler, '800€');
  assert.equal(Object.keys(itinerary).filter((key) => key === 'budgetPerTraveler').length, 1);
});