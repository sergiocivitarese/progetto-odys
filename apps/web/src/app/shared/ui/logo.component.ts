import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Logo Odys — concept 5 "The Compass": la "O" a fumetto con la stella lime al centro.
 * `variant="mark"` mostra solo il simbolo (app icon), `wordmark` il logotipo completo.
 */
@Component({
  selector: 'odys-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': '"Odys"' },
  template: `
    @if (variant() === 'mark') {
      <svg viewBox="0 0 64 64" [attr.width]="size()" [attr.height]="size()">
        <rect width="64" height="64" rx="16" fill="var(--logo-tile, #111111)" />
        <path d="M32 12a20 20 0 1 1-13.2 35L10 54l3.4-11.6A20 20 0 0 1 32 12Zm0 9a11 11 0 1 0 0 22 11 11 0 0 0 0-22Z" fill="var(--logo-ink-inverse, #F8F7F3)" />
        <path d="M32 24.5c.7 3.8 2.7 5.8 6.5 6.5-3.8.7-5.8 2.7-6.5 6.5-.7-3.8-2.7-5.8-6.5-6.5 3.8-.7 5.8-2.7 6.5-6.5Z" fill="#D8F64E" />
      </svg>
    } @else {
      <svg viewBox="0 0 172 56" [attr.height]="size()" class="wordmark">
        <path d="M27 6a22 22 0 1 1-14.4 38.6L4 52l3.6-12.4A22 22 0 0 1 27 6Zm0 10.5a11.5 11.5 0 1 0 0 23 11.5 11.5 0 0 0 0-23Z" fill="currentColor" />
        <path d="M27 20c.8 4.3 2.7 6.2 7 7-4.3.8-6.2 2.7-7 7-.8-4.3-2.7-6.2-7-7 4.3-.8 6.2-2.7 7-7Z" fill="#D8F64E" />
        <text x="52" y="41" font-family="Plus Jakarta Sans, Inter, sans-serif" font-weight="800" font-style="italic" font-size="42" letter-spacing="-2" fill="currentColor">dys</text>
      </svg>
    }
  `,
  styles: `:host { display: inline-flex; color: var(--color-text); } .wordmark { width: auto; }`,
})
export class LogoComponent {
  readonly variant = input<'wordmark' | 'mark'>('wordmark');
  readonly size = input(32);
}
