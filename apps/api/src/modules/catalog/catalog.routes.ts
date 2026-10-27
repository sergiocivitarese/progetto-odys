import { Router } from 'express';
import { findPlace, groupTrips, OPEN_METEO_ATTRIBUTION, MAP_PROVIDER_ATTRIBUTION } from '@odys/domain';
import { supabaseConfigured, type AppConfig } from '../../config/env';
import { handle } from '../../shared/http';

/** Contenuti di sola lettura: configurazione pubblica, idee di gruppo demo, schede luogo. */
export function catalogRouter(config: AppConfig): Router {
  const router = Router();

  router.get('/config', handle((_req, res) => {
    res.json({
      // Senza chiavi si usano servizi gratuiti OpenStreetMap: tutti i provider sono disponibili.
      providers: {
        geocoding: true,
        routing: true,
        maps: true,
        weather: true,
      },
      providerNames: {
        geocoding: config.keys.geoapify ? 'Geoapify' : 'OpenStreetMap · Photon',
        routing: config.keys.graphhopper ? 'GraphHopper' : 'OpenStreetMap · OSRM',
        maps: config.keys.maptiler ? 'MapTiler' : 'OpenStreetMap',
        weather: 'Open-Meteo',
      },
      // URL e chiave pubblica (anon) di Supabase: servono al browser per login e registrazione.
      auth: supabaseConfigured(config) ? { url: config.supabase.url, anonKey: config.supabase.anonKey } : null,
      accountDeletion: Boolean(config.supabase.serviceRoleKey),
      attributions: { weather: OPEN_METEO_ATTRIBUTION, maps: MAP_PROVIDER_ATTRIBUTION },
    });
  }));

  router.get('/group-trips', handle((_req, res) => res.json(groupTrips)));

  router.get('/places/:id', handle((req, res) => {
    const title = typeof req.query.title === 'string' ? req.query.title : undefined;
    const destination = typeof req.query.destination === 'string' ? req.query.destination : undefined;
    res.json(findPlace(String(req.params.id), title, destination));
  }));

  return router;
}
