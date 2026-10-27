import { Routes } from '@angular/router';

/** /gruppi: catalogo; /gruppi/:id: dettaglio di un viaggio pubblicato. */
export default [
  { path: '', loadComponent: () => import('./groups.page') },
  { path: ':id', title: 'Viaggio di gruppo · Odys', loadComponent: () => import('./published-trip.page') },
] satisfies Routes;
