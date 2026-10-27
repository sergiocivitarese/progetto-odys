import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** Navigazione tra le sezioni dell'amministrazione. */
@Component({
  selector: 'odys-admin-nav',
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav aria-label="Amministrazione">
      <a routerLink="/admin/segnalazioni" routerLinkActive="is-active" ariaCurrentWhenActive="page">Segnalazioni</a>
      <a routerLink="/admin/candidature" routerLinkActive="is-active" ariaCurrentWhenActive="page">Candidature</a>
      <a routerLink="/admin/account" routerLinkActive="is-active" ariaCurrentWhenActive="page">Account</a>
    </nav>
  `,
  styles: `
    nav { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-bottom: var(--space-5); padding: 4px; border-radius: var(--radius-pill); background: var(--color-surface-muted); width: fit-content; max-width: 100%; }
    a { display: inline-flex; align-items: center; min-height: 40px; padding: 0 var(--space-4); border-radius: var(--radius-pill); color: var(--color-text-muted); font-weight: 600; text-decoration: none; }
    a.is-active { background: var(--color-surface); color: var(--color-text); box-shadow: var(--shadow-sm); }
  `,
})
export class AdminNavComponent {}
