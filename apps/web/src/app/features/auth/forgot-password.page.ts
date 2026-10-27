import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { ButtonComponent, NoticeComponent, TextFieldComponent } from '../../shared/ui';
import { AuthLayoutComponent } from './auth-layout.component';

/** Richiesta del link per reimpostare la password. */
@Component({
  selector: 'odys-forgot-password-page',
  imports: [AuthLayoutComponent, ButtonComponent, NoticeComponent, TextFieldComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-forms.scss',
  template: `
    <odys-auth-layout title="Recupera la password" subtitle="Ti inviamo un link per sceglierne una nuova.">
      @if (sent()) {
        <odys-notice tone="success" title="Controlla la tua email">Se esiste un account con <strong>{{ email() }}</strong>, riceverai a breve un link valido per un’ora.</odys-notice>
        <a odysButton variant="secondary" routerLink="/accedi" icon="arrow-left">Torna all’accesso</a>
      } @else {
        <form class="form" (submit)="submit($event)" novalidate>
          <odys-text-field label="Email dell’account" type="email" icon="mail" autocomplete="email" [required]="true" [(value)]="email" />
          @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
          <button odysButton type="submit" size="lg" [block]="true" [loading]="busy()">Invia il link</button>
        </form>
        <p class="switch"><a routerLink="/accedi">Torna all’accesso</a></p>
      }
    </odys-auth-layout>
  `,
})
export default class ForgotPasswordPage implements OnInit {
  private readonly auth = inject(AuthStore);
  readonly emailParam = input<string>(undefined, { alias: 'email' });
  protected readonly email = signal('');
  protected readonly sent = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  ngOnInit(): void {
    this.email.set(this.emailParam() ?? '');
    void this.auth.start();
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email().trim())) {
      this.error.set('Inserisci un indirizzo email valido.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.sendPasswordReset(this.email());
      this.sent.set(true);
    } catch (error) {
      this.error.set((error as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
