import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from './icon.component';

/**
 * Chip selezionabile (filtri, preferenze, opzioni). Usalo su un <button>:
 * `<button odysChip [selected]="x" (click)="...">Arte</button>`
 */
@Component({
  selector: 'button[odysChip]',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { type: 'button', class: 'chip', '[class.chip--selected]': 'selected()', '[attr.aria-pressed]': 'selected()' },
  template: `@if (selected()) {<odys-icon name="check" [size]="14" [strokeWidth]="2.6" />}<ng-content />`,
  styles: `
    :host {
      display: inline-flex; align-items: center; gap: 6px;
      min-height: 38px; padding: 0 var(--space-4);
      border: var(--border-width) solid var(--color-border-strong); border-radius: var(--radius-pill);
      background: var(--color-surface); color: var(--color-text);
      font-size: var(--text-sm); font-weight: 500; cursor: pointer; text-transform: none;
      transition: background-color var(--duration-fast), border-color var(--duration-fast);
    }
    :host(:hover) { border-color: var(--color-text); }
    :host(.chip--selected) { background: var(--color-surface-inverse); color: var(--color-text-inverse); border-color: var(--color-surface-inverse); }
    :host([disabled]) { opacity: 0.45; cursor: not-allowed; }
  `,
})
export class ChipComponent {
  readonly selected = input(false);
}
