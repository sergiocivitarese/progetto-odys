import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { dayAgenda, displayDayDate, normalizeWeatherRecords, weatherKey, weatherRequestForDay, type Itinerary, type WeatherSnapshot } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi } from '../../core/api/catalog.api';
import { ServicesApi } from '../../core/api/services.api';
import { TripsApi } from '../../core/api/trips.api';
import { AuthStore } from '../../core/auth/auth.store';
import { EntitlementsStore } from '../../core/state/entitlements.store';
import { PlanDraftStore } from '../../core/state/plan-draft.store';
import { DayMapComponent } from '../../shared/travel/day-map.component';
import { EmptyStateComponent, IconComponent, NoticeComponent, RingPinComponent } from '../../shared/ui';
import { WeatherCardComponent } from './components/weather-card.component';

type Source = 'trip' | 'group';

/**
 * Il giorno per ore (TP-05…TP-07), per i viaggi salvati e per i viaggi di gruppo:
 * programma orario con durate e spostamenti, meteo del giorno e mappa con
 * puntatori ad anello e schermo intero. Meteo e mappa sono del Traveller Premium:
 * a chi non li ha mostrano l'invito, mai un errore (TP-10).
 */
@Component({
  selector: 'odys-day-page',
  imports: [RouterLink, DayMapComponent, WeatherCardComponent, EmptyStateComponent, IconComponent, NoticeComponent, RingPinComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a [routerLink]="back()" class="back"><odys-icon name="arrow-left" [size]="16" /> {{ title() || 'Itinerario' }}</a>

      @if (loading()) {
        <p class="muted" aria-busy="true"><odys-icon name="loader" /> Apertura del giorno…</p>
      } @else if (error() || !agenda()) {
        <odys-empty-state icon="calendar" title="Giorno non disponibile" [description]="error() || 'Questo giorno non fa parte del viaggio.'" />
      } @else if (agenda(); as a) {
        <header class="head">
          <p class="eyebrow">{{ date() }} · Giorno {{ a.day.day }} di {{ days().length }}</p>
          <h1>{{ a.day.label }}</h1>
        </header>

        <nav class="days" aria-label="Giorni del viaggio">
          @for (day of days(); track day.day) {
            <a class="day" [class.is-active]="day.day === a.day.day" [attr.aria-current]="day.day === a.day.day ? 'page' : null" [routerLink]="dayLink(day.day)" replaceUrl>G{{ day.day }}</a>
          }
        </nav>

        <div class="layout">
          <section class="schedule" aria-labelledby="schedule-title">
            <h2 id="schedule-title">Programma</h2>
            <ol class="timeline">
              @for (entry of a.entries; track $index) {
                @if (entry.kind === 'activity') {
                  <li class="activity" [class.is-active]="entry.stop && entry.stop === activeStop()">
                    <span class="time">{{ entry.time ?? '—' }}@if (entry.endTime) {<small>{{ entry.endTime }}</small>}</span>
                    <span class="marker">
                      @if (entry.stop) {
                        <button type="button" class="pin-button" (click)="activeStop.set(entry.stop)" [attr.aria-label]="'Mostra la tappa ' + entry.stop + ' sulla mappa'"><odys-ring-pin [size]="30" [active]="entry.stop === activeStop()">{{ entry.stop }}</odys-ring-pin></button>
                      } @else {
                        <span class="dot" aria-hidden="true"></span>
                      }
                    </span>
                    <div class="body">
                      <strong>{{ entry.title }}</strong>
                      @if (entry.place) {<span class="small muted"><odys-icon name="map-pin" [size]="13" /> {{ entry.place }}</span>}
                      @if (entry.detail) {<p class="small muted">{{ entry.detail }}</p>}
                      @if (entry.durationLabel) {<span class="chip"><odys-icon name="clock" [size]="13" /> {{ entry.durationLabel }}</span>}
                    </div>
                  </li>
                } @else {
                  <li class="transfer">
                    <span class="time" aria-hidden="true"></span>
                    <span class="marker"><span class="line" aria-hidden="true"></span></span>
                    <p class="small">
                      <odys-icon [name]="modeIcon(entry.mode)" [size]="15" />
                      <strong>{{ entry.modeLabel }}</strong> · {{ entry.durationLabel ?? 'durata da definire' }}@if (entry.distanceLabel) { · {{ entry.distanceLabel }}}
                      <span class="muted"> · {{ entry.suggested ? 'spostamento suggerito' : entry.estimated ? 'stima da verificare' : 'percorso calcolato' }}</span>
                    </p>
                  </li>
                }
              } @empty {
                <li class="muted">Nessuna attività in questo giorno.</li>
              }
            </ol>
            @if (a.day.rainyAlternative) {<p class="alt small"><strong>Se piove:</strong> {{ a.day.rainyAlternative }}</p>}
          </section>

          <aside class="side">
            @if (insights()) {
              <section aria-labelledby="map-title">
                <h2 id="map-title">Mappa del giorno</h2>
                <odys-day-map [stops]="a.stops" [path]="a.path" [anchor]="a.anchor" [activeStop]="activeStop()" [days]="days()" [selectedDay]="a.day.day"
                  (stopSelect)="activeStop.set($event)" (dayChange)="goToDay($event)" />
              </section>
              <section aria-labelledby="weather-title">
                <h2 id="weather-title" class="visually-hidden">Meteo del giorno</h2>
                @if (weather(); as w) {
                  <odys-weather-card [title]="w.status === 'HISTORICAL_CLIMATE' ? 'Valori stagionali · giorno ' + a.day.day : 'Meteo · giorno ' + a.day.day" [record]="w" />
                  @if (w.status === 'HISTORICAL_CLIMATE') {<p class="small muted">La previsione arriva quando mancano 15 giorni o meno: fino ad allora mostriamo il clima degli ultimi 5 anni negli stessi giorni.</p>}
                } @else if (weatherLoading()) {
                  <p class="small muted"><odys-icon name="loader" /> Meteo in arrivo…</p>
                } @else {
                  <odys-notice tone="info" title="Meteo non disponibile">Serve almeno un luogo del giorno con posizione confermata.</odys-notice>
                }
              </section>
            } @else {
              <a class="premium" routerLink="/premium" [queryParams]="{ funzione: 'trips.insights' }">
                <span class="premium__icon"><odys-icon name="map" /></span>
                <span><strong>Mappa e meteo del giorno</strong><small>Con Traveller Premium vedi le tappe sulla mappa, gli spostamenti e il meteo di ogni giorno.</small></span>
                <odys-icon name="arrow-right" />
              </a>
            }
          </aside>
        </div>

        <nav class="pager" aria-label="Giorno precedente e successivo">
          @if (a.day.day > firstDay()) {<a [routerLink]="dayLink(a.day.day - 1)" replaceUrl><odys-icon name="arrow-left" [size]="16" /> Giorno {{ a.day.day - 1 }}</a>} @else {<span></span>}
          @if (a.day.day < lastDay()) {<a [routerLink]="dayLink(a.day.day + 1)" replaceUrl>Giorno {{ a.day.day + 1 }} <odys-icon name="arrow-right" [size]="16" /></a>}
        </nav>
      }
    </div>
  `,
  styles: `
    .back { display: inline-flex; align-items: center; gap: var(--space-1); margin-bottom: var(--space-4); color: var(--color-text-muted); text-decoration: none; font-weight: 600; }
    .head { display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-4); h1 { font-size: var(--text-3xl); } }
    .days { display: flex; gap: var(--space-2); overflow-x: auto; padding-bottom: var(--space-2); margin-bottom: var(--space-5); }
    .day { flex-shrink: 0; display: grid; place-items: center; min-width: 48px; min-height: 44px; padding: 0 var(--space-3); border-radius: var(--radius-pill); border: var(--border-width) solid var(--color-border-strong); color: var(--color-text); font-weight: 800; text-decoration: none; }
    .day.is-active { background: var(--odys-ink); border-color: var(--odys-ink); color: var(--odys-lime); }
    .layout { display: grid; gap: var(--space-6); }
    h2 { font-size: var(--text-lg); margin-bottom: var(--space-3); }
    .timeline { list-style: none; margin: 0; padding: 0; }
    .activity, .transfer { display: grid; grid-template-columns: 52px 36px minmax(0, 1fr); gap: var(--space-3); align-items: start; }
    .activity { padding: var(--space-2) 0; }
    .activity.is-active .body strong { color: var(--color-link); }
    .time { padding-top: 6px; font-weight: 800; font-variant-numeric: tabular-nums; display: flex; flex-direction: column; small { font-weight: 600; color: var(--color-text-muted); } }
    .marker { display: grid; justify-items: center; }
    .pin-button { padding: 0; border: 0; background: transparent; cursor: pointer; border-radius: 50%; min-width: 44px; min-height: 44px; display: grid; place-items: center; margin-top: -7px; }
    .pin-button:focus-visible { outline: 3px solid var(--color-focus); }
    .dot { width: 10px; height: 10px; margin-top: 10px; border-radius: 50%; background: var(--color-border-strong); }
    .line { width: 2px; min-height: 28px; height: 100%; background: repeating-linear-gradient(var(--color-border-strong) 0 5px, transparent 5px 10px); }
    .body { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding-top: 4px; }
    .transfer p { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: var(--space-1) 0; }
    .chip { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: var(--radius-pill); background: var(--color-surface-muted); font-size: var(--text-xs); font-weight: 700; }
    .alt { margin-top: var(--space-4); padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); background: var(--color-surface-muted); }
    .side { display: flex; flex-direction: column; gap: var(--space-5); min-width: 0; }
    .premium { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4); border-radius: var(--radius-lg); background: var(--odys-ink); color: #fff; text-decoration: none;
      > span:nth-child(2) { display: flex; flex-direction: column; gap: 2px; flex: 1; } small { color: rgb(255 255 255 / 0.75); } }
    .premium__icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: var(--radius-md); background: var(--odys-lime); color: var(--odys-ink); flex-shrink: 0; }
    .pager { display: flex; justify-content: space-between; margin-top: var(--space-8); a { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; font-weight: 700; } }
    .small { font-size: var(--text-sm); }
    @media (min-width: 960px) { .layout { grid-template-columns: minmax(0, 1fr) minmax(0, 420px); align-items: start; } .side { position: sticky; top: calc(var(--header-height) + var(--space-4)); } }
  `,
})
export default class DayPage {
  private readonly trips = inject(TripsApi);
  private readonly catalog = inject(CatalogApi);
  private readonly services = inject(ServicesApi);
  private readonly draft = inject(PlanDraftStore);
  private readonly auth = inject(AuthStore);
  private readonly entitlements = inject(EntitlementsStore);
  private readonly router = inject(Router);

  readonly id = input.required<string>();
  readonly giorno = input.required<string>();
  /** Dalla rotta: 'trip' (viaggio personale) o 'group' (viaggio di gruppo). */
  readonly source = input<Source>('trip');

  private readonly plan = signal<Itinerary | null>(null);
  protected readonly title = signal('');
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly weatherRecords = signal<WeatherSnapshot[]>([]);
  protected readonly weatherLoading = signal(false);
  protected readonly activeStop = signal<number | undefined>(undefined);

  protected readonly dayNumber = computed(() => Number.parseInt(this.giorno(), 10) || 1);
  protected readonly agenda = computed(() => this.plan() ? dayAgenda(this.plan()!, this.dayNumber()) : null);
  protected readonly days = computed(() => (this.plan()?.days ?? []).map((day) => ({ day: day.day, label: day.label })));
  protected readonly firstDay = computed(() => this.days()[0]?.day ?? 1);
  protected readonly lastDay = computed(() => this.days().at(-1)?.day ?? 1);
  protected readonly date = computed(() => this.agenda() ? displayDayDate(this.agenda()!.day.date) : '');
  protected readonly insights = computed(() => this.entitlements.has('trips.insights'));
  protected readonly back = computed(() => this.source() === 'group' ? ['/gruppi', this.id()] : ['/itinerario', this.id()]);
  protected readonly weather = computed(() => {
    const plan = this.plan();
    const request = plan ? weatherRequestForDay(plan, this.dayNumber()) : null;
    return request ? this.weatherRecords().find((record) => weatherKey(record) === weatherKey(request)) : undefined;
  });

  constructor() {
    effect(() => {
      const key = `${this.source()}:${this.id()}`;
      untracked(() => void this.load(key));
    });
    // Cambiando giorno si riparte senza tappa selezionata.
    effect(() => { this.dayNumber(); untracked(() => this.activeStop.set(undefined)); });
  }

  private async load(key: string): Promise<void> {
    const [source, id] = key.split(':') as [Source, string];
    this.loading.set(true);
    this.error.set('');
    try {
      await this.auth.start();
      if (source === 'group') {
        const trip = await this.catalog.get(id);
        this.plan.set(trip.itinerary);
        this.title.set(trip.title);
      } else if (id === 'bozza') {
        const draft = this.draft.plan();
        if (!draft) throw new Error('Questo piano non è più disponibile: crealo di nuovo dal planner.');
        this.plan.set(draft);
        this.title.set(draft.destination);
      } else {
        const trip = await this.trips.get(id);
        this.plan.set(trip.itinerary);
        this.title.set(trip.title);
      }
    } catch (error) {
      this.error.set(error instanceof Error && !('status' in error) ? error.message : apiErrorMessage(error, 'Non è stato possibile aprire il viaggio.'));
    } finally {
      this.loading.set(false);
    }
    // Meteo e mappa dipendono dal diritto: prima di chiedere il meteo si leggono i diritti aggiornati.
    if (this.auth.isAuthenticated()) await this.entitlements.refresh();
    await this.loadWeather();
  }

  /** Meteo di tutto il viaggio in una richiesta (TP-06): previsione o valori stagionali. */
  private async loadWeather(): Promise<void> {
    const plan = this.plan();
    if (!plan || !this.insights()) return;
    this.weatherRecords.set(normalizeWeatherRecords(plan.weather));
    this.weatherLoading.set(true);
    try {
      this.weatherRecords.set((await this.services.refreshWeather(plan)).weather);
    } catch {
      // Il meteo è un'aggiunta: senza rete restano gli ultimi dati del piano.
    } finally {
      this.weatherLoading.set(false);
    }
  }

  protected dayLink(day: number): string[] {
    return [...this.back(), 'giorno', String(day)];
  }

  protected goToDay(day: number): void {
    void this.router.navigate(this.dayLink(day), { replaceUrl: true });
  }

  protected modeIcon(mode: string) {
    return mode === 'a piedi' ? 'footprints' : mode === 'auto' || mode === 'taxi' ? 'car' : mode === 'traghetto' ? 'ship' : mode === 'treno' ? 'train' : mode === 'aereo' ? 'plane' : 'bus';
  }
}
