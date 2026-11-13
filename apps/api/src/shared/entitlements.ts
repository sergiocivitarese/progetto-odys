import type { Entitlement } from '@odys/domain';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { currentUser } from './auth';
import type { DataStore } from './data';
import { HttpError } from './http';

/**
 * Protegge una funzione con un diritto (da usare dopo `requireAuth`).
 * Il 403 porta il codice `upgrade_required`: il client mostra la pagina di
 * upgrade invece di un errore (TP-10).
 */
export function requireEntitlement(store: DataStore, entitlement: Entitlement): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    store.entitlements(currentUser(res))
      .then((account) => {
        if (!account.entitlements.includes(entitlement)) throw new UpgradeRequired(entitlement);
        next();
      })
      .catch(next);
  };
}

export class UpgradeRequired extends HttpError {
  constructor(readonly entitlement: Entitlement) {
    super(403, 'Questa funzione è inclusa in un piano superiore.', { code: 'upgrade_required', entitlement });
  }
}
