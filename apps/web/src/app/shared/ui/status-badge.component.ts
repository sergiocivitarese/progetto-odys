import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DATA_STATE_LABELS, type DataState } from '@odys/domain';
import { IconComponent, type IconName } from './icon.component';

const STATE_ICONS: Record<DataState, IconName> = {
  confermato: 'check-circle',
  simulato: 'copy',
  offline: 'wifi-off',
  'da-verificare': 'alert-triangle',
  mancante: 'minus',
  'da-definire': 'edit',
  'non-disponibile': 'x',
  completata: 'check',
};

/**
 * Badge di affidabilità del dato. Ogni informazione in Odys dichiara il suo
 * stato: il colore non è mai l'unico segnale (sempre icona + testo).
 */
@Component({
  selector: 'odys-status-badge',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': '"badge badge--" + state()', role: 'status' },
  template: `<odys-icon [name]="icon()" [size]="13" [strokeWidth]="2.4" /><span>{{ label() }}</span>@if (detail()) {<span class="detail">· {{ detail() }}</span>}`,
  styles: `
    :host {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 3px 9px; border-radius: var(--radius-pill);
      font-size: var(--text-xs); font-weight: 600; line-height: 1.3; white-space: nowrap;
      border: var(--border-width) solid transparent;
    }
    .detail { font-weight: 500; opacity: 0.8; }
    :host(.badge--confermato) { background: var(--color-accent-soft); color: var(--color-text); border-color: color-mix(in srgb, var(--odys-lime) 70%, #6a7d00); }
    :host(.badge--simulato) { background: var(--color-primary-soft); color: var(--color-link); }
    :host(.badge--offline) { background: var(--color-surface-muted); color: var(--color-text-muted); }
    :host(.badge--da-verificare) { background: var(--color-danger-soft); color: var(--color-danger-text); }
    :host(.badge--mancante) { background: transparent; color: var(--color-danger-text); border-color: var(--color-danger); border-style: dashed; }
    :host(.badge--da-definire) { background: transparent; color: var(--color-text-muted); border-color: var(--color-border-strong); border-style: dashed; }
    :host(.badge--non-disponibile) { background: var(--color-surface-muted); color: var(--color-text-muted); }
    :host(.badge--completata) { background: var(--color-brand-panel); color: var(--odys-lime); }
  `,
})
export class StatusBadgeComponent {
  readonly state = input.required<DataState>();
  readonly detail = input<string>();
  protected readonly icon = computed(() => STATE_ICONS[this.state()]);
  protected readonly label = computed(() => DATA_STATE_LABELS[this.state()]);
}
