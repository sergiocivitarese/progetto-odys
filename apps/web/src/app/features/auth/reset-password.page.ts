import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { passwordProblem } from '../../core/auth/auth-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { ButtonComponent, IconComponent, NoticeComponent, TextFieldComponent } from '../../shared/ui';
import { AuthLayoutComponent } from './auth-layout.component';

/** Pagina aperta dal link di recupero: imposta la nuova password. */
@Component({
  selector: 'odys-reset-password-page',
  imports: [AuthLayoutComponent, ButtonComponent, IconComponent, NoticeComponent, TextFieldComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-forms.scss',
  template: `
    <odys-auth-layout title="Scegli una nuova password">
      @if (auth.status() === 'loading') {
        <p class="muted"><odys-icon name="loader" /> Verifica del link in corso…</p>
      } @else if (!auth.isAuthenticated()) {
        <odys-notice tone="warning" title="Link non valido o scaduto">Richiedi un nuovo link per reimpostare la password.</odys-notice>
        <a odysButton routerLink="/accedi/password-dimenticata" icon="mail">Richiedi un nuovo link</a>
      } @else {
        <form class="form" (submit)="submit($event)" novalidate>
          <odys-text-field label="Nuova password" type="password" icon="lock" autocomplete="new-password" [required]="true" hint="Almeno 8 caratteri, con lettere e numeri." [(value)]="password" />
          <odys-text-field label="Ripeti la nuova password" type="password" icon="lock" autocomplete="new-password" [required]="true" [(value)]="confirm" />
          @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
          <button odysButton type="submit" size="lg" [block]="true" [loading]="busy()" [disabled]="!canSubmit()">Salva la nuova password</button>
        </form>
      }
    </odys-auth-layout>
  `,
})
export default class ResetPasswordPage {
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  protected readonly password = signal('');
  protected readonly confirm = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly canSubmit = computed(() => !!this.password() && !!this.confirm());

  constructor() {
    void this.auth.start();
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const problem = passwordProblem(this.password()) ?? (this.password() !== this.confirm() ? 'Le due password non coincidono.' : null);
    if (problem) { this.error.set(problem); return; }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.updatePassword(this.password());
      await this.router.navigate(['/account'], { queryParams: { avviso: 'password' }, replaceUrl: true });
    } catch (error) {
      this.error.set((error as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
