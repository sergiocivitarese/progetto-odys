import { Router } from 'express';
import { GENERATOR_DURATIONS, generateTrip, type GeneratorDates, type GeneratorDuration, type GeneratorParams } from '@odys/domain';
import { currentUser, requireAuth, type AuthProvider } from '../../shared/auth';
import type { DataStore } from '../../shared/data';
import { requireEntitlement } from '../../shared/entitlements';
import { handle, HttpError, requireObject } from '../../shared/http';

/** Valida i parametri della schermata «Generatore AI» (TP-01); li usa anche la creazione di un viaggio del coordinatore (CB-03). */
export function generatorParamsFrom(body: unknown): { params: GeneratorParams; seed: number } {
  const raw = requireObject<Record<string, unknown>>(body, 'Richiesta non valida.');
  const surprise = raw['surprise'] === true;
  const destination = typeof raw['destination'] === 'string' ? raw['destination'].trim().slice(0, 80) : '';
  if (!surprise && destination.length < 2) throw new HttpError(400, 'Indica una meta oppure scegli «Sorprendimi».');
  const duration = raw['duration'] as GeneratorDuration;
  if (!(duration in GENERATOR_DURATIONS)) throw new HttpError(400, 'Durata non valida.');
  const budget = Number(raw['budget']);
  if (!Number.isFinite(budget) || budget < 50 || budget > 20000) throw new HttpError(400, 'Il budget a persona va da 50 a 20.000 euro.');
  const interests = Array.isArray(raw['interests']) ? raw['interests'].filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 30)).filter(Boolean).slice(0, 8) : [];
  if (!interests.length) throw new HttpError(400, 'Scegli almeno un interesse.');
  const rawDates = requireObject<Record<string, unknown>>(raw['dates'], 'Indica quando vuoi partire.');
  const dates: GeneratorDates = rawDates['mode'] === 'precise'
    ? { mode: 'precise', departure: String(rawDates['departure'] ?? ''), returnDate: String(rawDates['returnDate'] ?? '') }
    : { mode: 'flexible', months: Array.isArray(rawDates['months']) ? rawDates['months'].map(Number) : [] };
  const seed = Number.isInteger(raw['seed']) ? Math.abs(raw['seed'] as number) % 1000 : 0;
  return { params: { destination, surprise, dates, duration, budgetPerPersonCents: Math.round(budget * 100), interests }, seed };
}

export function generateFromBody(body: unknown) {
  const { params, seed } = generatorParamsFrom(body);
  try {
    return generateTrip(params, seed);
  } catch (error) {
    throw new HttpError(422, error instanceof Error ? error.message : 'Itinerario non generabile con questi parametri.');
  }
}

/**
 * Generatore di itinerari del Traveller Premium (TP-01…TP-03).
 * Oggi usa il motore locale di Odys: il fornitore AI è da scegliere con il
 * cliente e prenderà il posto di `generateTrip` senza cambiare queste rotte.
 */
export function generatorRouter(auth: AuthProvider, store: DataStore): Router {
  const router = Router();
  router.use(requireAuth(auth), requireEntitlement(store, 'ai.generate'));

  // Genera (o rigenera, con un `seed` diverso): non salva nulla.
  router.post('/', handle(async (req, res) => {
    const { itinerary: _itinerary, ...trip } = generateFromBody(req.body);
    res.json(trip);
  }));

  // «Salva e accetta» (TP-03): solo l'itinerario accettato finisce tra i viaggi salvati.
  // Il server lo rigenera dagli stessi parametri: non si fida dell'itinerario inviato dal client.
  router.post('/accept', handle(async (req, res) => {
    const user = currentUser(res);
    const trip = generateFromBody(req.body);
    const saved = await store.trips(user).save({ itinerary: trip.itinerary, title: trip.title, changeKind: 'created', summary: 'Generato con il generatore di itinerari' });
    await store.account(user).record({ action: 'generator.accept', entity: 'trip', entityId: saved.id, metadata: { destination: trip.destination, days: trip.days.length } });
    res.status(201).json(saved);
  }));

  return router;
}
