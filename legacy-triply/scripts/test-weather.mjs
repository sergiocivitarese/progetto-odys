import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function compileModule(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', compiled)(
    () => { throw new Error('Import non previsto'); },
    module.exports,
    module,
  );
  return module.exports;
}

const weather = compileModule('../lib/weather.ts');
const request = { nodeId: 'museo', nodeLabel: 'Museo', latitude: 41.9, longitude: 12.5, localDate: '2026-08-30', timezone: 'Europe/Rome' };

function fakeAdapter(result, calls) {
  return {
    provider: 'Provider test', source: 'Fonte test', license: 'Test', attribution: 'Attribuzione test',
    fetchDaily: async (_request, dataset) => {
      calls.push(dataset);
      return { ...result, dataset, updatedAt: '2026-08-25T09:30:00.000Z' };
    },
  };
}

test('viaggio vicino usa una previsione e quello lontano usa clima storico', () => {
  assert.equal(weather.weatherDatasetForDate('2026-09-03', new Date('2026-09-01T12:00:00')), 'forecast');
  assert.equal(weather.weatherDatasetForDate('2026-09-15', new Date('2026-09-01T12:00:00')), 'historical');
  assert.equal(weather.weatherStatusForDataset('forecast'), 'FORECAST');
  assert.equal(weather.weatherStatusForDataset('historical'), 'HISTORICAL_CLIMATE');
});

test('un viaggio in corso resta nella finestra di previsione', () => {
  assert.equal(weather.weatherDatasetForDate('2026-09-01', new Date('2026-09-01T12:00:00')), 'forecast');
  assert.equal(weather.weatherDatasetForDate('2026-08-31', new Date('2026-09-01T12:00:00')), 'historical');
});

test('il nodo meteo principale preferisce l’alloggio e ignora coordinate mancanti', () => {
  const itinerary = {
    lodging: { name: 'Hotel', latitude: 41.89, longitude: 12.49 },
    days: [{ day: 1, date: '2026-08-30', label: 'G1', rainyAlternative: 'Museo', tiredAlternative: '—', activities: [{ title: 'Passeggiata', category: 'Natura', time: '', detail: '', place: { id: 'p', title: 'Parco', source: 'test', updatedAt: '', geoStatus: 'MISSING', category: 'Natura', whyRecommended: '' } }] }],
  };
  assert.equal(weather.weatherRequestForDay(itinerary, 1).nodeLabel, 'Hotel');
  const withoutCoordinates = { ...itinerary, lodging: {}, days: [{ ...itinerary.days[0], activities: itinerary.days[0].activities }] };
  assert.equal(weather.weatherRequestForDay(withoutCoordinates, 1), null);
});

test('il client deduplica richieste concorrenti per nodo, data e fuso', async () => {
  const calls = [];
  const client = new weather.WeatherClient(fakeAdapter({ temperatureMinC: 18, temperatureMaxC: 25 }, calls));
  const [first, second] = await Promise.all([client.get(request), client.get(request)]);
  assert.equal(calls.length, 1);
  assert.equal(first.id, second.id);
});

test('offline conserva la cache e senza cache dichiara non disponibile', async () => {
  const failing = { provider: 'Test', source: 'Test', license: 'Test', attribution: 'Test', fetchDaily: async () => { throw new Error('offline'); } };
  const client = new weather.WeatherClient(failing);
  const cached = { ...weather.unavailableWeather(request), status: 'FORECAST', temperatureMaxC: 24, updatedAt: '2026-08-25T09:30:00.000Z' };
  const offline = await client.get(request, cached);
  assert.equal(offline.status, 'OFFLINE');
  assert.equal(offline.temperatureMaxC, 24);
  const unavailable = await client.get({ ...request, nodeId: 'senza-cache', localDate: '2026-08-31' });
  assert.equal(unavailable.status, 'UNAVAILABLE');
});

test('gli avvisi sono non distruttivi e propongono un’alternativa', () => {
  const alerts = weather.weatherAlerts({ ...weather.unavailableWeather(request), status: 'FORECAST', precipitationProbability: 70, windKmh: 38, temperatureMaxC: 34 }, 2, 'Museo al coperto');
  assert.equal(alerts.some((alert) => alert.includes('Museo al coperto')), true);
  assert.equal(alerts.some((alert) => alert.includes('Vento forte')), true);
  assert.equal(alerts.some((alert) => alert.includes('Caldo intenso')), true);
});

test('l’adapter Open-Meteo non usa chiavi e conserva condizioni e dati giornalieri', async () => {
  let url = '';
  const adapter = new weather.OpenMeteoAdapter(async (input) => {
    url = String(input);
    return { ok: true, json: async () => ({ daily: { time: ['2026-08-30'], temperature_2m_min: [18], temperature_2m_max: [25], precipitation_sum: [2], precipitation_probability_max: [40], wind_speed_10m_max: [12], weather_code: [61] } }) };
  });
  const result = await adapter.fetchDaily(request, 'forecast');
  assert.equal(url.includes('apikey='), false);
  assert.equal(url.includes('api.open-meteo.com/v1/forecast'), true);
  assert.equal(result.conditionDescription, 'Pioggia debole');
  assert.equal(result.temperatureMaxC, 25);
});