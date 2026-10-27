import { Router } from 'express';
import { normalizePlan, type GeoTarget, type Itinerary, type LocationNode } from '@odys/domain';
import { handle, HttpError, requireObject } from '../../shared/http';
import type { GeoService } from './geo.service';

export function geoRouter(service: GeoService): Router {
  const router = Router();

  router.get('/search', handle(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const city = typeof req.query.city === 'string' && req.query.city.trim() ? req.query.city : undefined;
    const type = typeof req.query.type === 'string' ? req.query.type as LocationNode['type'] : undefined;
    res.json(await service.search({ query, city, type, language: 'it' }));
  }));

  // Suggerimenti OpenStreetMap mentre si digita (planner, tappe, alloggio, punti di arrivo).
  router.get('/suggest', handle(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const kind = req.query.kind === 'point' ? 'point' : 'place';
    try {
      res.json(await service.suggest({ query, kind }));
    } catch (error) {
      console.warn('[geo] suggerimenti non disponibili:', (error as Error).message);
      throw new HttpError(503, 'Suggerimenti non disponibili in questo momento: puoi scrivere la località a mano.');
    }
  }));

  router.post('/enrich', handle(async (req, res) => {
    const { itinerary } = requireObject<{ itinerary?: unknown }>(req.body, 'Richiesta non valida.');
    res.json(await service.enrich(normalizePlan(requireObject<Itinerary>(itinerary, 'Itinerario mancante.'))));
  }));

  router.post('/confirm', handle((req, res) => {
    const body = requireObject<{ itinerary?: unknown; target?: unknown; node?: unknown }>(req.body, 'Richiesta non valida.');
    const target = requireObject<GeoTarget>(body.target, 'Destinazione della conferma mancante.');
    if (!['destination', 'activity', 'lodging', 'node'].includes(target.kind)) throw new HttpError(400, 'Tipo di luogo non valido.');
    res.json(service.confirm(
      normalizePlan(requireObject<Itinerary>(body.itinerary, 'Itinerario mancante.')),
      target,
      requireObject<LocationNode>(body.node, 'Luogo mancante.'),
    ));
  }));

  return router;
}
