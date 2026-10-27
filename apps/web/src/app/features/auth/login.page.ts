import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { safeReturnUrl } from '../../core/auth/auth-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { ButtonComponent, NoticeComponent, TextFieldComponent } from '../../shared/ui';
import { AuthLayoutComponent } from './auth-layout.component';
import { AuthUnavailableComponent } from './auth-unavailable.component';

/** Accesso con email e password; poi riporta l'utente dove si trovava (U-11). */
@Component({
  selector: 'odys-login-page',
  imports: [AuthLayoutComponent, AuthUnavailableComponent, ButtonComponent, NoticeComponent, TextFieldComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <odys-auth-layout title="Accedi a Odys" [subtitle]="reason() ? reasonText() : 'Bentornato! Inserisci i tuoi dati per continuare.'">
      @if (!auth.available() && auth.status() === 'ready') {
        <odys-auth-unavailable />
      } @else {
        <form class="form" (submit)="submit($event)" novalidate>
          <odys-text-field label="Email" type="email" icon="mail" autocomplete="email" [required]="true" [(value)]="email" placeholder="nome@esempio.it" />
          <odys-text-field label="Password" type="password" icon="lock" autocomplete="current-password" [required]="true" [(value)]="password" />
          <a class="link" [routerLink]="['/accedi/password-dimenticata']" [queryParams]="{ email: email() || null }">Hai dimenticato la password?</a>
          @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
          <button odysButton type="submit" size="lg" [block]="true" [loading]="busy()">Accedi</button>
        </form>
        <p class="switch">Non hai un account? <a [routerLink]="['/registrati']" [queryParams]="{ ritorno: ritorno() || null }">Registrati gratis</a></p>
      }
    </odys-auth-layout>
  `,
  styles: `
    .form { display: flex; flex-direction: column; gap: var(--space-4); }
    .link { align-self: flex-start; font-size: var(--text-sm); margin-top: calc(var(--space-2) * -1); }
    .switch { color: var(--color-text-muted); text-align: center; }
  `,
})
export default class LoginPage {
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  /** Pagina da riaprire dopo l'accesso (query `?ritorno=`). */
  readonly ritorno = input<string>();
  /** Motivo dell'accesso richiesto (query `?motivo=salva`). */
  readonly reason = input<string>(undefined, { alias: 'motivo' });

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly reasonText = computed(() => this.reason() === 'salva'
    ? 'Accedi per salvare il viaggio: lo ritroverai in “I miei viaggi”, con tutte le versioni.'
    : 'Accedi per continuare da dove eri rimasto.');

  constructor() {
    void this.auth.start();
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.email().trim() || !this.password()) {
      this.error.set('Inserisci email e password.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.signIn(this.email(), this.password());
      await this.router.navigateByUrl(safeReturnUrl(this.ritorno()), { replaceUrl: true });
    } catch (error) {
      this.error.set((error as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
