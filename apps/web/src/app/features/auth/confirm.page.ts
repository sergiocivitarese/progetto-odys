import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { safeReturnUrl } from '../../core/auth/auth-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { ButtonComponent, IconComponent, NoticeComponent } from '../../shared/ui';
import { AuthLayoutComponent } from './auth-layout.component';

/** Arrivo dal link di conferma email: il client Supabase completa l'accesso dall'URL. */
@Component({
  selector: 'odys-confirm-page',
  imports: [AuthLayoutComponent, ButtonComponent, IconComponent, NoticeComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-forms.scss',
  template: `
    <odys-auth-layout eyebrow="Benvenuto" title="Conferma dell’email">
      @if (auth.status() === 'loading') {
        <p class="muted"><odys-icon name="loader" /> Attivazione dell’account…</p>
      } @else if (auth.isAuthenticated()) {
        <odys-notice tone="success" title="Account attivo">La tua email è confermata e hai già effettuato l’accesso.</odys-notice>
        <button odysButton variant="accent" size="lg" icon="arrow-right" (click)="continue()">Continua</button>
      } @else if (auth.linkError()) {
        <odys-notice tone="warning" title="Link non più valido">{{ auth.linkError() }} Se avevi già confermato l’email, accedi con email e password; altrimenti registrati di nuovo per ricevere un nuovo link.</odys-notice>
        <a odysButton routerLink="/accedi" [queryParams]="{ ritorno: ritorno() || null }" icon="arrow-right">Vai all’accesso</a>
      } @else {
        <odys-notice tone="success" title="Email confermata">Il tuo account è attivo. Accedi con email e password per continuare.</odys-notice>
        <a odysButton variant="accent" routerLink="/accedi" [queryParams]="{ ritorno: ritorno() || null }" icon="arrow-right">Accedi</a>
      }
    </odys-auth-layout>
  `,
})
export default class ConfirmPage {
  protected readonly auth = inject(AuthStore);
  readonly ritorno = input<string>();

  constructor() {
    void this.auth.start();
  }

  private readonly router = inject(Router);

  protected continue(): void {
    void this.router.navigateByUrl(safeReturnUrl(this.ritorno()), { replaceUrl: true });
  }
}
