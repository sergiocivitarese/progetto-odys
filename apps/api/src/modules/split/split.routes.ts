import { Router } from 'express';
import { SPLIT_CATEGORIES, splitEqually, summarizeSplit, type SplitCategory } from '@odys/domain';
import { currentUser, requireAuth, type AuthProvider } from '../../shared/auth';
import type { DataStore } from '../../shared/data';
import { requireEntitlement } from '../../shared/entitlements';
import { handle, HttpError, requireObject } from '../../shared/http';

function cents(value: unknown): number {
  const amount = Number(typeof value === 'string' ? value.replace(',', '.') : value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new HttpError(400, 'Importo non valido.');
  return Math.round(amount * 100);
}

/**
 * Split delle spese (TP-09): cassa comune del gruppo di un viaggio.
 * Le quote e il saldo semplificato li calcola il server, mai il client.
 */
export function splitRouter(auth: AuthProvider, store: DataStore): Router {
  const router = Router();
  router.use(requireAuth(auth), requireEntitlement(store, 'split.use'));
  const repo = (res: Parameters<typeof currentUser>[0]) => store.split(currentUser(res));

  router.get('/', handle(async (_req, res) => res.json(await repo(res).groups())));

  /** Cassa del viaggio: membri, spese e riepilogo per chi guarda. */
  const view = async (res: Parameters<typeof currentUser>[0], tripId: string) => {
    const split = repo(res);
    const members = await split.members(tripId);
    const [expenses, trips] = await Promise.all([split.expenses(tripId), store.catalog(currentUser(res)).getMany([tripId])]);
    const ids = members.map((member) => member.userId);
    return { trip: trips[0] ?? null, members, expenses, summary: summarizeSplit(expenses, ids, currentUser(res).id) };
  };

  router.get('/:tripId', handle(async (req, res) => res.json(await view(res, String(req.params.tripId)))));

  router.post('/:tripId/expenses', handle(async (req, res) => {
    const tripId = String(req.params.tripId);
    const body = requireObject<{ description?: unknown; category?: unknown; amount?: unknown; paidBy?: unknown; among?: unknown }>(req.body, 'Richiesta non valida.');
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!description || description.length > 120) throw new HttpError(400, 'Scrivi una descrizione (al massimo 120 caratteri).');
    const category = body.category as SplitCategory;
    if (!SPLIT_CATEGORIES.includes(category) || category === 'settlement') throw new HttpError(400, 'Categoria non valida.');
    const user = currentUser(res);
    const paidBy = typeof body.paidBy === 'string' ? body.paidBy : user.id;
    if (!Array.isArray(body.among) || !body.among.every((id) => typeof id === 'string')) throw new HttpError(400, 'Scegli con chi dividere la spesa.');
    const amountCents = cents(body.amount);
    let shares;
    try { shares = splitEqually(amountCents, body.among as string[]); } catch (error) { throw new HttpError(400, (error as Error).message); }
    await repo(res).add(tripId, { description, category, amountCents, paidBy, shares });
    res.status(201).json(await view(res, tripId));
  }));

  // «Salda ora»: rimborso del debito verso un membro (una spesa di categoria settlement).
  router.post('/:tripId/settle', handle(async (req, res) => {
    const tripId = String(req.params.tripId);
    const body = requireObject<{ to?: unknown; amount?: unknown }>(req.body, 'Richiesta non valida.');
    if (typeof body.to !== 'string') throw new HttpError(400, 'Indica a chi restituisci.');
    const user = currentUser(res);
    if (body.to === user.id) throw new HttpError(400, 'Non puoi rimborsare te stesso.');
    const amountCents = cents(body.amount);
    await repo(res).add(tripId, { description: 'Rimborso', category: 'settlement', amountCents, paidBy: user.id, shares: [{ userId: body.to, amountCents }] });
    res.status(201).json(await view(res, tripId));
  }));

  router.delete('/expenses/:id', handle(async (req, res) => {
    await repo(res).remove(String(req.params.id));
    res.status(204).end();
  }));

  return router;
}
