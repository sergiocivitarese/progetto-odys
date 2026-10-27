import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ButtonComponent } from './button.component';
import { IconComponent, type IconName } from './icon.component';

/** Stato vuoto: spiega cosa manca e offre l'azione per andare avanti. */
@Component({
  selector: 'odys-empty-state',
  imports: [IconComponent, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="icon"><odys-icon [name]="icon()" [size]="22" /></span>
    <h3>{{ title() }}</h3>
    <p>{{ description() }}</p>
    @if (actionLabel()) {
      <button odysButton variant="secondary" size="sm" trailingIcon="arrow-right" (click)="action.emit()">{{ actionLabel() }}</button>
    }
  `,
  styles: `
    :host {
      display: flex; flex-direction: column; align-items: center; gap: var(--space-2); text-align: center;
      padding: var(--space-8) var(--space-5);
      border: var(--border-width) dashed var(--color-border-strong); border-radius: var(--radius-lg);
      background: color-mix(in srgb, var(--color-surface) 60%, transparent);
    }
    .icon { display: grid; place-items: center; width: 48px; height: 48px; border-radius: var(--radius-md); background: var(--color-accent-soft); color: var(--color-text); margin-bottom: var(--space-1); }
    h3 { font-size: var(--text-lg); }
    p { max-width: 42ch; color: var(--color-text-muted); font-size: var(--text-sm); margin-bottom: var(--space-2); }
  `,
})
export class EmptyStateComponent {
  readonly icon = input<IconName>('compass');
  readonly title = input.required<string>();
  readonly description = input('');
  readonly actionLabel = input<string>();
  readonly action = output<void>();
}
