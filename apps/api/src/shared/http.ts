import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';

/** Errore applicativo con codice HTTP e messaggio leggibile dall'utente. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Inoltra al gestore errori le eccezioni dei controller asincroni. */
export function handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function requireObject<T = Record<string, unknown>>(value: unknown, message: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, message);
  return value as T;
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Il contenuto inviato è troppo grande.' });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: 'JSON non valido.' });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'Errore interno del server.' });
};
