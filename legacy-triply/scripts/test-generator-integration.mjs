import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function loadGenerator() {
  const routeModelSource = readFileSync(new URL('../lib/routeModel.ts', import.meta.url), 'utf8');
  const routeModelCompiled = ts.transpileModule(routeModelSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const routeModelModule = { exports: {} };
  new Function('require', 'exports', 'module', routeModelCompiled)(
    (id) => { throw new Error(`Import non previsto: ${id}`); },
    routeModelModule.exports,
    routeModelModule,
  );
  const source = readFileSync(new URL('../lib/generateItinerary.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const placeForActivity = (title, destination, category, setting) => ({
    id: `test-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    title,
    city: destination,
    category,
    setting,
    source: 'Catalogo test locale',
    updatedAt: '2026-08-25',
    geoStatus: 'DEMO',
    whyRecommended: 'Luogo test.',
  });
  new Function('require', 'exports', 'module', compiled)(
    (id) => id === '@/data/places' ? { placeForActivity } : id === '@/lib/routeModel' ? routeModelModule.exports : (() => { throw new Error(`Import non previsto: ${id}`); })(),
    module.exports,
    module,
  );
  return module.exports;
}

const { generateItinerary, mergeItineraryDaysForDateChange, parseBudgetAmount, recalculateRoutes } = loadGenerator();
const arrivalPoint = { id: 'test-airport', label: 'Aeroporto demo', type: 'airport', placeId: 'test-airport', source: 'Catalogo test locale', reliabilityStatus: 'DEMO', geoStatus: 'DEMO' };
const base = {
  destination: 'Lisbona',
  departure: '2026-09-12',
  returnDate: '2026-09-16',
  arrivalTime: '14:00',
  departureTime: '11:00',
  travelers: '2',
  budget: '800€',
  budgetPerTraveler: '800€',
  pace: 'equilibrato',
  interests: ['Cibo', 'Natura'],
  customInterests: [],
  constraints: '',
  transport: 'trasporto pubblico',
  arrivalPoint,
};

test('il parser gestisce migliaia e decimali italiani prima di stimare il totale', () => {
  assert.equal(parseBudgetAmount('1.000€'), 1000);
  assert.equal(parseBudgetAmount('1.000,50€'), 1000.5);
  assert.equal(parseBudgetAmount('1.000€') * 2, 2000);
});

test('la prima tratta verso l’alloggio usa l’alloggio come nodo successivo', () => {
  const plan = generateItinerary({ ...base, lodging: { name: 'Hotel Centro' }, arrivalDestinationKind: 'lodging' });
  assert.equal(plan.days[0].segments[0].origin.label, 'Aeroporto demo');
  assert.equal(plan.days[0].segments[0].destination.label, 'Hotel Centro');
});

test('la prima tratta verso una prima attività ignora arrivo e check-in automatici', () => {
  const plan = generateItinerary({ ...base, lodging: { name: 'Hotel Centro' }, arrivalDestinationKind: 'first-activity' });
  const firstPlannedActivity = plan.days[0].activities.find((activity) => !['Arrivo nella destinazione', 'Check-in o deposito bagagli'].includes(activity.title));
  assert.ok(firstPlannedActivity);
  assert.equal(plan.days[0].segments[0].origin.label, 'Aeroporto demo');
  assert.equal(plan.days[0].segments[0].destination.label, firstPlannedActivity.title);
});

test('la prima attività resta una destinazione concreta anche senza orario di arrivo', () => {
  const plan = generateItinerary({ ...base, arrivalTime: '', lodging: { name: 'Hotel Centro' }, arrivalDestinationKind: 'first-activity' });
  const firstPlannedActivity = plan.days[0].activities.find((activity) => !['Arrivo nella destinazione', 'Check-in o deposito bagagli'].includes(activity.title));
  assert.ok(firstPlannedActivity);
  assert.equal(plan.days[0].segments[0].destination.label, firstPlannedActivity.title);
  assert.equal(firstPlannedActivity.time, 'Orario non inserito');
});

test('la prima tratta verso un punto personalizzato conserva il punto scelto', () => {
  const plan = generateItinerary({
    ...base,
    lodging: { name: 'Hotel Centro' },
    arrivalDestinationKind: 'custom',
    arrivalDestinationPoint: { label: 'Praça do Comércio', type: 'custom', source: 'Inserito manualmente', reliabilityStatus: 'MISSING', geoStatus: 'MISSING' },
  });
  assert.equal(plan.days[0].segments[0].origin.label, 'Aeroporto demo');
  assert.equal(plan.days[0].segments[0].destination.label, 'Praça do Comércio');
});

test('un punto personalizzato mancante resta una tratta esplicitamente da definire', () => {
  const plan = generateItinerary({ ...base, arrivalDestinationKind: 'custom', arrivalDestinationPoint: undefined });
  assert.equal(plan.days[0].segments[0].destination.label, 'Punto personalizzato da definire');
  assert.equal(plan.days[0].segments[0].status, 'MISSING');
});

test('un alloggio non inserito resta una prima tratta esplicitamente da definire', () => {
  const plan = generateItinerary({ ...base, lodging: {}, arrivalDestinationKind: 'lodging' });
  assert.equal(plan.days[0].segments[0].destination.label, 'Alloggio da definire');
  assert.equal(plan.days[0].segments[0].status, 'MISSING');
});

test('un budget confermato aggiorna il profilo con il valore per viaggiatore corrente', () => {
  const plan = generateItinerary({ ...base, budget: '1.000€', budgetPerTraveler: '1.000€', budgetReliability: 'USER_ENTERED' });
  assert.match(plan.profile, /1\.000€/);
  assert.match(plan.estimate, /2(?:\.|)000,00/);
});

test('la modifica delle date conserva attività modificate e sposta le etichette di arrivo', () => {
  const previous = generateItinerary({ ...base, lodging: { name: 'Hotel Centro' }, arrivalDestinationKind: 'first-activity' });
  previous.days[0].activities.find((activity) => activity.title !== 'Arrivo nella destinazione' && activity.title !== 'Check-in o deposito bagagli').detail = 'Nota personale da conservare';
  const regenerated = generateItinerary({ ...base, lodging: { name: 'Hotel Centro' }, arrivalDestinationKind: 'first-activity', arrivalDayOffset: 1 });
  const merged = mergeItineraryDaysForDateChange(previous.days, regenerated.days);
  assert.equal(merged[0].label.includes('Arrivo'), false);
  assert.equal(merged[1].label.includes('Arrivo'), true);
  assert.equal(merged[0].activities.some((activity) => activity.detail === 'Nota personale da conservare'), true);
  assert.equal(merged[1].activities.some((activity) => activity.title === 'Arrivo nella destinazione'), true);
});

test('ogni nodo generato ha un id stabile, metadati locali e coordinate facoltative', () => {
  const withCoordinates = generateItinerary({ ...base, lodging: { name: 'Hotel Centro', latitude: 38.71, longitude: -9.14 }, arrivalDestinationKind: 'lodging' });
  const lodging = withCoordinates.days[0].segments[0].destination;
  assert.equal(lodging.id, 'lodging-hotel-centro');
  assert.equal(lodging.latitude, 38.71);
  assert.equal(lodging.longitude, -9.14);
  assert.equal(typeof lodging.source, 'string');
  const withoutCoordinates = generateItinerary({ ...base, lodging: { name: 'Hotel Centro' }, arrivalDestinationKind: 'lodging' });
  assert.equal(withoutCoordinates.days[0].segments[0].destination.latitude, undefined);
  assert.equal(withoutCoordinates.days[0].segments[0].destination.longitude, undefined);
});

test('ogni tratta collega nodi validi con riferimenti, giorno e ordine coerenti', () => {
  const plan = generateItinerary({ ...base, lodging: { name: 'Hotel Centro' }, arrivalDestinationKind: 'lodging' });
  const segment = plan.days[0].segments[0];
  assert.equal(segment.fromNodeId, segment.origin.id);
  assert.equal(segment.toNodeId, segment.destination.id);
  assert.equal(segment.day, 1);
  assert.equal(segment.order, 0);
  assert.equal(segment.origin.label.length > 0 && segment.destination.label.length > 0, true);
});

test('il ricalcolo dell’alloggio aggiorna solo le tratte locali e conserva l’ordine manuale', () => {
  const plan = generateItinerary({ ...base, stops: ['Porto'], lodging: { name: 'Hotel Prima' }, arrivalDestinationKind: 'lodging' });
  const manualTitles = plan.days[0].activities.map((activity) => activity.title);
  const interurbanBefore = JSON.stringify(plan.interurbanRoutes);
  const updated = recalculateRoutes(plan, { name: 'Hotel Dopo' });
  assert.deepEqual(updated.days[0].activities.map((activity) => activity.title), manualTitles);
  assert.equal(updated.days[0].segments[0].destination.label, 'Hotel Dopo');
  assert.equal(JSON.stringify(updated.interurbanRoutes), interurbanBefore);
});