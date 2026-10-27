import { Router } from 'express';
import { currentUser, requireAuth, type AuthProvider } from '../../shared/auth';
import type { ApplicationStatus } from '../../shared/community';
import type { DataStore } from '../../shared/data';
import { handle, HttpError, requireObject } from '../../shared/http';

const STATUSES: ApplicationStatus[] = ['pending', 'approved', 'rejected'];

function note(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `Campo ${field} non valido.`);
  if (value.trim().length > max) throw new HttpError(400, `Il campo ${field} può avere al massimo ${max} caratteri.`);
  return value.trim() || undefined;
}

/**
 * Amministrazione (G-01): valutazione delle candidature a coordinatore.
 * Il ruolo di amministratore si assegna dalla dashboard del database; ogni
 * decisione è verificata e registrata dalle funzioni SQL (S-06).
 */
export function adminRouter(auth: AuthProvider, store: DataStore): Router {
  const router = Router();
  router.use(requireAuth(auth));
  router.use(handle(async (_req, res, next) => {
    if (!(await store.admin(currentUser(res)).isAdmin())) throw new HttpError(403, 'Questa area è riservata agli amministratori.');
    next();
  }));

  router.get('/applications', handle(async (req, res) => {
    const status = req.query['status'];
    if (status !== undefined && !STATUSES.includes(status as ApplicationStatus)) throw new HttpError(400, 'Stato non valido.');
    res.json(await store.admin(currentUser(res)).listApplications(status as ApplicationStatus | undefined));
  }));

  router.post('/applications/:id/:decision', handle(async (req, res) => {
    const decision = String(req.params.decision);
    if (decision !== 'approve' && decision !== 'reject') throw new HttpError(404, 'Azione non disponibile.');
    const body = requireObject<{ adminNote?: unknown; reviewerMessage?: unknown }>(req.body ?? {}, 'Richiesta non valida.');
    const updated = await store.admin(currentUser(res)).decideApplication(
      String(req.params.id), decision === 'approve', note(body.adminNote, 'nota interna', 1000), note(body.reviewerMessage, 'messaggio al candidato', 600));
    if (!updated) throw new HttpError(404, 'Candidatura non trovata.');
    res.json(updated);
  }));

  return router;
}
