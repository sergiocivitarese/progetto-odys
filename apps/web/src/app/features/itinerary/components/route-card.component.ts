import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { isRoutableMode, routeDataState, TRANSPORT_LABELS, type RouteSegment } from '@odys/domain';
import { ButtonComponent, IconComponent, StatusBadgeComponent } from '../../../shared/ui';

/** Tratta fra due nodi: mezzo, stima, affidabilità e azioni (completa, calcola online). */
@Component({
  selector: 'odys-route-card',
  imports: [ButtonComponent, IconComponent, StatusBadgeComponent, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-selected]': 'selected()', '[class.is-done]': 'segment().completed' },
  template: `
    <button type="button" class="head" (click)="select.emit(segment())" [attr.aria-label]="'Seleziona la tratta da ' + segment().origin.label + ' a ' + segment().destination.label">
      <odys-icon [name]="segment().type === 'interurban' ? 'map' : 'route'" [size]="16" />
      <span class="path">{{ segment().origin.label }} <span aria-hidden="true">→</span> {{ segment().destination.label }}</span>
    </button>
    <div class="meta">
      <span class="mode">{{ modeLabel() }}</span>
      <odys-status-badge [state]="state()" />
    </div>
    <p class="text">Durata: {{ segment().duration ?? 'Da definire' }} · {{ segment().distance ?? 'Distanza da definire' }} · {{ segment().cost }}</p>
    @if (!compact()) {<p class="text">Comfort: {{ segment().comfort }} · Meteo: {{ segment().weatherImpact }}</p>}
    <p class="text">Geometria: {{ segment().geometry?.kind === 'route' ? 'Disponibile' : 'Da definire' }}</p>
    <p class="note">{{ segment().note }}</p>
    @if (segment().source) {
      <p class="source">Fonte: {{ segment().source }}@if (segment().lastCalculatedAt) { · calcolata {{ segment().lastCalculatedAt | date: 'shortDate' }}}</p>
    }
    <div class="actions">
      <button odysButton variant="ghost" size="sm" [icon]="segment().completed ? 'restore' : 'check'" (click)="toggleCompleted.emit(segment().id)">{{ segment().completed ? 'Riapri tratta' : 'Segna completata' }}</button>
      @if (routable()) {
        <button odysButton variant="ghost" size="sm" icon="refresh" (click)="calculate.emit(segment())">Aggiorna percorso online</button>
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); border: var(--border-width) dashed var(--color-border-strong); background: var(--color-bg); }
    :host(.is-selected) { border-style: solid; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-soft); }
    :host(.is-done) { opacity: 0.7; }
    .head { display: flex; align-items: center; gap: var(--space-2); padding: 0; border: 0; background: transparent; text-align: left; cursor: pointer; color: var(--color-link); }
    .path { font-weight: 600; font-size: var(--text-sm); color: var(--color-text); }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
    .mode { font-size: var(--text-xs); font-weight: 700; color: var(--color-link); }
    .text, .source { font-size: var(--text-xs); color: var(--color-text-muted); }
    .note { font-size: var(--text-xs); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-left: calc(var(--space-3) * -1); }
  `,
})
export class RouteCardComponent {
  readonly segment = input.required<RouteSegment>();
  readonly compact = input(false);
  readonly selected = input(false);
  readonly select = output<RouteSegment>();
  readonly toggleCompleted = output<string>();
  readonly calculate = output<RouteSegment>();
  protected readonly state = computed(() => routeDataState(this.segment()));
  protected readonly modeLabel = computed(() => TRANSPORT_LABELS[this.segment().recommendedMode]);
  protected readonly routable = computed(() => isRoutableMode(this.segment().recommendedMode));
}
