import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';

/**
 * Mappa delle pagine. Ogni feature è caricata solo quando serve (lazy loading):
 * per aggiungere una sezione crea `features/<nome>/<nome>.routes.ts` e aggiungila qui.
 * Le pagine riservate usano `authGuard` (U-10): senza accesso portano al login e poi tornano qui.
 */
export const routes: Routes = [
  { path: '', title: 'Odys — Plan. Discover. Experience.', loadChildren: () => import('./features/home/home.routes') },
  { path: 'pianifica', title: 'Pianifica il viaggio · Odys', loadChildren: () => import('./features/planner/planner.routes') },
  { path: 'viaggi', title: 'I miei viaggi · Odys', canActivate: [authGuard], loadChildren: () => import('./features/trips/trips.routes') },
  { path: 'itinerario', loadChildren: () => import('./features/itinerary/itinerary.routes') },
  { path: 'luogo', title: 'Luogo · Odys', loadChildren: () => import('./features/place/place.routes') },
  { path: 'gruppi', title: 'Viaggi di gruppo · Odys', loadChildren: () => import('./features/groups/groups.routes') },
  { path: 'esplora', loadChildren: () => import('./features/explore/explore.routes') },
  { path: 'studio', canActivate: [authGuard], loadChildren: () => import('./features/studio/studio.routes') },
  { path: 'coordinatori/:id', title: 'Coordinatore · Odys', loadComponent: () => import('./features/coordinators/coordinator-profile.page') },
  { path: 'coordinatore', canActivate: [authGuard], loadChildren: () => import('./features/coordinator/coordinator.routes') },
  { path: 'admin/candidature', title: 'Candidature · Odys', canActivate: [authGuard], loadComponent: () => import('./features/admin/applications.page') },
  { path: 'accedi', loadChildren: () => import('./features/auth/auth.routes') },
  { path: 'registrati', title: 'Registrati · Odys', canActivate: [guestGuard], loadComponent: () => import('./features/auth/register.page') },
  { path: 'account', title: 'Il tuo account · Odys', canActivate: [authGuard], loadComponent: () => import('./features/account/account.page') },
  { path: 'privacy', title: 'Informativa privacy · Odys', data: { kind: 'privacy' }, loadComponent: () => import('./features/legal/legal.page') },
  { path: 'termini', title: 'Termini di servizio · Odys', data: { kind: 'termini' }, loadComponent: () => import('./features/legal/legal.page') },
  { path: '**', title: 'Pagina non trovata · Odys', loadComponent: () => import('./features/not-found/not-found.page') },
];
