import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { HttpError } from './http';

/** Utente autenticato della richiesta corrente. */
export interface AuthUser {
  id: string;
  email?: string;
  accessToken: string;
}

/** Contratto di autenticazione: oggi Supabase Auth, sostituibile (T-08). */
export interface AuthProvider {
  readonly configured: boolean;
  /** Restituisce l'utente del token, oppure null se il token non è valido o scaduto. */
  verify(accessToken: string): Promise<{ id: string; email?: string } | null>;
  /** Elimina definitivamente l'account (richiede privilegi server). */
  deleteUser(userId: string): Promise<void>;
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

/** Utente della richiesta (impostato da `requireAuth`). */
export function currentUser(res: Response): AuthUser {
  const user = res.locals['user'] as AuthUser | undefined;
  if (!user) throw new HttpError(401, 'Accedi per continuare.');
  return user;
}

/** Protegge le rotte riservate (U-10): senza token valido risponde 401. */
export function requireAuth(auth: AuthProvider): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!auth.configured) {
      next(new HttpError(503, 'Archivio non configurato: imposta Supabase nel file apps/api/.env.'));
      return;
    }
    const token = bearerToken(req);
    if (!token) {
      next(new HttpError(401, 'Accedi per continuare.'));
      return;
    }
    auth.verify(token)
      .then((user) => {
        if (!user) throw new HttpError(401, 'Sessione scaduta: accedi di nuovo.');
        res.locals['user'] = { ...user, accessToken: token } satisfies AuthUser;
        next();
      })
      .catch(next);
  };
}
