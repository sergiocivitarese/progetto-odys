import { Routes } from '@angular/router';

/** Creator Studio: /studio (bacheca privata) e /studio/:id (editor e dettaglio del post). */
export default [
  { path: '', title: 'Creator Studio · Odys', loadComponent: () => import('./studio-board.page') },
  { path: ':id', title: 'Post · Creator Studio · Odys', loadComponent: () => import('./post-editor.page') },
] satisfies Routes;
