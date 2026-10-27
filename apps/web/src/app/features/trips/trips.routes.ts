import { Routes } from '@angular/router';

export default [
  { path: '', loadComponent: () => import('./trips.page') },
] satisfies Routes;
