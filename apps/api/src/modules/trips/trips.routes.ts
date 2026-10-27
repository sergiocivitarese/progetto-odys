import { Router } from 'express';
import type { Itinerary } from '@odys/domain';
import { currentUser, requireAuth, type AuthProvider } from '../../shared/auth';
import { TRIP_CHANGE_KINDS, type DataStore, type TripChangeKind } from '../../shared/data';
import { handle, HttpError, requireObject } from '../../shared/http';
import { TripsService } from './trips.service';

function itineraryFrom(body: unknown): { itinerary: Itinerary; title?: string; changeKind?: TripChangeKind; recordVersion?: boolean } {
  const payload = requireObject<{ itinerary?: unknown; title?: unknown; changeKind?: unknown; recordVersion?: unknown }>(body, 'Richiesta non valida.');
  const itinerary = requireObject<Itinerary>(payload.itinerary, 'Itinerario mancante.');
  if (typeof itinerary.destination !== 'string' || !Array.isArray(itinerary.days)) throw new HttpError(400, 'Itinerario non valido.');
  const changeKind = TRIP_CHANGE_KINDS.includes(payload.changeKind as TripChangeKind) ? payload.changeKind as TripChangeKind : undefined;
  return {
    itinerary,
    title: typeof payload.title === 'string' ? payload.title : undefined,
    changeKind,
    recordVersion: typeof payload.recordVersion === 'boolean' ? payload.recordVersion : undefined,
  };
}

function rawFrom(body: unknown): string {
  const payload = requireObject<{ raw?: unknown }>(body, 'Richiesta non valida.');
  if (typeof payload.raw !== 'string' || !payload.raw.trim()) throw new HttpError(400, 'Incolla il contenuto JSON dell’export.');
  return payload.raw;
}

function versionFrom(value: unknown): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) throw new HttpError(400, 'Versione non valida.');
  return version;
}

/** Viaggi dell'utente: tutte le rotte richiedono l'accesso (U-10). */
export function tripsRouter(auth: AuthProvider, store: DataStore): Router {
  const router = Router();
  router.use(requireAuth(auth));
  const service = (res: Parameters<typeof currentUser>[0]) => {
    const user = currentUser(res);
    return new TripsService(store.trips(user), store.account(user));
  };

  router.get('/', handle(async (_req, res) => res.json(await service(res).list())));
  router.post('/', handle(async (req, res) => {
    const { itinerary, title } = itineraryFrom(req.body);
    res.status(201).json(await service(res).create(itinerary, title));
  }));
  router.post('/import/preview', handle(async (req, res) => {
    const { trip, replacesExisting } = await service(res).previewImport(rawFrom(req.body));
    res.json({ trip, replacesExisting });
  }));
  router.post('/import', handle(async (req, res) => res.status(201).json(await service(res).import(rawFrom(req.body)))));
  router.get('/:id', handle(async (req, res) => res.json(await service(res).get(String(req.params.id)))));
  router.put('/:id', handle(async (req, res) => {
    const { itinerary, title, changeKind, recordVersion } = itineraryFrom(req.body);
    res.json(await service(res).update(String(req.params.id), itinerary, { title, changeKind, recordVersion }));
  }));
  router.patch('/:id', handle(async (req, res) => {
    const { title } = requireObject<{ title?: unknown }>(req.body, 'Richiesta non valida.');
    if (typeof title !== 'string') throw new HttpError(400, 'Nome del viaggio mancante.');
    res.json(await service(res).rename(String(req.params.id), title));
  }));
  router.delete('/:id', handle(async (req, res) => {
    await service(res).remove(String(req.params.id));
    res.status(204).end();
  }));
  router.get('/:id/export', handle(async (req, res) => {
    const { filename, json } = await service(res).exportJson(String(req.params.id));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.type('application/json').send(json);
  }));
  router.get('/:id/versions', handle(async (req, res) => res.json(await service(res).versions(String(req.params.id)))));
  router.get('/:id/versions/:version', handle(async (req, res) => res.json(await service(res).version(String(req.params.id), versionFrom(req.params.version)))));
  router.post('/:id/versions/:version/restore', handle(async (req, res) => res.json(await service(res).restore(String(req.params.id), versionFrom(req.params.version)))));

  return router;
}
