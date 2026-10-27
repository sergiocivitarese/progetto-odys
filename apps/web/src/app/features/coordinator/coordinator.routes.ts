import { Routes } from '@angular/router';

/** Area coordinatore: /coordinatore (elenco), /coordinatore/nuovo, /coordinatore/:id, /coordinatore/:id/partecipanti. */
export default [
  { path: '', title: 'Area coordinatore · Odys', loadComponent: () => import('./coordinator-dashboard.page') },
  { path: 'nuovo', title: 'Nuovo viaggio pubblicato · Odys', loadComponent: () => import('./published-trip-editor.page') },
  { path: ':id/partecipanti', title: 'Partecipanti · Odys', loadComponent: () => import('./participants.page') },
  { path: ':id', title: 'Viaggio pubblicato · Odys', loadComponent: () => import('./published-trip-editor.page') },
] satisfies Routes;
