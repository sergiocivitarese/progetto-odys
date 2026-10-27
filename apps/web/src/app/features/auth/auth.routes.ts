import { Routes } from '@angular/router';
import { guestGuard } from '../../core/auth/auth.guard';

/** /accedi … : accesso, recupero password, conferma email. La registrazione è su /registrati. */
export default [
  { path: '', title: 'Accedi · Odys', canActivate: [guestGuard], loadComponent: () => import('./login.page') },
  { path: 'password-dimenticata', title: 'Recupera password · Odys', loadComponent: () => import('./forgot-password.page') },
  { path: 'nuova-password', title: 'Nuova password · Odys', loadComponent: () => import('./reset-password.page') },
  { path: 'conferma', title: 'Email confermata · Odys', loadComponent: () => import('./confirm.page') },
] satisfies Routes;
