import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ButtonComponent, IconComponent, LogoComponent } from '../../../shared/ui';
import { OnboardingStore } from '../../state/onboarding.store';
import { OnboardingDialogComponent } from '../onboarding/onboarding-dialog.component';
import { NAV_ITEMS } from './nav-items';
import { ThemeSwitchComponent } from './theme-switch.component';
import { UserMenuComponent } from './user-menu.component';
import { AuthStore } from '../../auth/auth.store';
import { AccountStore } from '../../state/account.store';
import { ThemeStore } from '../../state/theme.store';

/**
 * Struttura dell'app: header con navigazione su desktop, tab bar in basso su mobile.
 * Le pagine vengono caricate nel <router-outlet>.
 */
@Component({
  selector: 'odys-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LogoComponent, IconComponent, ButtonComponent, OnboardingDialogComponent, ThemeSwitchComponent, UserMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  protected readonly nav = NAV_ITEMS;
  protected readonly onboarding = inject(OnboardingStore);
  // Istanziato qui così il tema salvato viene applicato all'avvio.
  protected readonly theme = inject(ThemeStore);
  private readonly auth = inject(AuthStore);
  // Collega profilo e preferenze alla sessione (tema salvato sull'account).
  private readonly account = inject(AccountStore);

  constructor() {
    void this.auth.start();
  }

  protected onOnboarding(choice: 'completed' | 'skipped'): void {
    this.onboarding.complete(choice);
    this.account.completeOnboarding();
  }
}
