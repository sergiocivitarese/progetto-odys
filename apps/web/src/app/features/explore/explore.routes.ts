import { Routes } from '@angular/router';

/** Contenuti dei coordinatori: /esplora (feed) e /esplora/:id (post). */
export default [
  { path: '', title: 'Esplora · Odys', loadComponent: () => import('./explore.page') },
  { path: ':id', title: 'Post · Odys', loadComponent: () => import('./post.page') },
] satisfies Routes;
