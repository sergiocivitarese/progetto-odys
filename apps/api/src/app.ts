import cors from 'cors';
import express, { type Express } from 'express';
import { configureDomain } from '@odys/domain';
import type { AppConfig } from './config/env';
import { errorHandler } from './shared/http';
import { catalogRouter } from './modules/catalog/catalog.routes';
import { geoRouter } from './modules/geo/geo.routes';
import { GeoService } from './modules/geo/geo.service';
import { itineraryRouter } from './modules/itinerary/itinerary.routes';
import { mapsRouter } from './modules/maps/maps.routes';
import { routingRouter } from './modules/routing/routing.routes';
import { tripsRouter } from './modules/trips/trips.routes';
import { weatherRouter } from './modules/weather/weather.routes';
import { accountRouter } from './modules/account/account.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { postsRouter, studioRouter } from './modules/creator/creator.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { coordinatorRouter } from './modules/coordinator/coordinator.routes';
import { publishedRouter } from './modules/published/published.routes';
import { supabaseAuthProvider } from './infra/supabase/auth-provider';
import { supabaseGeoCacheStore } from './infra/supabase/geocode-cache';
import { supabaseDataStore } from './infra/supabase/supabase-store';
import type { AuthProvider } from './shared/auth';
import type { DataStore } from './shared/data';

/** Dipendenze sostituibili (i test usano l'archivio in memoria). */
export interface AppDependencies {
  auth?: AuthProvider;
  store?: DataStore;
  /** Rete verso i provider esterni (i test la sostituiscono). */
  fetch?: typeof fetch;
}

/**
 * Compone l'API: ogni modulo espone un router montato sotto `/api/<modulo>`.
 * Per aggiungere un modulo: crea `modules/<nome>/<nome>.routes.ts` e montalo qui.
 */
export function createApp(config: AppConfig, deps: AppDependencies = {}): Express {
  configureDomain({ mapProviderAvailable: Boolean(config.keys.maptiler) });

  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '5mb' }));

  const auth = deps.auth ?? supabaseAuthProvider(config);
  const store = deps.store ?? supabaseDataStore(config);

  app.get('/api/health', (_req, res) => { res.json({ status: 'ok' }); });
  app.use('/api', catalogRouter(config));
  app.use('/api/me', accountRouter(auth, store));
  app.use('/api/trips', tripsRouter(auth, store));
  app.use('/api/catalog', publishedRouter(auth, store));
  app.use('/api/coordinator', coordinatorRouter(auth, store));
  app.use('/api/admin', adminRouter(auth, store));
  app.use('/api/posts', postsRouter(auth, store));
  app.use('/api/studio', studioRouter(auth, store));
  app.use('/api/reports', reportsRouter(auth, store));
  app.use('/api/itineraries', itineraryRouter());
  app.use('/api/geo', geoRouter(new GeoService(config.keys.geoapify, config.dataDir, deps.store ? null : supabaseGeoCacheStore(config), config.osm, deps.fetch)));
  app.use('/api/weather', weatherRouter());
  app.use('/api/routes', routingRouter(config.keys.graphhopper, config.osm, deps.fetch));
  app.use('/api/maps', mapsRouter(config.keys.maptiler));

  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Risorsa non trovata.' }); });
  app.use(errorHandler);
  return app;
}
