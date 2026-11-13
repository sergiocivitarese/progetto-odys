import { Routes } from '@angular/router';

/**
 * `/itinerario/:id` apre un viaggio salvato; `/itinerario/bozza` il piano appena generato;
 * `/itinerario/:id/giorno/:giorno` il giorno per ore (TP-05…TP-07).
 */
export default [
  { path: '', pathMatch: 'full', redirectTo: '/viaggi' },
  { path: ':id/giorno/:giorno', title: 'Giorno · Odys', data: { source: 'trip' }, loadComponent: () => import('./day.page') },
  { path: ':id', title: 'Itinerario · Odys', loadComponent: () => import('./itinerary.page') },
] satisfies Routes;
