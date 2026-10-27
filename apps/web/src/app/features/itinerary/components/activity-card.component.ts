import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ACTIVITY_TRANSPORT_OPTIONS,
  activityDataState,
  activityStatusFor,
  placeDataState,
  SETTING_LABELS,
  TRANSPORT_LABELS,
  type Activity,
  type Transport,
} from '@odys/domain';
import { ButtonComponent, IconComponent, StatusBadgeComponent } from '../../../shared/ui';

/** Attività della timeline: orario, luogo, stati, mezzo consigliato e azioni. */
@Component({
  selector: 'odys-activity-card',
  imports: [ButtonComponent, IconComponent, StatusBadgeComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-selected]': 'selected()', '[class.is-done]': 'activity().completed' },
  template: `
    <span class="time">{{ activity().time }}</span>
    <div class="body">
      <a class="title" [routerLink]="['/luogo', activity().place?.id ?? 'mercato-locale']" [queryParams]="placeParams()">
        {{ activity().title }} <odys-icon name="arrow-up-right" [size]="14" />
      </a>
      @if (activity().detail) {<p class="detail">{{ activity().detail }}</p>}
      <p class="meta">
        <span class="mode">{{ transportLabel() }}</span> · {{ settingLabel() }}
        @if (activity().requiresBooking) {<span class="booking"> · Prenotazione</span>}
      </p>
      <div class="badges">
        <odys-status-badge [state]="activityState()" />
        <odys-status-badge [state]="locationState()" detail="Posizione" />
      </div>
      @if (activity().duration) {<p class="extra">Durata: {{ activity().duration }}</p>}
      @if (activity().notes) {<p class="extra">Note: {{ activity().notes }}</p>}
      <div class="actions">
        <button odysButton variant="ghost" size="sm" icon="map-pin" (click)="openOnMap.emit()">Apri sulla mappa</button>
        <button odysButton variant="ghost" size="sm" [icon]="activity().completed ? 'restore' : 'check'" (click)="toggleCompleted.emit()">{{ activity().completed ? 'Riapri attività' : 'Segna completata' }}</button>
        <button odysButton variant="ghost" size="sm" [icon]="transportOpen() ? 'chevron-up' : 'chevron-down'" (click)="transportOpen.set(!transportOpen())" [attr.aria-expanded]="transportOpen()">Come spostarti</button>
      </div>
      @if (transportOpen()) {
        <div class="transport">
          <ul>
            @for (option of transportOptions; track option) {
              <li [class.is-current]="option === transport()">{{ labels[option] }} · Tempo da verificare · Distanza da verificare · Costo da verificare</li>
            }
          </ul>
          <p><strong>Suggerimento: {{ suggestion() }}</strong></p>
          <p class="extra">{{ reason() }} I dati non sono verificati da un provider.</p>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: flex; gap: var(--space-3); padding: var(--space-4); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); transition: border-color var(--duration-base); }
    :host(.is-selected) { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-soft); }
    :host(.is-done) { opacity: 0.72; }
    :host(.is-done) .title { text-decoration: line-through; }
    .time { flex-shrink: 0; align-self: flex-start; min-width: 58px; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--color-accent); color: var(--color-on-accent); font-weight: 700; font-size: var(--text-xs); text-align: center; }
    .body { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; flex: 1; }
    .title { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-brand); font-weight: 800; font-size: var(--text-lg); color: var(--color-text); text-decoration: none; }
    .title:hover { color: var(--color-link); }
    .detail { font-size: var(--text-sm); color: var(--color-text-muted); }
    .meta { font-size: var(--text-xs); color: var(--color-text-muted); }
    .mode, .booking { color: var(--color-link); font-weight: 700; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .extra { font-size: var(--text-xs); color: var(--color-text-muted); }
    .actions { display: flex; flex-wrap: wrap; gap: 2px; margin-left: calc(var(--space-3) * -1); }
    .transport { padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-bg); font-size: var(--text-xs); display: flex; flex-direction: column; gap: var(--space-2); }
    .transport ul { margin: 0; padding-left: var(--space-4); color: var(--color-text-muted); }
    .transport li.is-current { color: var(--color-link); font-weight: 700; }
  `,
})
export class ActivityCardComponent {
  readonly activity = input.required<Activity>();
  readonly planTransport = input.required<Transport>();
  readonly seasonalWeather = input(false);
  readonly destination = input('');
  readonly tripId = input<string>();
  readonly selected = input(false);
  readonly openOnMap = output<void>();
  readonly toggleCompleted = output<void>();

  protected readonly labels = TRANSPORT_LABELS;
  protected readonly transportOptions = ACTIVITY_TRANSPORT_OPTIONS;
  protected readonly transportOpen = signal(false);

  protected readonly transport = computed(() => this.activity().transport ?? this.planTransport());
  protected readonly transportLabel = computed(() => TRANSPORT_LABELS[this.transport()]);
  protected readonly settingLabel = computed(() => SETTING_LABELS[this.activity().setting ?? 'outdoor']);
  protected readonly activityState = computed(() => activityDataState(this.activity().completed ? 'COMPLETED' : this.activity().status ?? activityStatusFor(this.activity())));
  protected readonly locationState = computed(() => placeDataState(this.activity()));
  protected readonly placeParams = computed(() => ({ title: this.activity().place?.title ?? this.activity().title, destination: this.destination(), viaggio: this.tripId() }));

  // Stessa logica di suggerimento dell'ActivityCard originale.
  protected readonly suggestion = computed(() => {
    const selected = this.transport();
    if (this.seasonalWeather() && selected === 'a piedi') return 'Trasporto pubblico';
    if (selected === 'a piedi') return 'A piedi';
    if (selected === 'misto') return 'Trasporto pubblico';
    return TRANSPORT_LABELS[selected];
  });
  protected readonly reason = computed(() => this.seasonalWeather()
    ? 'Suggerimento provvisorio basato su distanza e preferenze. Il meteo sarà considerato quando entrerà nella finestra previsionale.'
    : this.transport() === 'a piedi'
      ? 'Percorso breve e gratuito, adatto al ritmo della giornata.'
      : 'Scelta consigliata per contenere il tempo di spostamento.');
}
