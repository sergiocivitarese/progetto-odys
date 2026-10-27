import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../../../shared/ui';

/** Sezione a fisarmonica del planner: numero, titolo, riepilogo e contenuto. */
@Component({
  selector: 'odys-planner-section',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-open]': 'open()' },
  template: `
    <button type="button" class="header" (click)="toggle.emit()" [attr.aria-expanded]="open()" [attr.aria-controls]="'section-' + step()">
      <span class="step">{{ step() }}</span>
      <span class="titles"><span class="title">{{ title() }}</span><span class="hint">{{ hint() }}</span></span>
      <odys-icon [name]="open() ? 'chevron-up' : 'chevron-down'" />
    </button>
    @if (open()) {
      <div class="content" [id]="'section-' + step()"><ng-content /></div>
    }
  `,
  styles: `
    :host { display: block; background: var(--color-surface); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-lg); transition: border-color var(--duration-base); }
    :host(.is-open) { border-color: var(--color-text); }
    .header { display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: 72px; padding: var(--space-3) var(--space-4); border: 0; background: transparent; text-align: left; cursor: pointer; }
    .step { display: grid; place-items: center; width: 34px; height: 34px; flex-shrink: 0; border-radius: var(--radius-pill); background: var(--color-surface-muted); font-family: var(--font-brand); font-weight: 800; }
    :host(.is-open) .step { background: var(--color-accent); color: var(--color-on-accent); }
    .titles { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .title { font-family: var(--font-brand); font-weight: 800; font-size: var(--text-lg); }
    .hint { font-size: var(--text-sm); color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .content { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-2) var(--space-4) var(--space-5); border-top: var(--border-width) solid var(--color-border); padding-top: var(--space-4); }
  `,
})
export class PlannerSectionComponent {
  readonly step = input.required<number>();
  readonly title = input.required<string>();
  readonly hint = input('');
  readonly open = input(false);
  readonly toggle = output<void>();
}
