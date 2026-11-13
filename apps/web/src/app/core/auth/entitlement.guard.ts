import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { Entitlement } from '@odys/domain';
import { EntitlementsStore } from '../state/entitlements.store';
import { AuthStore } from './auth.store';

/**
 * Pagine legate a un diritto: senza accesso porta al login, senza il diritto
 * porta alla pagina di upgrade — mai a un errore (TP-10).
 */
export function entitlementGuard(entitlement: Entitlement): CanActivateFn {
  return async (_route, state) => {
    const auth = inject(AuthStore);
    const router = inject(Router);
    const entitlements = inject(EntitlementsStore);
    await auth.start();
    if (!auth.isAuthenticated()) return router.createUrlTree(['/accedi'], { queryParams: { ritorno: state.url } });
    await entitlements.refresh();
    return entitlements.has(entitlement) ? true : router.createUrlTree(['/premium'], { queryParams: { funzione: entitlement, ritorno: state.url } });
  };
}
