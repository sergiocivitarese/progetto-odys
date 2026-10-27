import { Routes } from '@angular/router';

/** `/itinerario/:id` apre un viaggio salvato; `/itinerario/bozza` il piano appena generato. */
export default [
  { path: '', pathMatch: 'full', redirectTo: '/viaggi' },
  { path: ':id', title: 'Itinerario · Odys', loadComponent: () => import('./itinerary.page') },
] satisfies Routes;
