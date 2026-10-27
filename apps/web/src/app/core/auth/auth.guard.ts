import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';

/** Pagine riservate (U-10): senza accesso porta al login e poi riporta qui (U-11). */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  await auth.start();
  return auth.isAuthenticated() ? true : router.createUrlTree(['/accedi'], { queryParams: { ritorno: state.url } });
};

/** Le pagine di login e registrazione non servono a chi ha già effettuato l'accesso. */
export const guestGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  await auth.start();
  if (!auth.isAuthenticated()) return true;
  const target = route.queryParamMap.get('ritorno');
  return router.parseUrl(target && target.startsWith('/') && !target.startsWith('//') ? target : '/');
};
