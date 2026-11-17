import { Router } from 'express';
import { currentUser, requireAuth, type AuthProvider } from '../../shared/auth';
import type { PaymentKind, PaymentMethod } from '../../shared/community';
import type { DataStore } from '../../shared/data';
import { requireEntitlement } from '../../shared/entitlements';
import { handle, HttpError, requireObject } from '../../shared/http';
import type { PaymentProvider } from '../../shared/payments';

const KINDS: PaymentKind[] = ['deposit', 'balance'];
const METHODS: PaymentMethod[] = ['card', 'wallet'];

/**
 * Prenotazioni con acconto (TB-08…TB-10).
 * Il client avvia il pagamento; la prenotazione avanza solo quando il
 * fornitore conferma l'incasso, mai sulla risposta del client.
 */
export function bookingsRouter(auth: AuthProvider, store: DataStore, payments: PaymentProvider): Router {
  const router = Router();
  router.use(requireAuth(auth));

  /** Prenotazione con il viaggio e i pagamenti: serve a checkout e Prossimo viaggio. */
  const details = async (res: Parameters<typeof currentUser>[0], id: string) => {
    const user = currentUser(res);
    const request = await store.participation(user).get(id);
    if (!request) throw new HttpError(404, 'Prenotazione non trovata.');
    const [trips, list] = await Promise.all([store.catalog(user).getMany([request.tripId]), store.participation(user).payments(id)]);
    return { ...request, trip: trips[0] ?? null, payments: list };
  };

  // Blocca il posto (TB-08): riserva per il tempo del checkout. Serve il diritto di prenotare.
  router.post('/trips/:tripId', requireEntitlement(store, 'trips.book'), handle(async (req, res) => {
    const user = currentUser(res);
    // Canale (AG-07): «direct» se si arriva dal link condiviso fuori da Odys; ogni altro valore vale «odys».
    const channel = (req.body as { channel?: unknown } | undefined)?.channel === 'direct' ? 'direct' : 'odys';
    const request = await store.participation(user).reserve(String(req.params.tripId), channel);
    await store.account(user).record({ action: 'booking.reserve', entity: 'published_trip', entityId: request.tripId });
    res.status(201).json(await details(res, request.id));
  }));

  router.get('/:id', handle(async (req, res) => res.json(await details(res, String(req.params.id)))));

  // Pagamento dell'acconto o del saldo (TB-09, TB-10).
  router.post('/:id/payments', handle(async (req, res) => {
    const body = requireObject<{ kind?: unknown; method?: unknown; acceptTerms?: unknown }>(req.body, 'Richiesta non valida.');
    const kind = body.kind as PaymentKind;
    const method = (body.method ?? 'card') as PaymentMethod;
    if (!KINDS.includes(kind)) throw new HttpError(400, 'Tipo di pagamento non valido.');
    if (!METHODS.includes(method)) throw new HttpError(400, 'Metodo di pagamento non valido.');
    const user = currentUser(res);
    const repo = store.participation(user);
    const payment = await repo.startPayment(String(req.params.id), kind, method, body.acceptTerms === true);
    if (payment.status === 'processing') payments.charge(payment, () => repo.confirmSimulatedPayment(payment.id));
    await store.account(user).record({ action: `payment.${kind}.start`, entity: 'payment', entityId: payment.id });
    res.status(202).json(payment);
  }));

  return router;
}
