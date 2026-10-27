import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { DataState, WeatherSnapshot } from '@odys/domain';
import { ButtonComponent, IconComponent, StatusBadgeComponent } from '../../../shared/ui';

/** Meteo di una giornata con stato di affidabilità (previsione, clima storico, offline…). */
@Component({
  selector: 'odys-weather-card',
  imports: [ButtonComponent, IconComponent, StatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (record(); as r) {
      <article class="card">
        <button type="button" class="head" (click)="expanded.set(!expanded())" [attr.aria-expanded]="expanded()">
          <span class="icon"><odys-icon [name]="r.status === 'OFFLINE' ? 'wifi-off' : r.status === 'HISTORICAL_CLIMATE' ? 'thermometer' : 'cloud'" /></span>
          <span class="titles"><span class="eyebrow">{{ title() }}</span><span class="node">{{ r.nodeLabel }}</span></span>
          <odys-icon [name]="expanded() ? 'chevron-up' : 'chevron-down'" />
        </button>
        <div class="summary">
          <span class="temp">{{ temperature() }}</span>
          <span>
            <strong>{{ r.conditionDescription ?? (r.status === 'HISTORICAL_CLIMATE' ? 'Temperature tipiche' : 'Condizioni non disponibili') }}</strong>
            <small>{{ r.precipitationMm !== undefined ? 'Piogge ' + r.precipitationMm.toFixed(1) + ' mm' : 'Piogge non disponibili' }} · {{ r.windKmh !== undefined ? 'vento ' + round(r.windKmh) + ' km/h' : 'vento non disponibile' }}</small>
          </span>
        </div>
        <odys-status-badge [state]="state()" [detail]="updated()" />
        @if (r.status === 'HISTORICAL_CLIMATE') {<p class="note">Non è una previsione del giorno specifico.</p>}
        @if (r.status === 'UNAVAILABLE') {<p class="note">Meteo non disponibile offline.</p>}
        @if (alerts().length) {
          <ul class="alerts">
            @for (alert of alerts(); track alert) {<li><odys-icon name="alert-triangle" [size]="14" />{{ alert }}</li>}
          </ul>
        }
        @if (expanded()) {
          <div class="details">
            @if (r.precipitationProbability !== undefined) {<p>Probabilità di pioggia: {{ round(r.precipitationProbability) }}%</p>}
            <p>Data locale: {{ r.localDate }} · fuso: {{ r.timezone }}</p>
            <p>Fonte: {{ r.source }} · provider: {{ r.provider }}</p>
            <p>Licenza: {{ r.license }}</p>
            <p>{{ r.attribution }}</p>
            @if (r.note) {<p>{{ r.note }}</p>}
          </div>
        }
        @if (refreshable()) {
          <button odysButton variant="ghost" size="sm" icon="refresh" [loading]="loading()" (click)="refresh.emit()">{{ loading() ? 'Aggiornamento in corso…' : 'Aggiorna meteo' }}</button>
        }
      </article>
    } @else {
      <article class="card card--empty">
        <span class="icon"><odys-icon name="cloud-off" /></span>
        <div>
          <strong>Meteo non disponibile</strong>
          <p class="note">Questo giorno non ha ancora un luogo con coordinate confermate. Il piano resta utilizzabile.</p>
          <odys-status-badge state="non-disponibile" />
        </div>
      </article>
    }
  `,
  styles: `
    .card { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); }
    .card--empty { flex-direction: row; align-items: flex-start; }
    .card--empty strong { display: block; margin-bottom: 2px; }
    .card--empty odys-status-badge { margin-top: var(--space-2); }
    .head { display: flex; align-items: center; gap: var(--space-3); border: 0; background: transparent; padding: 0; text-align: left; cursor: pointer; }
    .icon { display: grid; place-items: center; width: 36px; height: 36px; flex-shrink: 0; border-radius: var(--radius-sm); background: var(--color-primary-soft); color: var(--color-link); }
    .titles { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .node { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .summary { display: flex; align-items: center; gap: var(--space-4); }
    .summary strong { display: block; font-size: var(--text-sm); }
    .summary small { color: var(--color-text-muted); font-size: var(--text-xs); }
    .temp { font-family: var(--font-brand); font-weight: 800; font-size: var(--text-2xl); }
    .note { font-size: var(--text-xs); color: var(--color-text-muted); }
    .alerts { list-style: none; margin: 0; padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); border-radius: var(--radius-md); background: var(--color-danger-soft); font-size: var(--text-sm); }
    .alerts li { display: flex; gap: var(--space-2); align-items: flex-start; }
    .alerts odys-icon { color: var(--color-danger-text); margin-top: 3px; }
    .details { display: flex; flex-direction: column; gap: 2px; padding-top: var(--space-3); border-top: var(--border-width) solid var(--color-border); font-size: var(--text-xs); color: var(--color-text-muted); }
    button[odysButton] { align-self: flex-start; }
  `,
})
export class WeatherCardComponent {
  readonly record = input<WeatherSnapshot>();
  readonly title = input('Meteo del giorno');
  readonly alerts = input<string[]>([]);
  readonly loading = input(false);
  readonly refreshable = input(false);
  readonly refresh = output<void>();
  protected readonly expanded = signal(false);

  protected readonly state = computed<DataState>(() => {
    const status = this.record()?.status;
    if (status === 'OFFLINE') return 'offline';
    if (status === 'UNAVAILABLE') return 'non-disponibile';
    if (status === 'HISTORICAL_CLIMATE') return 'simulato';
    if (status === 'TO_VERIFY' || status === 'UPDATE_NEEDED') return 'da-verificare';
    return 'confermato';
  });

  protected readonly temperature = computed(() => {
    const record = this.record();
    if (!record || (record.temperatureMinC === undefined && record.temperatureMaxC === undefined)) return '—';
    if (record.temperatureMinC !== undefined && record.temperatureMaxC !== undefined) return `${Math.round(record.temperatureMinC)}°–${Math.round(record.temperatureMaxC)}°`;
    return `${Math.round(record.temperatureMinC ?? record.temperatureMaxC ?? 0)}°`;
  });

  protected readonly updated = computed(() => {
    const record = this.record();
    const value = record?.updatedAt ?? record?.lastSuccessfulAt;
    return value ? `aggiornato alle ${new Date(value).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : 'aggiornamento non disponibile';
  });

  protected round(value: number): number {
    return Math.round(value);
  }
}
