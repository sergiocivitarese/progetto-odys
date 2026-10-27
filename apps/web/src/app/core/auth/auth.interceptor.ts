import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';
import { API_BASE_URL } from '../api/api-client';
import { AuthStore } from './auth.store';

/** Aggiunge il token di sessione alle chiamate verso il backend Odys (escluso /config). */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const base = inject(API_BASE_URL);
  if (!req.url.startsWith(base) || req.url.endsWith('/config')) return next(req);
  const auth = inject(AuthStore);
  return from(auth.accessToken()).pipe(
    switchMap((token) => next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req)),
  );
};
