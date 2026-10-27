import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent, type IconName } from './icon.component';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const TONE_ICONS: Record<NoticeTone, IconName> = { info: 'info', success: 'check-circle', warning: 'alert-triangle', danger: 'alert-circle' };

/** Messaggio in pagina (esito salvataggio, errori, avvisi). */
@Component({
  selector: 'odys-notice',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': '"notice notice--" + tone()', '[attr.role]': 'tone() === "danger" ? "alert" : "status"' },
  template: `
    <odys-icon [name]="icon() ?? defaultIcon()" [size]="18" />
    <div class="body">
      @if (title()) {<strong>{{ title() }}</strong>}
      <div class="content"><ng-content /></div>
    </div>
  `,
  styles: `
    :host { display: flex; gap: var(--space-3); align-items: flex-start; padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); font-size: var(--text-sm); border: var(--border-width) solid transparent; }
    .body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .content { color: inherit; }
    :host(.notice--info) { background: var(--color-primary-soft); color: var(--color-text); }
    :host(.notice--info) odys-icon { color: var(--color-link); }
    :host(.notice--success) { background: var(--color-accent-soft); color: var(--color-text); }
    :host(.notice--warning) { background: var(--color-surface); border-color: var(--color-border-strong); color: var(--color-text); }
    :host(.notice--warning) odys-icon { color: var(--color-danger-text); }
    :host(.notice--danger) { background: var(--color-danger-soft); color: var(--color-danger-text); }
  `,
})
export class NoticeComponent {
  readonly tone = input<NoticeTone>('info');
  readonly title = input<string>();
  readonly icon = input<IconName>();
  protected readonly defaultIcon = computed(() => TONE_ICONS[this.tone()]);
}
