import { Router } from 'express';
import { normalizePlan, normalizeWeatherRecords, WeatherClient, weatherKey, weatherRequestForDay, type Itinerary } from '@odys/domain';
import { handle, requireObject } from '../../shared/http';

/** Meteo Open-Meteo per ogni giornata con coordinate confermate (logica di `refreshWeather`). */
export function weatherRouter(client = new WeatherClient()): Router {
  const router = Router();

  router.post('/refresh', handle(async (req, res) => {
    const { itinerary } = requireObject<{ itinerary?: unknown }>(req.body, 'Richiesta non valida.');
    const plan = normalizePlan(requireObject<Itinerary>(itinerary, 'Itinerario mancante.'));
    const requests = plan.days.map((day) => weatherRequestForDay(plan, day.day)).filter((request): request is NonNullable<typeof request> => request !== null);
    const cached = new Map(normalizeWeatherRecords(plan.weather).map((record) => [weatherKey(record), record]));
    if (!requests.length) {
      res.json({ weather: [...cached.values()], requested: 0 });
      return;
    }
    const refreshed = await Promise.all(requests.map((request) => client.get(request, cached.get(weatherKey(request)))));
    const refreshedKeys = new Set(refreshed.map((record) => weatherKey(record)));
    const weather = normalizeWeatherRecords([...cached.values()].filter((record) => !refreshedKeys.has(weatherKey(record))).concat(refreshed));
    res.json({ weather, requested: requests.length });
  }));

  return router;
}
