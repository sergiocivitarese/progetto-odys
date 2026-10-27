import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '../../auth/auth.store';
import { AccountStore } from '../../state/account.store';
import { ButtonComponent, IconComponent } from '../../../shared/ui';

/** Nell'header: "Accedi" per chi non è collegato, altrimenti avatar con menu. */
@Component({
  selector: 'odys-user-menu',
  imports: [RouterLink, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (auth.isAuthenticated()) {
      <button type="button" class="avatar" (click)="open.set(!open())" [attr.aria-expanded]="open()" aria-haspopup="menu" [attr.aria-label]="'Account di ' + auth.displayName()">
        {{ auth.initials() }}
      </button>
      @if (open()) {
        <div class="menu" role="menu">
          <p class="menu__who"><strong>{{ auth.displayName() }}</strong><span>{{ auth.user()?.email }}</span></p>
          <a role="menuitem" routerLink="/account" (click)="open.set(false)"><odys-icon name="user" [size]="16" /> Il mio account</a>
          <a role="menuitem" routerLink="/viaggi" (click)="open.set(false)"><odys-icon name="bookmark" [size]="16" /> I miei viaggi</a>
          <a role="menuitem" routerLink="/coordinatore" (click)="open.set(false)"><odys-icon name="shield" [size]="16" /> {{ account.isCoordinator() ? 'Area coordinatore' : 'Diventa coordinatore' }}</a>
          @if (account.isCoordinator()) {
            <a role="menuitem" routerLink="/studio" (click)="open.set(false)"><odys-icon name="upload" [size]="16" /> Creator Studio</a>
          }
          @if (account.isAdmin()) {
            <a role="menuitem" routerLink="/admin/candidature" (click)="open.set(false)"><odys-icon name="users" [size]="16" /> Candidature</a>
          }
          <button type="button" role="menuitem" (click)="signOut()"><odys-icon name="log-out" [size]="16" /> Esci</button>
        </div>
      }
    } @else if (auth.status() === 'ready' && auth.available()) {
      <a odysButton variant="secondary" size="sm" routerLink="/accedi" [queryParams]="{ ritorno: router.url === '/' ? null : router.url }" icon="user">Accedi</a>
    }
  `,
  styles: `
    :host { position: relative; display: inline-flex; }
    .avatar { display: grid; place-items: center; width: 40px; height: 40px; border-radius: var(--radius-pill); border: 0; background: var(--color-accent); color: var(--color-on-accent); font-family: var(--font-brand); font-weight: 800; cursor: pointer; }
    .menu { position: absolute; top: calc(100% + 8px); right: 0; z-index: 30; min-width: 240px; display: flex; flex-direction: column; padding: var(--space-2); border-radius: var(--radius-md); background: var(--color-surface); border: var(--border-width) solid var(--color-border); box-shadow: var(--shadow-lg); }
    .menu__who { display: flex; flex-direction: column; padding: var(--space-2) var(--space-3) var(--space-3); border-bottom: var(--border-width) solid var(--color-border); margin-bottom: var(--space-1);
      span { font-size: var(--text-sm); color: var(--color-text-muted); overflow-wrap: anywhere; } }
    .menu a, .menu button { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-text); font: inherit; font-weight: 500; text-decoration: none; text-align: left; cursor: pointer; }
    .menu a:hover, .menu button:hover { background: var(--color-surface-muted); }
  `,
})
export class UserMenuComponent {
  protected readonly auth = inject(AuthStore);
  protected readonly account = inject(AccountStore);
  protected readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly open = signal(false);

  @HostListener('document:click', ['$event'])
  protected closeOutside(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  protected closeOnEscape(): void {
    this.open.set(false);
  }

  protected async signOut(): Promise<void> {
    this.open.set(false);
    await this.auth.signOut();
    await this.router.navigateByUrl('/');
  }
}
