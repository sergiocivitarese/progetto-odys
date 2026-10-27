import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent, type IconName } from './icon.component';

/** Coppia etichetta/valore con icona (riepiloghi del viaggio). */
@Component({
  selector: 'odys-info-row',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="icon"><odys-icon [name]="icon()" [size]="16" /></span>
    <div><p class="title">{{ title() }}</p><p class="value">{{ value() }}</p></div>
  `,
  styles: `
    :host { display: flex; gap: var(--space-3); align-items: flex-start; min-width: 0; }
    .icon { display: grid; place-items: center; width: 32px; height: 32px; flex-shrink: 0; border-radius: var(--radius-sm); background: var(--info-icon-bg, var(--color-surface-muted)); }
    .title { font-size: var(--text-xs); color: var(--info-muted, var(--color-text-muted)); font-weight: 500; }
    .value { font-size: var(--text-sm); font-weight: 600; overflow-wrap: anywhere; }
  `,
})
export class InfoRowComponent {
  readonly icon = input<IconName>('info');
  readonly title = input.required<string>();
  readonly value = input.required<string>();
}
