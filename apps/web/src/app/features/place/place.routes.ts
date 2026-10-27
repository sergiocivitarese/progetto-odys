import { Routes } from '@angular/router';

/** `/luogo/:id?title=&destination=&viaggio=` */
export default [
  { path: ':id', loadComponent: () => import('./place.page') },
] satisfies Routes;
