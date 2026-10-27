import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { displayDayDate, nodeIdForActivity, timelineEntries, weatherAlerts, type DayPlan, type Itinerary } from '@odys/domain';
import { ButtonComponent, EmptyStateComponent } from '../../../shared/ui';
import { ItineraryStore } from '../itinerary.store';
import { ActivityCardComponent } from './activity-card.component';
import { ActivityEditorComponent } from './activity-editor.component';
import { RouteCardComponent } from './route-card.component';
import { WeatherCardComponent } from './weather-card.component';

/** Una giornata dell'itinerario: in consultazione mostra la timeline, in modifica gli editor. */
@Component({
  selector: 'odys-day-section',
  imports: [ActivityCardComponent, ActivityEditorComponent, RouteCardComponent, WeatherCardComponent, ButtonComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="day" [attr.aria-labelledby]="'day-' + day().day">
      <div class="rail" aria-hidden="true"><span class="dot">{{ day().day }}</span><span class="line"></span></div>
      <div class="content">
        <p class="eyebrow">{{ date() }} · Giorno {{ day().day }}</p>
        <h3 [id]="'day-' + day().day">{{ day().label }}</h3>

        @if (!editing()) {
          <div class="endpoints">
            <span><small>Da</small> {{ day().origin?.label ?? 'Origine da definire' }}</span>
            <span><small>A</small> {{ day().finalDestination?.label ?? 'Destinazione da definire' }}</span>
          </div>
          <odys-weather-card [title]="'Meteo · giorno ' + day().day" [record]="weather()" [alerts]="alerts()" />
        }

        @if (day().activities.length === 0) {
          <odys-empty-state icon="calendar" title="Nessuna attività ancora" description="Questa giornata resta salvata. Aggiungi una tappa quando vuoi, senza modificare gli altri giorni." [actionLabel]="editing() ? 'Aggiungi attività' : 'Modifica itinerario'" (action)="editing() ? store.addActivity(dayIndex()) : store.startEditing()" />
        } @else if (editing()) {
          @for (activity of day().activities; track activity.id ?? $index; let i = $index) {
            <odys-activity-editor [activity]="activity" [dayIndex]="dayIndex()" [activityIndex]="i" [days]="plan().days" />
          }
        } @else {
          @for (entry of timeline(); track $index) {
            @if (entry.kind === 'route') {
              <odys-route-card [segment]="entry.segment" [compact]="true" [selected]="store.selectedSegmentId() === entry.segment.id"
                (select)="store.selectedNodeId.set($event.toNodeId); store.selectedSegmentId.set($event.id)"
                (toggleCompleted)="store.toggleSegment($event)" (calculate)="store.requestProviderRoute($event)" />
            } @else {
              <odys-activity-card [activity]="entry.activity" [planTransport]="plan().transport" [seasonalWeather]="plan().weatherMode === 'seasonal'" [destination]="plan().destination" [tripId]="store.trip()?.id"
                [selected]="store.selectedNodeId() === nodeId(entry.activity, entry.activityIndex)"
                (openOnMap)="openOnMap(entry.activity, entry.activityIndex)" (toggleCompleted)="store.toggleActivity(day().day, entry.activityIndex)" />
            }
          }
        }

        @if (editing()) {
          <button odysButton variant="secondary" icon="plus" (click)="store.addActivity(dayIndex())">Aggiungi attività</button>
        }

        <aside class="alternatives">
          <strong>Se cambia il ritmo</strong>
          <p><span>Pioggia:</span> {{ day().rainyAlternative }}</p>
          <p><span>Stanchezza:</span> {{ day().tiredAlternative }}</p>
        </aside>
      </div>
    </section>
  `,
  styles: `
    .day { display: flex; gap: var(--space-4); }
    .rail { display: flex; flex-direction: column; align-items: center; }
    .dot { display: grid; place-items: center; width: 36px; height: 36px; flex-shrink: 0; border-radius: var(--radius-pill); background: var(--color-brand-panel); color: var(--odys-lime); font-family: var(--font-brand); font-weight: 800; }
    .line { flex: 1; width: 2px; margin-top: var(--space-2); background: repeating-linear-gradient(var(--color-border-strong) 0 6px, transparent 6px 12px); }
    .content { display: flex; flex-direction: column; gap: var(--space-3); flex: 1; min-width: 0; padding-bottom: var(--space-8); }
    h3 { font-size: var(--text-xl); margin-top: -4px; }
    .endpoints { display: grid; gap: var(--space-1); padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); background: var(--color-surface-muted); font-size: var(--text-sm); font-weight: 500;
      small { display: inline-block; min-width: 20px; color: var(--color-text-muted); font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; } }
    .alternatives { padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); border: var(--border-width) solid var(--color-border); font-size: var(--text-sm);
      p { color: var(--color-text-muted); } span { font-weight: 600; color: var(--color-text); } }
    button[odysButton] { align-self: flex-start; }
  `,
})
export class DaySectionComponent {
  protected readonly store = inject(ItineraryStore);
  readonly plan = input.required<Itinerary>();
  readonly day = input.required<DayPlan>();
  readonly dayIndex = input.required<number>();
  readonly editing = input(false);

  protected readonly date = computed(() => displayDayDate(this.day().date).toUpperCase());
  protected readonly timeline = computed(() => timelineEntries(this.day()));
  protected readonly weather = computed(() => {
    this.plan();
    return this.store.weatherForDay(this.day().day);
  });
  protected readonly alerts = computed(() => weatherAlerts(this.weather(), this.day().activities.filter((activity) => activity.setting !== 'indoor').length, this.day().rainyAlternative));

  protected nodeId(activity: DayPlan['activities'][number], index: number): string {
    return nodeIdForActivity(activity, index);
  }

  protected openOnMap(activity: DayPlan['activities'][number], index: number): void {
    this.store.todayDay.set(this.day().day);
    this.store.selectedNodeId.set(nodeIdForActivity(activity, index));
    document.getElementById('today-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
