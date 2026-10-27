import { Router } from 'express';
import { currentUser, requireAuth, type AuthProvider } from '../../shared/auth';
import type { ReportReason, ReportTarget } from '../../shared/community';
import type { DataStore } from '../../shared/data';
import { handle, HttpError, requireObject } from '../../shared/http';

const TARGETS: ReportTarget[] = ['post', 'published_trip', 'profile'];
const REASONS: ReportReason[] = ['spam', 'inappropriate', 'misleading', 'copyright', 'safety', 'other'];

/** Segnalazioni degli utenti su post, viaggi e profili (S-07, G-04). Richiede l'accesso. */
export function reportsRouter(auth: AuthProvider, store: DataStore): Router {
  const router = Router();
  router.use(requireAuth(auth));

  router.post('/', handle(async (req, res) => {
    const body = requireObject<Record<string, unknown>>(req.body, 'Richiesta non valida.');
    if (!TARGETS.includes(body['targetKind'] as ReportTarget)) throw new HttpError(400, 'Contenuto da segnalare non valido.');
    if (typeof body['targetId'] !== 'string' || !/^[0-9a-f-]{36}$/i.test(body['targetId'])) throw new HttpError(400, 'Contenuto da segnalare non valido.');
    if (!REASONS.includes(body['reason'] as ReportReason)) throw new HttpError(422, 'Scegli il motivo della segnalazione.');
    const details = typeof body['details'] === 'string' ? body['details'].trim().slice(0, 1000) : undefined;
    if (body['reason'] === 'other' && !details) throw new HttpError(422, 'Descrivi brevemente il problema.');
    const user = currentUser(res);
    const report = await store.reports(user).create({ targetKind: body['targetKind'] as ReportTarget, targetId: body['targetId'], reason: body['reason'] as ReportReason, details: details || undefined });
    await store.account(user).record({ action: 'report.create', entity: report.targetKind, entityId: report.targetId });
    res.status(201).json(report);
  }));

  return router;
}
