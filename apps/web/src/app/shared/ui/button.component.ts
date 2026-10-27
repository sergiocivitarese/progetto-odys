import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent, type IconName } from './icon.component';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

/**
 * Bottone Odys. Usa l'attributo su <button> o <a>:
 * `<button odysButton variant="accent" icon="plus">Nuovo viaggio</button>`
 */
@Component({
  selector: 'button[odysButton], a[odysButton]',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'odys-button',
    '[class]': '"odys-button odys-button--" + variant() + " odys-button--" + size() + (block() ? " odys-button--block" : "")',
    '[attr.aria-busy]': 'loading() || null',
  },
  template: `
    @if (loading()) {
      <odys-icon name="loader" class="spin" [size]="iconSize()" />
    } @else if (icon()) {
      <odys-icon [name]="icon()!" [size]="iconSize()" />
    }
    <span class="label"><ng-content /></span>
    @if (trailingIcon()) {
      <odys-icon [name]="trailingIcon()!" [size]="iconSize()" />
    }
  `,
  styles: `
    :host {
      display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
      min-height: 44px; padding: 0 var(--space-5);
      border: var(--border-width) solid transparent; border-radius: var(--radius-pill);
      font-family: var(--font-ui); font-weight: 600; font-size: var(--text-md); line-height: 1;
      text-decoration: none; cursor: pointer; white-space: nowrap;
      transition: background-color var(--duration-fast) var(--ease-out), border-color var(--duration-fast), transform var(--duration-fast);
    }
    :host(:active:not([disabled])) { transform: scale(0.98); }
    :host([disabled]) { opacity: 0.45; cursor: not-allowed; }
    :host(.odys-button--sm) { min-height: 36px; padding: 0 var(--space-4); font-size: var(--text-sm); }
    :host(.odys-button--lg) { min-height: 52px; padding: 0 var(--space-6); font-size: var(--text-lg); }
    :host(.odys-button--block) { display: flex; width: 100%; }
    :host(.odys-button--primary) { background: var(--color-primary); color: var(--color-on-primary); }
    :host(.odys-button--primary:hover:not([disabled])) { background: var(--color-primary-hover); }
    :host(.odys-button--accent) { background: var(--color-accent); color: var(--color-on-accent); }
    :host(.odys-button--accent:hover:not([disabled])) { background: var(--color-accent-hover); }
    :host(.odys-button--secondary) { background: var(--color-surface); color: var(--color-text); border-color: var(--color-border-strong); }
    :host(.odys-button--secondary:hover:not([disabled])) { border-color: var(--color-text); }
    :host(.odys-button--ghost) { background: transparent; color: var(--color-link); padding-inline: var(--space-3); }
    :host(.odys-button--ghost:hover:not([disabled])) { background: var(--color-primary-soft); }
    :host(.odys-button--danger) { background: var(--color-danger); color: var(--color-on-danger); }
    .label { overflow: hidden; text-overflow: ellipsis; }
    .spin { animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `,
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly icon = input<IconName>();
  readonly trailingIcon = input<IconName>();
  readonly block = input(false);
  readonly loading = input(false);
  protected iconSize(): number {
    return this.size() === 'sm' ? 16 : 18;
  }
}
