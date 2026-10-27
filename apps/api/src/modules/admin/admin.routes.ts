import { Router } from 'express';
import { currentUser, requireAuth, type AuthProvider } from '../../shared/auth';
import type { AccountSummary, ApplicationStatus, ReportAction, ReportStatus } from '../../shared/community';
import type { DataStore } from '../../shared/data';
import { handle, HttpError, requireObject } from '../../shared/http';

const STATUSES: ApplicationStatus[] = ['pending', 'approved', 'rejected'];
const REPORT_STATUSES: ReportStatus[] = ['open', 'resolved', 'dismissed'];
const REPORT_ACTIONS: ReportAction[] = ['dismiss', 'none', 'hidden', 'suspended'];
const ROLES: AccountSummary['role'][] = ['traveler', 'coordinator', 'agency', 'admin'];
const ACCOUNT_STATUSES: AccountSummary['status'][] = ['active', 'suspended', 'disabled'];

function note(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `Campo ${field} non valido.`);
  if (value.trim().length > max) throw new HttpError(400, `Il campo ${field} può avere al massimo ${max} caratteri.`);
  return value.trim() || undefined;
}

/**
 * Amministrazione: candidature a coordinatore (G-01), account (G-02),
 * segnalazioni e moderazione dei contenuti (G-03, G-04, S-07).
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

  router.get('/reports', handle(async (req, res) => {
    const status = req.query['status'];
    if (status !== undefined && !REPORT_STATUSES.includes(status as ReportStatus)) throw new HttpError(400, 'Stato non valido.');
    res.json(await store.admin(currentUser(res)).listReports(status as ReportStatus | undefined));
  }));

  router.post('/reports/:id/resolve', handle(async (req, res) => {
    const body = requireObject<{ action?: unknown; note?: unknown }>(req.body ?? {}, 'Richiesta non valida.');
    if (!REPORT_ACTIONS.includes(body.action as ReportAction)) throw new HttpError(400, 'Azione non valida.');
    const updated = await store.admin(currentUser(res)).resolveReport(String(req.params.id), body.action as ReportAction, note(body.note, 'nota', 1000));
    if (!updated) throw new HttpError(404, 'Segnalazione non trovata.');
    res.json(updated);
  }));

  router.get('/accounts', handle(async (req, res) => {
    const query = typeof req.query['q'] === 'string' ? req.query['q'].slice(0, 80) : undefined;
    res.json(await store.admin(currentUser(res)).listAccounts(query));
  }));

  router.patch('/accounts/:id', handle(async (req, res) => {
    const body = requireObject<{ role?: unknown; status?: unknown; note?: unknown }>(req.body, 'Richiesta non valida.');
    if (body.role !== undefined && !ROLES.includes(body.role as AccountSummary['role'])) throw new HttpError(400, 'Ruolo non valido.');
    if (body.status !== undefined && !ACCOUNT_STATUSES.includes(body.status as AccountSummary['status'])) throw new HttpError(400, 'Stato non valido.');
    const updated = await store.admin(currentUser(res)).updateAccount(String(req.params.id), { role: body.role as AccountSummary['role'] | undefined, status: body.status as AccountSummary['status'] | undefined }, note(body.note, 'nota', 600));
    if (!updated) throw new HttpError(404, 'Account non trovato.');
    res.json(updated);
  }));

  return router;
}
