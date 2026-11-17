import { Router } from 'express';
import { INVITABLE_ROLES, isValidAgencySlug, licenseQuote, MAX_LICENSE_SEATS, type AgencyRole, type BillingCycle } from '@odys/domain';
import type { AgencyProfileInput } from '../../shared/agency';
import { currentUser, requireAuth, type AuthProvider } from '../../shared/auth';
import type { DataStore } from '../../shared/data';
import { handle, HttpError, requireObject } from '../../shared/http';

function text(value: unknown, field: string, max: number, min = 0): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (typeof value !== 'string') throw new HttpError(400, `Campo non valido: ${field}.`);
  const clean = value.trim();
  if (clean.length > max) throw new HttpError(400, `${field}: al massimo ${max} caratteri.`);
  if (clean && clean.length < min) throw new HttpError(400, `${field}: almeno ${min} caratteri.`);
  return clean;
}

/** Profilo dell'agenzia (AG-01): campi controllati prima di arrivare al database. */
function profileFrom(body: unknown): AgencyProfileInput {
  const raw = requireObject<Record<string, unknown>>(body, 'Richiesta non valida.');
  const out: AgencyProfileInput = {
    legalName: text(raw['legalName'], 'Ragione sociale', 160, 2),
    displayName: text(raw['displayName'], 'Nome pubblico', 80, 2),
    slug: text(raw['slug'], 'Indirizzo', 48),
    description: text(raw['description'], 'Descrizione', 1500),
    logoUrl: text(raw['logoUrl'], 'Logo', 500),
    email: text(raw['email'], 'Email', 200),
    phone: text(raw['phone'], 'Telefono', 40),
    website: text(raw['website'], 'Sito', 300),
    city: text(raw['city'], 'Città', 80),
    country: text(raw['country'], 'Paese', 80),
    saleTerms: text(raw['saleTerms'], 'Condizioni di vendita', 4000),
  };
  if (out.slug !== undefined && !isValidAgencySlug(out.slug)) throw new HttpError(400, 'Indirizzo: lettere minuscole, numeri e trattini (da 3 a 48 caratteri).');
  if (out.logoUrl && !/^https:\/\//.test(out.logoUrl)) throw new HttpError(400, 'Il logo deve essere un indirizzo https.');
  if (out.website && !/^https?:\/\//.test(out.website)) throw new HttpError(400, 'Il sito deve iniziare con http:// o https://.');
  if (out.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) throw new HttpError(400, 'Email non valida.');
  if (out.legalName === '' || out.displayName === '' || out.slug === '') throw new HttpError(400, 'Ragione sociale, nome pubblico e indirizzo sono obbligatori.');
  return out;
}

/** Area agenzia (AG-01, AG-02, AG-05, AG-09, AG-10): ogni azione la verifica il database in base al ruolo interno. */
export function agencyRouter(auth: AuthProvider, store: DataStore): Router {
  const router = Router();
  router.use(requireAuth(auth));
  const repo = (res: Parameters<typeof currentUser>[0]) => store.agency(currentUser(res));

  // La mia agenzia, con ruolo interno e preventivo delle licenze.
  router.get('/', handle(async (_req, res) => {
    const mine = (await repo(res).mine())[0];
    if (!mine) { res.json(null); return; }
    res.json({ ...mine, quote: licenseQuote(mine.agency.licenseSeats, mine.agency.billingCycle) });
  }));

  router.post('/', handle(async (req, res) => {
    const input = profileFrom(req.body);
    if (!input.legalName || !input.displayName || !input.slug) throw new HttpError(400, 'Ragione sociale, nome pubblico e indirizzo sono obbligatori.');
    const agency = await repo(res).create({ legalName: input.legalName, displayName: input.displayName, slug: input.slug });
    res.status(201).json(agency);
  }));

  router.put('/:id', handle(async (req, res) => {
    res.json(await repo(res).updateProfile(String(req.params.id), profileFrom(req.body)));
  }));

  router.get('/:id/team', handle(async (req, res) => {
    res.json(await repo(res).team(String(req.params.id)));
  }));

  router.post('/:id/team', handle(async (req, res) => {
    const body = requireObject<{ email?: unknown; role?: unknown }>(req.body, 'Richiesta non valida.');
    if (typeof body.email !== 'string' || !body.email.includes('@')) throw new HttpError(400, 'Indica l’email dell’account Odys da invitare.');
    if (!INVITABLE_ROLES.includes(body.role as AgencyRole)) throw new HttpError(400, 'Ruolo non valido.');
    res.status(201).json({ id: await repo(res).invite(String(req.params.id), body.email, body.role as AgencyRole) });
  }));

  router.delete('/members/:memberId', handle(async (req, res) => {
    await repo(res).remove(String(req.params.memberId));
    res.status(204).end();
  }));

  router.post('/members/:memberId/license', handle(async (req, res) => {
    await repo(res).assignLicense(String(req.params.memberId));
    res.status(204).end();
  }));

  router.delete('/members/:memberId/license', handle(async (req, res) => {
    await repo(res).revokeLicense(String(req.params.memberId));
    res.status(204).end();
  }));

  // Licenze acquistate e fatturazione (AG-10): l'acquisto è simulato, senza pagamento.
  router.put('/:id/licenses', handle(async (req, res) => {
    const body = requireObject<{ seats?: unknown; billingCycle?: unknown }>(req.body, 'Richiesta non valida.');
    const seats = Number(body.seats);
    if (!Number.isInteger(seats) || seats < 0 || seats > MAX_LICENSE_SEATS) throw new HttpError(400, `Le licenze vanno da 0 a ${MAX_LICENSE_SEATS}.`);
    const cycle = body.billingCycle === 'annual' ? 'annual' : body.billingCycle === 'monthly' || body.billingCycle === undefined ? 'monthly' : null;
    if (!cycle) throw new HttpError(400, 'Fatturazione non valida.');
    const agency = await repo(res).setSeats(String(req.params.id), seats, cycle as BillingCycle);
    res.json({ agency, quote: licenseQuote(agency.licenseSeats, agency.billingCycle) });
  }));

  // Catalogo (AG-03, AG-04): viaggi dell'agenzia con le loro partenze e viaggi dei coordinatori del team.
  router.get('/:id/catalog', handle(async (req, res) => {
    const catalog = await repo(res).catalog(String(req.params.id));
    const all = [...catalog.trips, ...catalog.coordinatorTrips];
    const taken = await store.catalog(currentUser(res)).seatsTaken(all.map((trip) => trip.id)).catch(() => new Map<string, number>());
    const withSeats = <T extends { id: string }>(trips: T[]) => trips.map((trip) => ({ ...trip, seatsTaken: taken.get(trip.id) ?? 0 }));
    res.json({ trips: withSeats(catalog.trips), coordinatorTrips: withSeats(catalog.coordinatorTrips) });
  }));

  router.post('/trips/:tripId/departures', handle(async (req, res) => {
    const body = requireObject<{ startDate?: unknown; endDate?: unknown }>(req.body, 'Richiesta non valida.');
    const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (!isDate(body.startDate) || !isDate(body.endDate)) throw new HttpError(400, 'Indica date di partenza e rientro valide.');
    res.status(201).json({ id: await repo(res).addDeparture(String(req.params.tripId), body.startDate, body.endDate) });
  }));

  router.put('/trips/:tripId/coordinator', handle(async (req, res) => {
    const { userId } = requireObject<{ userId?: unknown }>(req.body, 'Richiesta non valida.');
    if (userId !== null && typeof userId !== 'string') throw new HttpError(400, 'Coordinatore non valido.');
    await repo(res).assignCoordinator(String(req.params.tripId), userId);
    res.status(204).end();
  }));

  // Ombrello (AG-11): per viaggio e come valore predefinito del coordinatore.
  router.put('/:id/umbrella/:tripId', handle(async (req, res) => {
    const { on } = requireObject<{ on?: unknown }>(req.body, 'Richiesta non valida.');
    if (typeof on !== 'boolean') throw new HttpError(400, 'Richiesta non valida.');
    await repo(res).setUmbrella(String(req.params.id), String(req.params.tripId), on);
    res.status(204).end();
  }));

  router.put('/members/:memberId/umbrella', handle(async (req, res) => {
    const { on } = requireObject<{ on?: unknown }>(req.body, 'Richiesta non valida.');
    if (typeof on !== 'boolean') throw new HttpError(400, 'Richiesta non valida.');
    await repo(res).setUmbrellaDefault(String(req.params.memberId), on);
    res.status(204).end();
  }));

  // Inviti ricevuti da qualunque utente.
  router.get('/invites/mine', handle(async (_req, res) => {
    res.json(await repo(res).invites());
  }));

  router.post('/invites/:memberId/:decision', handle(async (req, res) => {
    const decision = String(req.params.decision);
    if (decision !== 'accept' && decision !== 'decline') throw new HttpError(404, 'Azione non disponibile.');
    res.json({ status: await repo(res).respond(String(req.params.memberId), decision === 'accept') });
  }));

  return router;
}

/** Pagina pubblica dell'agenzia (AG-01). */
export function agenciesRouter(store: DataStore): Router {
  const router = Router();
  router.get('/:slug', handle(async (req, res) => {
    const slug = String(req.params.slug);
    if (!isValidAgencySlug(slug)) throw new HttpError(404, 'Agenzia non trovata.');
    const profile = await store.agencyBySlug(slug);
    if (!profile) throw new HttpError(404, 'Agenzia non trovata.');
    res.json(profile);
  }));
  return router;
}
