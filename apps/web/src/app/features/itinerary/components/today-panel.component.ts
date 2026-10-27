import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { displayDayDate, nodeIdForActivity, timelineEntries, weatherAlerts, type Itinerary } from '@odys/domain';
import { IconComponent } from '../../../shared/ui';
import { ItineraryStore } from '../itinerary.store';
import { ActivityCardComponent } from './activity-card.component';
import { MapPreviewComponent } from './map-preview.component';
import { NextActivityCardComponent } from './next-activity-card.component';
import { RouteCardComponent } from './route-card.component';
import { WeatherCardComponent } from './weather-card.component';

/** Modalità "Oggi": navigazione fra i giorni, mappa, meteo, prossima attività e timeline compatta. */
@Component({
  selector: 'odys-today-panel',
  imports: [IconComponent, MapPreviewComponent, WeatherCardComponent, NextActivityCardComponent, RouteCardComponent, ActivityCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.selectedDay(); as day) {
      <section id="today-panel" class="today" aria-label="Oggi">
        <div class="nav">
          <button type="button" class="nav__btn" [disabled]="index() <= 0" (click)="go(-1)" aria-label="Giorno precedente"><odys-icon name="chevron-left" /></button>
          <div class="nav__label"><span class="eyebrow">Oggi · Giorno {{ day.day }} · {{ date(day.date) }}</span><strong>{{ day.label }}</strong></div>
          <button type="button" class="nav__btn" [disabled]="index() >= plan().days.length - 1" (click)="go(1)" aria-label="Giorno successivo"><odys-icon name="chevron-right" /></button>
        </div>

        <odys-map-preview [itinerary]="plan()" [selectedDay]="day.day" [selectedNodeId]="store.selectedNodeId()" [selectedSegmentId]="store.selectedSegmentId()"
          (selectDay)="store.todayDay.set($event)" (selectNode)="store.selectedNodeId.set($event)" (selectSegment)="store.selectedSegmentId.set($event)"
          (addResult)="store.addSearchResult($event)" />

        <odys-weather-card title="Meteo di oggi" [record]="weather()" [alerts]="alerts()" [loading]="store.weatherLoading()" [refreshable]="true" (refresh)="store.refreshWeather()" />

        <odys-next-activity-card [day]="day" [planTransport]="plan().transport"
          (openOnMap)="store.selectedNodeId.set(nodeId(day.activities[$event], $event))"
          (complete)="store.toggleActivity(day.day, $event)" />

        <details class="timeline">
          <summary>Timeline della giornata</summary>
          <div class="timeline__list">
            @for (entry of timeline(); track $index) {
              @if (entry.kind === 'route') {
                <odys-route-card [segment]="entry.segment" [compact]="true" [selected]="store.selectedSegmentId() === entry.segment.id"
                  (select)="store.selectedNodeId.set($event.toNodeId); store.selectedSegmentId.set($event.id)"
                  (toggleCompleted)="store.toggleSegment($event)" (calculate)="store.requestProviderRoute($event)" />
              } @else {
                <odys-activity-card [activity]="entry.activity" [planTransport]="plan().transport" [seasonalWeather]="plan().weatherMode === 'seasonal'" [destination]="plan().destination" [tripId]="store.trip()?.id"
                  [selected]="store.selectedNodeId() === nodeId(entry.activity, entry.activityIndex)"
                  (openOnMap)="store.selectedNodeId.set(nodeId(entry.activity, entry.activityIndex))" (toggleCompleted)="store.toggleActivity(day.day, entry.activityIndex)" />
              }
            }
          </div>
        </details>
      </section>
    }
  `,
  styles: `
    .today { display: flex; flex-direction: column; gap: var(--space-3); scroll-margin-top: calc(var(--header-height) + var(--space-4)); }
    .nav { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2); border-radius: var(--radius-pill); background: var(--color-surface); border: var(--border-width) solid var(--color-border); }
    .nav__btn { display: grid; place-items: center; width: 40px; height: 40px; flex-shrink: 0; border: 0; border-radius: var(--radius-pill); background: var(--color-surface-muted); cursor: pointer;
      &:disabled { opacity: 0.4; cursor: not-allowed; } &:not(:disabled):hover { background: var(--color-accent); } }
    .nav__label { display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 0; text-align: center; strong { font-size: var(--text-sm); } }
    .timeline { border-radius: var(--radius-lg); border: var(--border-width) solid var(--color-border); background: var(--color-surface);
      summary { padding: var(--space-4); font-weight: 700; cursor: pointer; } }
    .timeline__list { display: flex; flex-direction: column; gap: var(--space-2); padding: 0 var(--space-3) var(--space-3); }
  `,
})
export class TodayPanelComponent {
  protected readonly store = inject(ItineraryStore);
  readonly plan = input.required<Itinerary>();

  protected readonly index = computed(() => this.plan().days.findIndex((day) => day.day === this.store.selectedDay()?.day));
  protected readonly timeline = computed(() => {
    const day = this.store.selectedDay();
    return day ? timelineEntries(day) : [];
  });
  protected readonly weather = computed(() => {
    this.plan();
    const day = this.store.selectedDay();
    return day ? this.store.weatherForDay(day.day) : undefined;
  });
  protected readonly alerts = computed(() => {
    const day = this.store.selectedDay();
    return weatherAlerts(this.weather(), day?.activities.filter((activity) => activity.setting !== 'indoor').length ?? 0, day?.rainyAlternative);
  });

  protected go(step: number): void {
    const next = this.plan().days[this.index() + step];
    if (next) this.store.todayDay.set(next.day);
  }

  protected date(value: string): string {
    return displayDayDate(value);
  }

  protected nodeId(activity: Itinerary['days'][number]['activities'][number], index: number): string {
    return nodeIdForActivity(activity, index);
  }
}
