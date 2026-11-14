import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IconComponent, LogoComponent } from '../../../shared/ui';
import { OnboardingStore } from '../../state/onboarding.store';
import { OnboardingDialogComponent } from '../onboarding/onboarding-dialog.component';
import { navigationFor, shortLabel } from './nav-items';
import { EntitlementsStore } from '../../state/entitlements.store';
import { ThemeSwitchComponent } from './theme-switch.component';
import { UserMenuComponent } from './user-menu.component';
import { AuthStore } from '../../auth/auth.store';
import { AccountStore } from '../../state/account.store';
import { ThemeStore } from '../../state/theme.store';

/**
 * Struttura dell'app: header con navigazione su desktop, barra a pillola in basso su mobile.
 * Le voci cambiano con il ruolo (specifiche per ruolo, «Navigazione per ruolo»).
 * Le pagine vengono caricate nel <router-outlet>.
 */
@Component({
  selector: 'odys-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LogoComponent, IconComponent, OnboardingDialogComponent, ThemeSwitchComponent, UserMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  private readonly entitlements = inject(EntitlementsStore);
  /** Voci della barra: dipendono dai diritti dell'utente, non dal nome del piano. */
  protected readonly nav = computed(() => {
    this.entitlements.entitlements();
    return navigationFor((key) => this.entitlements.has(key));
  });
  protected readonly short = shortLabel;
  /** Senza rete l'app mostra le pagine salvate dal service worker (lettura offline). */
  protected readonly offline = signal(typeof navigator !== 'undefined' && !navigator.onLine);
  protected readonly onboarding = inject(OnboardingStore);
  // Istanziato qui così il tema salvato viene applicato all'avvio.
  protected readonly theme = inject(ThemeStore);
  private readonly auth = inject(AuthStore);
  // Collega profilo e preferenze alla sessione (tema salvato sull'account).
  private readonly account = inject(AccountStore);

  constructor() {
    const update = () => this.offline.set(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    inject(DestroyRef).onDestroy(() => { window.removeEventListener('online', update); window.removeEventListener('offline', update); });
    void this.auth.start();
  }

  protected onOnboarding(choice: 'completed' | 'skipped'): void {
    this.onboarding.complete(choice);
    this.account.completeOnboarding();
  }
}
