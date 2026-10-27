import { Router } from 'express';
import { currentUser, requireAuth, type AuthProvider } from '../../shared/auth';
import type { CatalogFilters } from '../../shared/catalog';
import type { DataStore } from '../../shared/data';
import { handle, HttpError } from '../../shared/http';

function text(value: unknown, max = 80): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

/**
 * Catalogo dei viaggi pubblicati dai coordinatori.
 * Lettura libera, anche senza accesso (U-01…U-04, U-06, U-07, U-09);
 * "usa come base" e la richiesta di partecipazione richiedono l'accesso (U-21, U-14).
 */
export function publishedRouter(auth: AuthProvider, store: DataStore): Router {
  const router = Router();
  const ensureConfigured = () => {
    if (!auth.configured) throw new HttpError(503, 'Catalogo non disponibile: archivio non configurato.');
  };

  router.get('/trips', handle(async (req, res) => {
    ensureConfigured();
    const sort = req.query['sort'];
    const maxPrice = Number(req.query['maxPrice']);
    const filters: CatalogFilters = {
      q: text(req.query['q']),
      destination: text(req.query['destination']),
      coordinatorId: text(req.query['coordinator'], 40),
      maxPriceCents: Number.isFinite(maxPrice) && maxPrice > 0 ? Math.round(maxPrice * 100) : undefined,
      sort: sort === 'price' || sort === 'recent' ? sort : 'upcoming',
      includeCompleted: req.query['completed'] === '1',
    };
    res.json(await store.catalog().list(filters));
  }));

  router.get('/trips/:id', handle(async (req, res) => {
    ensureConfigured();
    const trip = await store.catalog().get(String(req.params.id));
    if (!trip) throw new HttpError(404, 'Viaggio non trovato o non più disponibile.');
    // I posti rimasti sono un'informazione in più: se il conteggio non è disponibile il dettaglio si apre lo stesso.
    const confirmed = await store.catalog().confirmedCount(trip.id).catch(() => null);
    res.json({ ...trip, seatsLeft: trip.capacity === undefined || confirmed === null ? undefined : Math.max(0, trip.capacity - confirmed) });
  }));

  // Richiesta di partecipazione (U-14, U-16): tracciata, senza pagamento; il posto lo conferma il coordinatore.
  router.post('/trips/:id/participation', requireAuth(auth), handle(async (req, res) => {
    const user = currentUser(res);
    const message = text((req.body as { message?: unknown } | undefined)?.message, 600);
    const request = await store.participation(user).request(String(req.params.id), message);
    await store.account(user).record({ action: 'participation.request', entity: 'published_trip', entityId: request.tripId });
    res.status(201).json(request);
  }));

  router.delete('/trips/:id/participation', requireAuth(auth), handle(async (req, res) => {
    const user = currentUser(res);
    const request = await store.participation(user).withdraw(String(req.params.id));
    if (!request) throw new HttpError(404, 'Non hai una richiesta per questo viaggio.');
    await store.account(user).record({ action: 'participation.withdraw', entity: 'published_trip', entityId: request.tripId });
    res.json(request);
  }));

  router.get('/coordinators/:id', handle(async (req, res) => {
    ensureConfigured();
    const catalog = store.catalog();
    const id = String(req.params.id);
    const coordinator = await catalog.coordinator(id);
    if (!coordinator) throw new HttpError(404, 'Coordinatore non trovato.');
    res.json({ coordinator, trips: await catalog.list({ coordinatorId: id, includeCompleted: true, sort: 'upcoming' }) });
  }));

  router.post('/trips/:id/copy', requireAuth(auth), handle(async (req, res) => {
    const user = currentUser(res);
    const trip = await store.saved(user).copy(String(req.params.id));
    await store.account(user).record({ action: 'trip.copied', entity: 'trip', entityId: trip.id, metadata: { from: String(req.params.id) } });
    res.status(201).json(trip);
  }));

  return router;
}
