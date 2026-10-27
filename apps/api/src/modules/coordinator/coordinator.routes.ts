import { Router } from 'express';
import type { Itinerary } from '@odys/domain';
import { currentUser, requireAuth, type AuthProvider } from '../../shared/auth';
import { COORDINATOR_GUIDELINES_VERSION, type PublishedTripInput, type PublishedTripStatus } from '../../shared/catalog';
import type { CoordinatorApplicationInput } from '../../shared/community';
import type { DataStore } from '../../shared/data';
import { handle, HttpError, requireObject } from '../../shared/http';

const MAX_LIST_ITEMS = 20;

function list(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new HttpError(400, `Campo ${field} non valido.`);
  return value.map((item) => item.trim()).filter(Boolean).slice(0, MAX_LIST_ITEMS).map((item) => item.slice(0, 140));
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `Campo ${field} non valido.`);
  if (value.trim().length > max) throw new HttpError(400, `Il campo ${field} può avere al massimo ${max} caratteri.`);
  return value.trim();
}

function date(value: unknown, field: string): string | undefined {
  if (value === undefined || value === '' || value === null) return value === undefined ? undefined : '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `Data ${field} non valida.`);
  return value;
}

/** Valida i dati inviati dal coordinatore (C-13 lato server, prima delle regole del database). */
function inputFrom(body: unknown, partial: boolean): Partial<PublishedTripInput> {
  const raw = requireObject<Record<string, unknown>>(body, 'Richiesta non valida.');
  const out: Partial<PublishedTripInput> = {
    title: optionalText(raw['title'], 'titolo', 120),
    summary: optionalText(raw['summary'], 'descrizione', 600),
    destination: optionalText(raw['destination'], 'destinazione', 120),
    startDate: date(raw['startDate'], 'di partenza'),
    endDate: date(raw['endDate'], 'di rientro'),
    included: list(raw['included'], 'incluso'),
    excluded: list(raw['excluded'], 'escluso'),
  };
  if (raw['price'] !== undefined) {
    const price = Number(raw['price']);
    if (!Number.isFinite(price) || price < 0 || price > 100000) throw new HttpError(400, 'Quota non valida.');
    out.priceCents = Math.round(price * 100); // P-06: prezzi salvati in centesimi
  }
  if (raw['capacity'] !== undefined) {
    const capacity = Number(raw['capacity']);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) throw new HttpError(400, 'Il numero di posti deve essere tra 1 e 500.');
    out.capacity = capacity;
  }
  if (raw['coverImageUrl'] !== undefined) {
    const url = optionalText(raw['coverImageUrl'], 'immagine', 500) ?? '';
    if (url && !/^https:\/\//.test(url)) throw new HttpError(400, 'L’immagine di copertina deve essere un indirizzo https.');
    out.coverImageUrl = url;
  }
  if (!partial && (!out.title || out.title.length < 3)) throw new HttpError(400, 'Il titolo deve avere almeno 3 caratteri.');
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== undefined)) as Partial<PublishedTripInput>;
}

/** Valida la candidatura (C-02); i requisiti sul profilo li verifica il database. */
function applicationFrom(body: unknown): CoordinatorApplicationInput {
  const raw = requireObject<Record<string, unknown>>(body, 'Richiesta non valida.');
  const motivation = optionalText(raw['motivation'], 'motivazione', 1200) ?? '';
  const experience = optionalText(raw['experience'], 'esperienza', 1200) ?? '';
  if (motivation.length < 40) throw new HttpError(422, 'Racconta in almeno 40 caratteri perché vuoi coordinare viaggi con Odys.');
  if (experience.length < 20) throw new HttpError(422, 'Descrivi la tua esperienza di viaggio in almeno 20 caratteri.');
  const tripsLed = Number(raw['tripsLed'] ?? 0);
  if (!Number.isInteger(tripsLed) || tripsLed < 0 || tripsLed > 500) throw new HttpError(422, 'Il numero di viaggi organizzati non è valido.');
  const links = (list(raw['links'], 'link') ?? []).slice(0, 5);
  if (links.some((link) => !/^https:\/\/\S+$/.test(link))) throw new HttpError(422, 'I link devono essere indirizzi https.');
  if (raw['acceptGuidelines'] !== true) throw new HttpError(422, 'Per candidarti devi accettare le linee guida del coordinatore.');
  return { motivation, experience, tripsLed, languages: (list(raw['languages'], 'lingue') ?? []).slice(0, 8), links };
}

const STATUS_ACTIONS: Record<string, PublishedTripStatus> = {
  publish: 'published',
  schedule: 'scheduled',
  unpublish: 'draft',
  cancel: 'cancelled',
  archive: 'archived',
};

/**
 * Area del coordinatore (C-09…C-14): viaggi pubblicati propri, in tutti gli stati.
 * Il ruolo lo assegna un amministratore (C-01, C-03); prima di pubblicare si
 * accettano le linee guida (C-04).
 */
export function coordinatorRouter(auth: AuthProvider, store: DataStore): Router {
  const router = Router();
  router.use(requireAuth(auth));
  const repo = (res: Parameters<typeof currentUser>[0]) => store.coordinator(currentUser(res));

  router.get('/status', handle(async (_req, res) => {
    const coordinator = repo(res);
    const isCoordinator = await coordinator.isCoordinator();
    res.json({
      isCoordinator,
      guidelinesAccepted: isCoordinator ? await coordinator.hasAcceptedGuidelines() : false,
      guidelinesVersion: COORDINATOR_GUIDELINES_VERSION,
      // Ultima candidatura di chi non è ancora coordinatore (C-01).
      application: isCoordinator ? null : await store.applications(currentUser(res)).latest().catch(() => null),
    });
  }));

  // Candidatura al ruolo (C-01, C-02): la valuta un amministratore, l'attivazione non è automatica.
  router.post('/application', handle(async (req, res) => {
    const user = currentUser(res);
    const coordinator = repo(res);
    if (await coordinator.isCoordinator()) throw new HttpError(422, 'Il tuo account è già abilitato come coordinatore.');
    const input = applicationFrom(req.body);
    const application = await store.applications(user).submit(input, COORDINATOR_GUIDELINES_VERSION);
    // C-04: l'accettazione delle linee guida è un consenso versionato, registrato con la candidatura.
    if (!(await coordinator.hasAcceptedGuidelines())) await coordinator.acceptGuidelines();
    await store.account(user).record({ action: 'coordinator_application.submit', entity: 'coordinator_application', entityId: application.id, metadata: { guidelines: COORDINATOR_GUIDELINES_VERSION } });
    res.status(201).json(application);
  }));

  // Da qui in poi: solo coordinatori attivi che hanno accettato le linee guida.
  router.post('/guidelines', handle(async (_req, res) => {
    const coordinator = repo(res);
    if (!(await coordinator.isCoordinator())) throw new HttpError(403, 'Questa area è riservata ai coordinatori approvati.');
    await coordinator.acceptGuidelines();
    await store.account(currentUser(res)).record({ action: 'coordinator.guidelines', metadata: { version: COORDINATOR_GUIDELINES_VERSION } });
    res.status(204).end();
  }));

  router.use(handle(async (_req, res, next) => {
    const coordinator = repo(res);
    if (!(await coordinator.isCoordinator())) throw new HttpError(403, 'Questa area è riservata ai coordinatori approvati.');
    if (!(await coordinator.hasAcceptedGuidelines())) throw new HttpError(428, 'Accetta le linee guida del coordinatore per continuare.');
    next();
  }));

  router.get('/trips', handle(async (_req, res) => {
    const trips = await repo(res).list();
    const counts = await store.participation(currentUser(res)).counts(trips.map((trip) => trip.id)).catch(() => new Map<string, { pending: number; confirmed: number }>());
    res.json(trips.map((trip) => ({ ...trip, requests: counts.get(trip.id) ?? { pending: 0, confirmed: 0 } })));
  }));

  // Partecipanti e richieste di un proprio viaggio (C-15).
  router.get('/trips/:id/participants', handle(async (req, res) => {
    const trip = await repo(res).get(String(req.params.id));
    if (!trip) throw new HttpError(404, 'Viaggio non trovato.');
    res.json(await store.participation(currentUser(res)).participants(trip.id));
  }));

  router.post('/trips/:id/participants/:requestId/:decision', handle(async (req, res) => {
    const decision = String(req.params.decision);
    if (decision !== 'confirm' && decision !== 'decline') throw new HttpError(404, 'Azione non disponibile.');
    const trip = await repo(res).get(String(req.params.id));
    if (!trip) throw new HttpError(404, 'Viaggio non trovato.');
    const user = currentUser(res);
    const updated = await store.participation(user).decide(trip.id, String(req.params.requestId), decision === 'confirm' ? 'confirmed' : 'declined');
    if (!updated) throw new HttpError(404, 'Richiesta non trovata.');
    await store.account(user).record({ action: `participation.${decision}`, entity: 'participation_request', entityId: updated.id, metadata: { trip: trip.id } });
    res.json(updated);
  }));

  router.post('/trips', handle(async (req, res) => {
    const user = currentUser(res);
    const body = requireObject<{ sourceTripId?: unknown }>(req.body, 'Richiesta non valida.');
    if (typeof body.sourceTripId !== 'string') throw new HttpError(400, 'Scegli uno dei tuoi viaggi da cui partire.');
    const source = await store.trips(user).get(body.sourceTripId);
    if (!source) throw new HttpError(404, 'Viaggio di partenza non trovato.');
    const input = inputFrom(req.body, false);
    const itinerary: Itinerary = source.itinerary;
    const created = await repo(res).create({
      title: input.title!,
      summary: input.summary ?? '',
      destination: input.destination || itinerary.destination,
      startDate: input.startDate ?? (itinerary.departure || undefined),
      endDate: input.endDate ?? (itinerary.returnDate || undefined),
      priceCents: input.priceCents,
      capacity: input.capacity,
      included: input.included ?? [],
      excluded: input.excluded ?? [],
      coverImageUrl: input.coverImageUrl,
      itinerary,
      sourceTripId: source.id,
    });
    await store.account(user).record({ action: 'published_trip.create', entity: 'published_trip', entityId: created.id });
    res.status(201).json(created);
  }));

  router.get('/trips/:id', handle(async (req, res) => {
    const trip = await repo(res).get(String(req.params.id));
    if (!trip) throw new HttpError(404, 'Viaggio non trovato.');
    res.json(trip);
  }));

  router.put('/trips/:id', handle(async (req, res) => {
    const user = currentUser(res);
    const patch = inputFrom(req.body, true);
    const { refreshItinerary } = requireObject<{ refreshItinerary?: unknown }>(req.body, 'Richiesta non valida.');
    const current = await repo(res).get(String(req.params.id));
    if (!current) throw new HttpError(404, 'Viaggio non trovato.');
    if (refreshItinerary === true) {
      // C-12: l'offerta si aggiorna con l'ultima versione dell'itinerario del coordinatore.
      const source = current.sourceTripId ? await store.trips(user).get(current.sourceTripId) : null;
      if (!source) throw new HttpError(404, 'Il viaggio di partenza non esiste più.');
      patch.itinerary = source.itinerary;
    }
    const updated = await repo(res).update(current.id, patch);
    await store.account(user).record({ action: 'published_trip.update', entity: 'published_trip', entityId: current.id });
    res.json(updated);
  }));

  router.post('/trips/:id/:action', handle(async (req, res) => {
    const status = STATUS_ACTIONS[String(req.params.action)];
    if (!status) throw new HttpError(404, 'Azione non disponibile.');
    let scheduledFor: string | undefined;
    if (status === 'scheduled') {
      const { scheduledFor: value } = requireObject<{ scheduledFor?: unknown }>(req.body, 'Richiesta non valida.');
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new HttpError(400, 'Data e ora di pubblicazione non valide.');
      if (Date.parse(value) <= Date.now()) throw new HttpError(422, 'Scegli una data e un’ora di pubblicazione future.');
      scheduledFor = new Date(value).toISOString();
    }
    const current = await repo(res).get(String(req.params.id));
    if (!current) throw new HttpError(404, 'Viaggio non trovato.');
    if (status === 'draft' && ['active', 'completed'].includes(current.effectiveStatus)) throw new HttpError(422, 'Un viaggio in corso o concluso non può tornare in bozza.');
    const updated = await repo(res).setStatus(current.id, status, scheduledFor);
    await store.account(currentUser(res)).record({ action: `published_trip.${req.params.action}`, entity: 'published_trip', entityId: current.id });
    res.json(updated);
  }));

  return router;
}
