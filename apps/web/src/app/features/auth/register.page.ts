import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { passwordProblem, safeReturnUrl } from '../../core/auth/auth-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { ButtonComponent, IconComponent, NoticeComponent, TextFieldComponent } from '../../shared/ui';
import { AuthLayoutComponent } from './auth-layout.component';
import { AuthUnavailableComponent } from './auth-unavailable.component';

/** Età in anni compiuti alla data di oggi. */
function ageOf(birthDate: string, today = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1;
  return age;
}

/**
 * Registrazione (U-13, S-04, S-05): dati minimi, maggiore età, consensi
 * obbligatori e facoltativi, verifica dell'email.
 */
@Component({
  selector: 'odys-register-page',
  imports: [AuthLayoutComponent, AuthUnavailableComponent, ButtonComponent, IconComponent, NoticeComponent, TextFieldComponent, RouterLink, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './register.page.html',
  styleUrl: './auth-forms.scss',
})
export default class RegisterPage {
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  readonly ritorno = input<string>();

  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  protected readonly birthDate = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly passwordConfirm = signal('');
  protected readonly acceptTerms = signal(false);
  protected readonly marketing = signal(false);

  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly sentTo = signal<string | null>(null);
  protected readonly resent = signal(false);
  protected readonly maxBirthDate = computed(() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 18);
    return date.toISOString().slice(0, 10);
  });

  constructor() {
    void this.auth.start();
  }

  private validate(): string | null {
    if (!this.firstName().trim() || !this.lastName().trim()) return 'Inserisci nome e cognome.';
    const age = ageOf(this.birthDate());
    if (age === null) return 'Inserisci la data di nascita.';
    if (age < 18) return 'Per usare Odys devi avere almeno 18 anni.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email().trim())) return 'Inserisci un indirizzo email valido.';
    const weak = passwordProblem(this.password());
    if (weak) return weak;
    if (this.password() !== this.passwordConfirm()) return 'Le due password non coincidono.';
    if (!this.acceptTerms()) return 'Per creare l’account devi accettare Termini e Informativa privacy.';
    return null;
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const problem = this.validate();
    if (problem) {
      this.error.set(problem);
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const returnUrl = safeReturnUrl(this.ritorno());
      const { needsConfirmation } = await this.auth.signUp({
        firstName: this.firstName(), lastName: this.lastName(), birthDate: this.birthDate(),
        email: this.email(), password: this.password(), marketingOptIn: this.marketing(), returnUrl,
      });
      if (needsConfirmation) this.sentTo.set(this.email().trim());
      else await this.router.navigateByUrl(returnUrl, { replaceUrl: true });
    } catch (error) {
      this.error.set((error as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async resend(): Promise<void> {
    const email = this.sentTo();
    if (!email) return;
    try {
      await this.auth.resendConfirmation(email);
      this.resent.set(true);
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }
}
