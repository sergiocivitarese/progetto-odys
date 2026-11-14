import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';
import { entitlementGuard } from './core/auth/entitlement.guard';

/**
 * Mappa delle pagine. Ogni feature è caricata solo quando serve (lazy loading):
 * per aggiungere una sezione crea `features/<nome>/<nome>.routes.ts` e aggiungila qui.
 * Le pagine riservate usano `authGuard` (U-10): senza accesso portano al login e poi tornano qui.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', title: 'Esplora · Odys', loadComponent: () => import('./features/discover/discover.page') },
  { path: 'cerca', title: 'Cerca un viaggio · Odys', loadComponent: () => import('./features/discover/search.page') },
  { path: 'prenota/:id', title: 'Blocca il tuo posto · Odys', canActivate: [authGuard], loadComponent: () => import('./features/booking/checkout.page') },
  { path: 'prossimo-viaggio', title: 'Prossimo viaggio · Odys', canActivate: [authGuard], loadComponent: () => import('./features/booking/next-trip.page') },
  { path: 'crea', title: 'Crea il tuo itinerario · Odys', canActivate: [entitlementGuard('ai.generate')], loadComponent: () => import('./features/generator/generator.page') },
  { path: 'split', title: 'Cassa comune · Odys', canActivate: [entitlementGuard('split.use')], loadComponent: () => import('./features/split/split.page') },
  { path: 'dati', title: 'Dati · Odys', canActivate: [entitlementGuard('analytics.coordinator')], loadComponent: () => import('./features/coordinator/coordinator-data.page') },
  { path: 'salvati', title: 'Salvati · Odys', canActivate: [authGuard], loadComponent: () => import('./features/discover/saved.page') },
  { path: 'pianifica', title: 'Pianifica il viaggio · Odys', loadChildren: () => import('./features/planner/planner.routes') },
  { path: 'viaggi', title: 'I miei viaggi · Odys', canActivate: [authGuard], loadChildren: () => import('./features/trips/trips.routes') },
  { path: 'itinerario', loadChildren: () => import('./features/itinerary/itinerary.routes') },
  { path: 'luogo', title: 'Luogo · Odys', loadChildren: () => import('./features/place/place.routes') },
  // Il giorno per ore di un viaggio di gruppo (TP-05…TP-07): stessa pagina dei viaggi personali.
  { path: 'gruppi/:id/giorno/:giorno', title: 'Giorno · Odys', data: { source: 'group' }, loadComponent: () => import('./features/itinerary/day.page') },
  { path: 'gruppi', title: 'Viaggi di gruppo · Odys', loadChildren: () => import('./features/groups/groups.routes') },
  { path: 'esplora', loadChildren: () => import('./features/explore/explore.routes') },
  { path: 'studio', canActivate: [authGuard], loadChildren: () => import('./features/studio/studio.routes') },
  { path: 'coordinatori/:id', title: 'Coordinatore · Odys', loadComponent: () => import('./features/coordinators/coordinator-profile.page') },
  { path: 'coordinatore', canActivate: [authGuard], loadChildren: () => import('./features/coordinator/coordinator.routes') },
  { path: 'admin', pathMatch: 'full', redirectTo: 'admin/segnalazioni' },
  { path: 'admin/segnalazioni', title: 'Segnalazioni · Odys', canActivate: [authGuard], loadComponent: () => import('./features/admin/reports.page') },
  { path: 'admin/account', title: 'Account · Odys', canActivate: [authGuard], loadComponent: () => import('./features/admin/accounts.page') },
  { path: 'segnala', title: 'Segnala · Odys', canActivate: [authGuard], loadComponent: () => import('./features/report/report.page') },
  { path: 'admin/candidature', title: 'Candidature · Odys', canActivate: [authGuard], loadComponent: () => import('./features/admin/applications.page') },
  { path: 'accedi', loadChildren: () => import('./features/auth/auth.routes') },
  { path: 'registrati', title: 'Registrati · Odys', canActivate: [guestGuard], loadComponent: () => import('./features/auth/register.page') },
  { path: 'account', title: 'Il tuo account · Odys', canActivate: [authGuard], loadComponent: () => import('./features/account/account.page') },
  { path: 'premium', title: 'Passa a Premium · Odys', loadComponent: () => import('./features/premium/premium.page') },
  { path: 'in-arrivo/:sezione', title: 'In arrivo · Odys', loadComponent: () => import('./features/premium/coming-soon.page') },
  { path: 'privacy', title: 'Informativa privacy · Odys', data: { kind: 'privacy' }, loadComponent: () => import('./features/legal/legal.page') },
  { path: 'termini', title: 'Termini di servizio · Odys', data: { kind: 'termini' }, loadComponent: () => import('./features/legal/legal.page') },
  { path: '**', title: 'Pagina non trovata · Odys', loadComponent: () => import('./features/not-found/not-found.page') },
];
