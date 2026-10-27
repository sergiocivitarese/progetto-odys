import { Routes } from '@angular/router';

export default [
  { path: '', loadComponent: () => import('./planner.page') },
] satisfies Routes;
