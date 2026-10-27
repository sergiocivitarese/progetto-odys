import type { DayPlan, Itinerary, LocationNode, WeatherDataset, WeatherSnapshot, WeatherStatus } from '@/types/travel';

export const OPEN_METEO_PROVIDER = 'Open-Meteo';
export const OPEN_METEO_SOURCE = 'Open-Meteo Free API';
export const OPEN_METEO_LICENSE = 'CC BY 4.0';
export const OPEN_METEO_ATTRIBUTION = 'Weather data by Open-Meteo.com, using open data from national weather services';
export const OPEN_METEO_LIMITS = 'Prototipo non commerciale · meno di 10.000 chiamate/giorno, 5.000/ora e 600/minuto';
export const FORECAST_WINDOW_DAYS = 10;

export interface WeatherRequest {
  nodeId: string;
  nodeLabel: string;
  latitude: number;
  longitude: number;
  localDate: string;
  timezone: string;
}

export interface WeatherProviderResult {
  dataset: WeatherDataset;
  temperatureMinC?: number;
  temperatureMaxC?: number;
  precipitationMm?: number;
  precipitationProbability?: number;
  windKmh?: number;
  conditionCode?: number;
  conditionDescription?: string;
  updatedAt: string;
  note?: string;
}

export interface WeatherProviderAdapter {
  readonly provider: string;
  readonly source: string;
  readonly license: string;
  readonly attribution: string;
  fetchDaily(request: WeatherRequest, dataset: WeatherDataset): Promise<WeatherProviderResult>;
}

type WeatherProviderMetadata = Pick<WeatherProviderAdapter, 'provider' | 'source' | 'license' | 'attribution'>;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const WEATHER_DESCRIPTIONS: Record<number, string> = {
  0: 'Sereno', 1: 'Prevalentemente sereno', 2: 'Parzialmente nuvoloso', 3: 'Coperto',
  45: 'Nebbia', 48: 'Nebbia con brina', 51: 'Pioviggine debole', 53: 'Pioviggine moderata',
  55: 'Pioviggine intensa', 61: 'Pioggia debole', 63: 'Pioggia moderata', 65: 'Pioggia intensa',
  71: 'Neve debole', 73: 'Neve moderata', 75: 'Neve intensa', 80: 'Rovesci deboli',
  81: 'Rovesci moderati', 82: 'Rovesci intensi', 95: 'Temporale', 96: 'Temporale con grandine',
  99: 'Temporale con grandine intensa',
};

function numberAt(value: unknown, index: number): number | undefined {
  const number = Array.isArray(value) ? Number(value[index]) : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function average(values: unknown): number | undefined {
  if (!Array.isArray(values)) return undefined;
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : undefined;
}

function rangeFromArchive(values: unknown): [number | undefined, number | undefined] {
  if (!Array.isArray(values)) return [undefined, undefined];
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length ? [Math.min(...numbers), Math.max(...numbers)] : [undefined, undefined];
}

function validResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`Weather provider returned ${response.status}`);
  return response.json();
}

function dateYearsAgo(date: string, years: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${String(year - years).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export class OpenMeteoAdapter implements WeatherProviderAdapter {
  readonly provider = OPEN_METEO_PROVIDER;
  readonly source = OPEN_METEO_SOURCE;
  readonly license = OPEN_METEO_LICENSE;
  readonly attribution = OPEN_METEO_ATTRIBUTION;
  private readonly fetcher: FetchLike;

  constructor(fetcher: FetchLike = fetch) {
    this.fetcher = fetcher;
  }

  async fetchDaily(request: WeatherRequest, dataset: WeatherDataset): Promise<WeatherProviderResult> {
    const params = new URLSearchParams({
      latitude: String(request.latitude),
      longitude: String(request.longitude),
      timezone: request.timezone || 'auto',
      daily: 'temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,weather_code',
      ...(dataset === 'forecast'
        ? { start_date: request.localDate, end_date: request.localDate }
        : { start_date: dateYearsAgo(request.localDate, 5), end_date: dateYearsAgo(request.localDate, 1) }),
    });
    const endpoint = dataset === 'forecast' ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
    const payload = await validResponse(await this.fetcher(`${endpoint}?${params.toString()}`)) as {
      daily?: Record<string, unknown>;
      generationtime_ms?: number;
    };
    const daily = payload.daily ?? {};
    const index = dataset === 'forecast' && Array.isArray(daily.time) ? Math.max(0, daily.time.indexOf(request.localDate)) : 0;
    const temperatureMin = dataset === 'forecast' ? numberAt(daily.temperature_2m_min, index) : rangeFromArchive(daily.temperature_2m_min)[0];
    const temperatureMax = dataset === 'forecast' ? numberAt(daily.temperature_2m_max, index) : rangeFromArchive(daily.temperature_2m_max)[1];
    const code = dataset === 'forecast' ? numberAt(daily.weather_code, index) : numberAt(daily.weather_code, 0);
    return {
      dataset,
      temperatureMinC: temperatureMin,
      temperatureMaxC: temperatureMax,
      precipitationMm: dataset === 'forecast' ? numberAt(daily.precipitation_sum, index) : average(daily.precipitation_sum),
      precipitationProbability: dataset === 'forecast' ? numberAt(daily.precipitation_probability_max, index) : undefined,
      windKmh: dataset === 'forecast' ? numberAt(daily.wind_speed_10m_max, index) : average(daily.wind_speed_10m_max),
      conditionCode: code,
      conditionDescription: code === undefined ? undefined : WEATHER_DESCRIPTIONS[Math.round(code)] ?? 'Condizioni variabili',
      updatedAt: new Date().toISOString(),
      note: dataset === 'historical' ? 'Valori medi e intervalli storici: non rappresentano il meteo effettivo del giorno specifico.' : 'Previsione indicativa, non garantita.',
    };
  }
}

export function weatherDatasetForDate(localDate: string, today = new Date()): WeatherDataset {
  const current = new Date(today);
  current.setHours(12, 0, 0, 0);
  const target = new Date(`${localDate}T12:00:00`);
  const daysUntil = Number.isNaN(target.getTime()) ? FORECAST_WINDOW_DAYS + 1 : Math.floor((target.getTime() - current.getTime()) / 86400000);
  return daysUntil >= 0 && daysUntil <= FORECAST_WINDOW_DAYS ? 'forecast' : 'historical';
}

export function weatherStatusForDataset(dataset: WeatherDataset): WeatherStatus {
  return dataset === 'forecast' ? 'FORECAST' : 'HISTORICAL_CLIMATE';
}

export function weatherStatusLabel(status: WeatherStatus): string {
  return ({
    FORECAST: 'Previsione',
    HISTORICAL_CLIMATE: 'Clima storico',
    UPDATE_NEEDED: 'Aggiornamento necessario',
    TO_VERIFY: 'Da verificare',
    OFFLINE: 'Offline',
    UNAVAILABLE: 'Non disponibile',
  })[status];
}

export function hasWeatherCoordinates(node: Pick<LocationNode, 'latitude' | 'longitude'> | undefined): node is Pick<LocationNode, 'latitude' | 'longitude'> {
  return Boolean(node && Number.isFinite(node.latitude) && Number.isFinite(node.longitude));
}

function hasApprovedWeatherCoordinates(node: Pick<LocationNode, 'latitude' | 'longitude' | 'geoStatus'> | undefined): node is Pick<LocationNode, 'latitude' | 'longitude' | 'geoStatus'> {
  return Boolean(node && hasWeatherCoordinates(node) && node.geoStatus === 'CONFIRMED');
}

function activityNode(day: DayPlan): LocationNode | undefined {
  const activity = day.activities.find((item) => hasWeatherCoordinates(item.place));
  if (!activity?.place || !hasWeatherCoordinates(activity.place)) return undefined;
  return {
    id: `weather-${activity.place.id}`,
    label: activity.place.title,
    type: 'activity',
    latitude: activity.place.latitude,
    longitude: activity.place.longitude,
    city: activity.place.city,
    address: activity.place.address,
    timezone: activity.place.timezone,
    source: activity.place.source,
    geoStatus: activity.place.geoStatus,
  };
}

export function primaryWeatherNode(itinerary: Itinerary, day: DayPlan): LocationNode | undefined {
  if (hasApprovedWeatherCoordinates(day.origin) && day.origin.type === 'accommodation') return day.origin;
  if (hasWeatherCoordinates(itinerary.lodging) && itinerary.lodging?.name) {
    const lodgingNode: LocationNode = {
      id: `weather-lodging-${itinerary.lodging.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}`,
      label: itinerary.lodging.name,
      type: 'accommodation',
      latitude: itinerary.lodging.latitude,
      longitude: itinerary.lodging.longitude,
      address: itinerary.lodging.address,
      zone: itinerary.lodging.zone,
      source: itinerary.lodging.source ?? 'Inserito localmente',
      geoStatus: itinerary.lodging.geoStatus ?? 'CONFIRMED',
    };
    if (hasApprovedWeatherCoordinates(lodgingNode)) return lodgingNode;
  }
  const activity = activityNode(day);
  if (hasApprovedWeatherCoordinates(activity)) return activity;
  return hasApprovedWeatherCoordinates(itinerary.destinationNode) ? itinerary.destinationNode : undefined;
}

export function weatherRequestForDay(itinerary: Itinerary, dayNumber: number): WeatherRequest | null {
  const day = itinerary.days.find((item) => item.day === dayNumber);
  const node = day ? primaryWeatherNode(itinerary, day) : undefined;
  if (!day || !node || !hasWeatherCoordinates(node)) return null;
  return {
    nodeId: node.id,
    nodeLabel: node.label,
    latitude: node.latitude as number,
    longitude: node.longitude as number,
    localDate: day.date,
    timezone: node.timezone ?? 'auto',
  };
}

export function weatherKey(request: Pick<WeatherRequest, 'nodeId' | 'localDate' | 'timezone'>): string {
  return `${request.nodeId}|${request.localDate}|${request.timezone}`;
}

export function weatherId(request: WeatherRequest): string {
  return `weather-${weatherKey(request).replace(/[^a-zA-Z0-9|-]/g, '-')}`;
}

export function unavailableWeather(request: WeatherRequest, status: WeatherStatus = 'UNAVAILABLE', note?: string, metadata: WeatherProviderMetadata = {
  provider: OPEN_METEO_PROVIDER,
  source: OPEN_METEO_SOURCE,
  license: OPEN_METEO_LICENSE,
  attribution: OPEN_METEO_ATTRIBUTION,
}): WeatherSnapshot {
  return {
    id: weatherId(request),
    nodeId: request.nodeId,
    nodeLabel: request.nodeLabel,
    latitude: request.latitude,
    longitude: request.longitude,
    localDate: request.localDate,
    timezone: request.timezone,
    status,
    dataset: weatherDatasetForDate(request.localDate),
    provider: metadata.provider,
    source: metadata.source,
    license: metadata.license,
    attribution: metadata.attribution,
    note,
  };
}

export function normalizeWeatherRecords(records: WeatherSnapshot[] | undefined): WeatherSnapshot[] {
  if (!Array.isArray(records)) return [];
  return records.filter((record) => record && typeof record.nodeId === 'string' && Number.isFinite(record.latitude) && Number.isFinite(record.longitude) && typeof record.localDate === 'string')
    .map((record) => ({ ...record, id: record.id || weatherId(record) }));
}

function weatherFromResult(request: WeatherRequest, result: WeatherProviderResult, metadata: WeatherProviderMetadata): WeatherSnapshot {
  return {
    ...unavailableWeather(request, weatherStatusForDataset(result.dataset), undefined, metadata),
    ...result,
    id: weatherId(request),
    nodeId: request.nodeId,
    nodeLabel: request.nodeLabel,
    latitude: request.latitude,
    longitude: request.longitude,
    localDate: request.localDate,
    timezone: request.timezone,
    provider: metadata.provider,
    source: metadata.source,
    license: metadata.license,
    attribution: metadata.attribution,
    lastSuccessfulAt: result.updatedAt,
  };
}

export class WeatherClient {
  private readonly inFlight = new Map<string, Promise<WeatherSnapshot>>();
  constructor(private readonly adapter: WeatherProviderAdapter = new OpenMeteoAdapter()) {}

  get(request: WeatherRequest, cached?: WeatherSnapshot): Promise<WeatherSnapshot> {
    const dataset = weatherDatasetForDate(request.localDate);
    const key = `${weatherKey(request)}|${dataset}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise: Promise<WeatherSnapshot> = this.adapter.fetchDaily(request, dataset)
      .then((result) => weatherFromResult(request, result, this.adapter))
      .catch((): WeatherSnapshot => cached
        ? { ...cached, status: 'OFFLINE' as const, note: 'Ultimo meteo salvato localmente: la rete non è disponibile.' }
        : unavailableWeather(request, 'UNAVAILABLE', 'Meteo non disponibile offline', this.adapter));
    this.inFlight.set(key, promise);
    void promise.finally(() => this.inFlight.delete(key));
    return promise;
  }
}

export function weatherAlerts(record: WeatherSnapshot | undefined, outdoorActivityCount: number, rainyAlternative?: string): string[] {
  if (!record) return [];
  const alerts: string[] = [];
  if ((record.precipitationProbability ?? 0) >= 55 || (record.precipitationMm ?? 0) >= 8) alerts.push(`Pioggia probabile: ${rainyAlternative || 'valuta un’attività al coperto'}.`);
  if ((record.windKmh ?? 0) >= 35) alerts.push('Vento forte: verifica le attività esposte e valuta un’alternativa più riparata.');
  if ((record.temperatureMaxC ?? 0) >= 33) alerts.push('Caldo intenso: prevedi pause, acqua e orari più freschi.');
  if (outdoorActivityCount > 0 && ((record.precipitationProbability ?? 0) >= 45 || (record.windKmh ?? 0) >= 30)) alerts.push('Condizioni non ideali per attività all’aperto: la decisione resta all’utente.');
  return alerts;
}