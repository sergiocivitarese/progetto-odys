import { Router } from 'express';
import { currentUser, maybeUser, optionalAuth, requireAuth, type AuthProvider, type AuthUser } from '../../shared/auth';
import { refineCatalog, similarDestinations, suggestPlaces, type CatalogFilters, type PublishedTripSummary } from '../../shared/catalog';
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

  // Le rotte di lettura restano pubbliche; con l'accesso aggiungono affinità e viaggi «Solo follower».
  router.use(optionalAuth(auth));

  /** Interessi di chi guarda (per l'affinità, TB-04); senza accesso nessuno. */
  const interestsOf = async (user: AuthUser | undefined): Promise<string[]> =>
    user ? (await store.account(user).getProfile().catch(() => null))?.interests ?? [] : [];

  /** Catalogo filtrato, con posti liberi e affinità (TB-03…TB-05). */
  const search = async (user: AuthUser | undefined, filters: CatalogFilters): Promise<PublishedTripSummary[]> => {
    const catalog = store.catalog(user);
    const trips = await catalog.list({ destination: filters.destination, coordinatorId: filters.coordinatorId, maxPriceCents: filters.maxPriceCents, includeCompleted: filters.includeCompleted });
    const [taken, interests] = await Promise.all([
      // I posti liberi sono un'informazione in più: se il conteggio non risponde il catalogo si apre lo stesso.
      catalog.seatsTaken(trips.map((trip) => trip.id)).catch(() => null),
      interestsOf(user),
    ]);
    const refined = refineCatalog(trips, filters, taken ?? new Map(), interests);
    return taken ? refined : refined.map((trip) => ({ ...trip, seatsLeft: undefined }));
  };

  router.get('/trips', handle(async (req, res) => {
    ensureConfigured();
    const sort = req.query['sort'];
    const maxPrice = Number(req.query['maxPrice']);
    const month = Number(req.query['month']);
    const minDays = Number(req.query['minDays']);
    const maxDays = Number(req.query['maxDays']);
    const interests = text(req.query['interests'], 200)?.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 12);
    const filters: CatalogFilters = {
      q: text(req.query['q']),
      destination: text(req.query['destination']),
      coordinatorId: text(req.query['coordinator'], 40),
      maxPriceCents: Number.isFinite(maxPrice) && maxPrice > 0 ? Math.round(maxPrice * 100) : undefined,
      sort: sort === 'price' || sort === 'recent' || sort === 'upcoming' ? sort : 'affinity',
      includeCompleted: req.query['completed'] === '1',
      interests: interests?.length ? interests : undefined,
      month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : undefined,
      minDays: Number.isInteger(minDays) && minDays > 0 ? minDays : undefined,
      maxDays: Number.isInteger(maxDays) && maxDays > 0 ? maxDays : undefined,
      onlyAvailable: req.query['available'] === '1',
    };
    res.json(await search(maybeUser(res), filters));
  }));

  // Ricerca per intento (TB-02): suggerimenti di paese, regione e città con il numero di viaggi.
  router.get('/suggest', handle(async (req, res) => {
    ensureConfigured();
    const q = text(req.query['q']) ?? '';
    res.json(suggestPlaces(await store.catalog(maybeUser(res)).list({}), q));
  }));

  // «Chi cerca Messico guarda anche»: mete con interessi simili (TB-02).
  router.get('/similar', handle(async (req, res) => {
    ensureConfigured();
    const q = text(req.query['q']) ?? '';
    res.json(similarDestinations(await store.catalog(maybeUser(res)).list({}), q));
  }));

  router.get('/trips/:id', handle(async (req, res) => {
    ensureConfigured();
    const user = maybeUser(res);
    const catalog = store.catalog(user);
    const trip = await catalog.get(String(req.params.id));
    if (!trip) throw new HttpError(404, 'Viaggio non trovato o non più disponibile.');
    const [taken, interests, participants] = await Promise.all([catalog.seatsTaken([trip.id]).catch(() => null), interestsOf(user), catalog.participantInitials(trip.id).catch(() => [])]);
    void catalog.recordView(trip.id).catch(() => undefined);
    const [detail] = refineCatalog([trip], {}, taken ?? new Map(), interests);
    res.json({ ...trip, ...detail, seatsLeft: taken ? detail.seatsLeft : undefined, participants });
  }));

  router.delete('/trips/:id/participation', requireAuth(auth), handle(async (req, res) => {
    const user = currentUser(res);
    const request = await store.participation(user).withdraw(String(req.params.id));
    if (!request) throw new HttpError(404, 'Non hai una prenotazione per questo viaggio.');
    await store.account(user).record({ action: 'participation.withdraw', entity: 'published_trip', entityId: request.tripId });
    res.json(request);
  }));

  router.get('/coordinators/:id', handle(async (req, res) => {
    ensureConfigured();
    const catalog = store.catalog(maybeUser(res));
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
