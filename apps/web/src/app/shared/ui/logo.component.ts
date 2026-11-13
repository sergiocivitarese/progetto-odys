import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Logo Odys «Orbit Route»: la "O" è un anello aperto con il punto corallo,
 * seguita da "DYS". `variant="mark"` mostra solo l'anello.
 * Il colore dell'anello si cambia con `--logo-ring` (blu su chiaro, lime su scuro).
 */
@Component({
  selector: 'odys-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': '"Odys"' },
  template: `
    <svg [attr.viewBox]="variant() === 'mark' ? '0 0 40 40' : '0 0 132 40'" [attr.height]="size()" class="logo">
      <path d="M31.3 12.2A13.5 13.5 0 1 0 33.5 20" fill="none" stroke="var(--logo-ring)" stroke-width="7.5" stroke-linecap="round" />
      <circle cx="31.5" cy="8.5" r="4.2" fill="var(--odys-coral)" />
      @if (variant() === 'wordmark') {
        <text x="44" y="33" font-family="Inter, system-ui, sans-serif" font-weight="900" font-size="35" letter-spacing="-1.6" fill="currentColor">DYS</text>
      }
    </svg>
  `,
  styles: `:host { display: inline-flex; color: var(--color-text); } .logo { width: auto; overflow: visible; }`,
})
export class LogoComponent {
  readonly variant = input<'wordmark' | 'mark'>('wordmark');
  readonly size = input(32);
}
