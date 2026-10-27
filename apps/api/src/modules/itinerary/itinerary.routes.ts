import { Router } from 'express';
import {
  applyDateChanges,
  checkDateChanges,
  confirmBudget,
  confirmOriginRoutes,
  finalizeDraft,
  generateItinerary,
  normalizePlan,
  previewOriginRoutes,
  proposeRepositioning,
  validateTripForm,
  type Itinerary,
  type LodgingInfo,
  type TripDateFields,
  type TripForm,
} from '@odys/domain';
import { handle, HttpError, requireObject } from '../../shared/http';

function planFrom(value: unknown, field = 'itinerary'): Itinerary {
  const plan = requireObject<Itinerary>(value, `Campo ${field} mancante o non valido.`);
  if (typeof plan.destination !== 'string' || !Array.isArray(plan.days)) throw new HttpError(400, `Campo ${field} non valido.`);
  return normalizePlan(plan);
}

/**
 * Casi d'uso sull'itinerario: generazione dal modulo e modifiche che
 * ricalcolano giornate o tratte (date, budget, alloggio, bozza).
 */
export function itineraryRouter(): Router {
  const router = Router();

  router.post('/generate', handle((req, res) => {
    const { form } = requireObject<{ form?: unknown }>(req.body, 'Richiesta non valida.');
    const tripForm = requireObject<TripForm>(form, 'Dati del viaggio mancanti.');
    const error = validateTripForm(tripForm);
    if (error) throw new HttpError(422, error);
    res.json(normalizePlan(generateItinerary(tripForm)));
  }));

  router.post('/dates/check', handle((req, res) => {
    const body = requireObject<{ itinerary?: unknown; fields?: unknown }>(req.body, 'Richiesta non valida.');
    res.json(checkDateChanges(planFrom(body.itinerary), requireObject<TripDateFields>(body.fields, 'Date mancanti.')));
  }));

  router.post('/dates/apply', handle((req, res) => {
    const body = requireObject<{ itinerary?: unknown; fields?: unknown }>(req.body, 'Richiesta non valida.');
    const plan = planFrom(body.itinerary);
    const fields = requireObject<TripDateFields>(body.fields, 'Date mancanti.');
    const { error } = checkDateChanges(plan, fields);
    if (error) throw new HttpError(422, error);
    res.json(applyDateChanges(plan, fields));
  }));

  router.post('/budget', handle((req, res) => {
    const body = requireObject<{ itinerary?: unknown; fields?: unknown }>(req.body, 'Richiesta non valida.');
    const fields = requireObject<{ travelers: string; budgetPerTraveler?: string }>(body.fields, 'Budget mancante.');
    const result = confirmBudget(planFrom(body.itinerary), { travelers: String(fields.travelers ?? ''), budgetPerTraveler: fields.budgetPerTraveler });
    if (result.error || !result.plan) throw new HttpError(422, result.error ?? 'Budget non valido.');
    res.json(result.plan);
  }));

  router.post('/origin/preview', handle((req, res) => {
    const body = requireObject<{ itinerary?: unknown; lodging?: unknown }>(req.body, 'Richiesta non valida.');
    res.json(previewOriginRoutes(planFrom(body.itinerary), requireObject<LodgingInfo>(body.lodging ?? {}, 'Alloggio non valido.')));
  }));

  router.post('/origin/confirm', handle((req, res) => {
    const body = requireObject<{ itinerary?: unknown; preview?: unknown }>(req.body, 'Richiesta non valida.');
    const current = requireObject<Itinerary>(body.itinerary, 'Itinerario mancante.');
    const preview = requireObject<Itinerary>(body.preview, 'Anteprima mancante.');
    res.json(confirmOriginRoutes(current, preview));
  }));

  router.post('/finalize', handle((req, res) => {
    const body = requireObject<{ draft?: unknown; dayIndexes?: unknown }>(req.body, 'Richiesta non valida.');
    const dayIndexes = Array.isArray(body.dayIndexes) ? body.dayIndexes.filter((value): value is number => Number.isInteger(value) && value >= 0) : [];
    res.json(finalizeDraft(planFrom(body.draft, 'draft'), dayIndexes));
  }));

  router.post('/reposition', handle((req, res) => {
    const body = requireObject<{ itinerary?: unknown; dayIndex?: unknown; activityIndex?: unknown }>(req.body, 'Richiesta non valida.');
    const plan = planFrom(body.itinerary);
    const day = plan.days[Number(body.dayIndex)];
    if (!day) throw new HttpError(400, 'Giornata non trovata.');
    res.json(proposeRepositioning(day, Number(body.activityIndex)));
  }));

  return router;
}
