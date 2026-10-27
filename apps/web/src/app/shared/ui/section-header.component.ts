import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Titolo di sezione con meta/azione opzionale a destra (contenuto proiettato). */
@Component({
  selector: 'odys-section-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      @if (eyebrow()) {<p class="eyebrow">{{ eyebrow() }}</p>}
      <h2>{{ title() }}</h2>
    </div>
    <div class="aside"><ng-content /></div>
  `,
  styles: `
    :host { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--space-2) var(--space-4); margin: var(--space-8) 0 var(--space-4); }
    h2 { font-size: var(--text-xl); }
    .aside { display: flex; align-items: center; gap: var(--space-2); color: var(--color-text-muted); font-size: var(--text-sm); white-space: nowrap; }
    .aside:empty { display: none; }
  `,
})
export class SectionHeaderComponent {
  readonly title = input.required<string>();
  readonly eyebrow = input<string>();
}
