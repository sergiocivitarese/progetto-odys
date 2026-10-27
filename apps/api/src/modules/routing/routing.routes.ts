import { Router } from 'express';
import { calculateGraphHopperRoute, calculateOsrmRoute, isRoutableMode, type RouteSegment } from '@odys/domain';
import { handle, HttpError, requireObject } from '../../shared/http';

/**
 * Calcolo online di una singola tratta: GraphHopper se c'è la chiave, altrimenti
 * OSRM sui server pubblici OpenStreetMap (gratuito, senza chiave).
 */
export function routingRouter(graphhopperKey: string, osm: { osrmUrl?: string; userAgent?: string } = {}, fetcher: typeof fetch = fetch): Router {
  const router = Router();

  router.post('/calculate', handle(async (req, res) => {
    const { segment } = requireObject<{ segment?: unknown }>(req.body, 'Richiesta non valida.');
    const route = requireObject<RouteSegment>(segment, 'Tratta mancante.');
    if (!isRoutableMode(route.recommendedMode)) {
      throw new HttpError(422, 'Il routing online è disponibile solo per percorsi a piedi, auto o stima taxi. Gli altri mezzi restano manuali o da verificare.');
    }
    if (!Number.isFinite(route.origin?.latitude) || !Number.isFinite(route.origin?.longitude) || !Number.isFinite(route.destination?.latitude) || !Number.isFinite(route.destination?.longitude)) {
      throw new HttpError(422, 'Routing non calcolabile: mancano coordinate valide per origine o destinazione.');
    }
    const patch = graphhopperKey
      ? await calculateGraphHopperRoute(route.origin, route.destination, route.recommendedMode, graphhopperKey, fetcher)
      : await calculateOsrmRoute(route.origin, route.destination, route.recommendedMode, { baseUrl: osm.osrmUrl, userAgent: osm.userAgent }, fetcher);
    if (!patch) throw new HttpError(503, 'Percorso online non disponibile in questo momento: la tratta resta stimata, puoi riprovare più tardi.');
    res.json({ patch });
  }));

  return router;
}
