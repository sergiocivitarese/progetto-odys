import { Routes } from '@angular/router';

/** /gruppi/:id: dettaglio di un viaggio pubblicato; il catalogo ora è la ricerca (/cerca). */
export default [
  { path: '', pathMatch: 'full', redirectTo: '/cerca' },
  { path: ':id', title: 'Viaggio di gruppo · Odys', loadComponent: () => import('./published-trip.page') },
] satisfies Routes;
