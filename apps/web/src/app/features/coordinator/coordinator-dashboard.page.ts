import { DatePipe } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-client';
import { EntitlementsStore } from '../../core/state/entitlements.store';
import { CatalogApi, formatPrice, PUBLISHED_STATUS_LABELS, type PublishedTrip, type PublishedTripStatus } from '../../core/api/catalog.api';
import { ButtonComponent, ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent, type IconName } from '../../shared/ui';
import { CoordinatorAccessComponent } from './coordinator-access.component';

type Filter = 'all' | PublishedTripStatus;

/** Cruscotto del coordinatore (C-14): i propri viaggi pubblicati per stato. */
@Component({
  selector: 'odys-coordinator-dashboard-page',
  imports: [DatePipe, RouterLink, ButtonComponent, ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent, CoordinatorAccessComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="head">
        <div>
          <p class="eyebrow">Area coordinatore</p>
          <h1>I tuoi viaggi pubblicati</h1>
          <p class="muted">Crea un’offerta a partire da uno dei tuoi itinerari, completala e pubblicala quando è pronta.</p>
        </div>
        @if (ready()) {<a odysButton variant="accent" icon="plus" routerLink="/coordinatore/nuovo">Nuovo viaggio pubblicato</a>}
      </header>

      <odys-coordinator-access (accepted)="ready.set(true); load()" />

      @if (ready() && !entitlements.has('analytics.coordinator')) {
        <a class="stats" routerLink="/premium" [queryParams]="{ funzione: 'analytics.coordinator' }">
          <span class="stats__icon"><odys-icon name="lock" [size]="20" /></span>
          <span class="stats__text">
            <strong>Quanto rendono i tuoi viaggi?</strong>
            <span>Guadagni del mese, funnel dalle visite alle prenotazioni, post che vendono: con Coordinatore Premium.</span>
          </span>
          <odys-icon name="chevron-right" />
        </a>
      }

      @if (ready()) {
        <div class="filters" role="group" aria-label="Filtra per stato">
          @for (option of filters; track option.value) {
            <button odysChip [selected]="filter() === option.value" (click)="filter.set(option.value)">{{ option.label }} · {{ count(option.value) }}</button>
          }
        </div>
        @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
        <div class="rows">
          @for (trip of visible(); track trip.id) {
            <a class="row" [routerLink]="['/coordinatore', trip.id]">
              <span class="status status--{{ trip.effectiveStatus }}">{{ label(trip.effectiveStatus) }}</span>
              <span class="row__main">
                <strong>{{ trip.title }}</strong>
                <span class="muted small">{{ trip.destination }} · {{ trip.startDate ? (trip.startDate | date: 'd MMM y') : 'date da definire' }} · {{ price(trip) }} · {{ trip.capacity ?? '—' }} posti</span>
                @if (trip.capacity) {
                  <span class="sold">
                    <span class="sold__bar" aria-hidden="true">
                      @for (seat of seatsOf(trip); track $index) {<span class="sold__seat" [class.is-sold]="seat"></span>}
                    </span>
                    <span class="small"><strong>{{ trip.requests?.confirmed ?? 0 }}/{{ trip.capacity }}</strong> posti venduti@if ((trip.requests?.confirmed ?? 0) >= trip.capacity) { · <strong>tutto esaurito</strong>}</span>
                  </span>
                }
                @if (trip.alerts?.length) {
                  <span class="alerts">
                    @for (alert of trip.alerts; track alert.kind) {<span class="alert alert--{{ alert.tone }}"><odys-icon [name]="alertIcon(alert.kind)" [size]="14" /> {{ alert.message }}</span>}
                  </span>
                }
                @if (trip.status === 'scheduled' && trip.scheduledFor) {<span class="small">Pubblicazione il {{ trip.scheduledFor | date: 'd MMM y, HH:mm' }}</span>}
              </span>
              <odys-icon name="chevron-right" />
            </a>
          } @empty {
            @if (!loading()) {
              <odys-empty-state icon="plus" title="Nessun viaggio in questo stato" description="Crea un viaggio pubblicato partendo da un itinerario che hai già salvato." actionLabel="Nuovo viaggio pubblicato" (action)="goNew()" />
            }
          }
        </div>
      }
    </div>
  `,
  styles: `
    .head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-6); h1 { font-size: var(--text-3xl); } }
    .filters { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-4); }
    .rows { display: flex; flex-direction: column; gap: var(--space-2); }
    .row { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-4); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); color: var(--color-text); text-decoration: none;
      &:hover { border-color: var(--color-border-strong); box-shadow: var(--shadow-md); } }
    .stats { display: flex; align-items: center; gap: var(--space-4); margin-bottom: var(--space-5); padding: var(--space-4) var(--space-5); border-radius: var(--radius-xl, 24px); background: var(--color-brand-panel); color: var(--color-on-brand); text-decoration: none;
      &:hover .stats__icon { background: var(--color-accent); color: var(--color-on-accent); } }
    .stats__icon { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; border-radius: 50%; background: rgb(255 255 255 / 0.12); transition: background-color var(--duration-fast) var(--ease-out); }
    .stats__text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; strong { font-size: var(--text-lg); } span { font-size: var(--text-sm); color: var(--color-on-brand-muted); } }
    .sold { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); margin-top: 2px; }
    .sold__bar { display: grid; grid-auto-flow: column; grid-auto-columns: 10px; gap: 3px; }
    .sold__seat { height: 8px; border-radius: var(--radius-pill); background: var(--color-surface-muted); box-shadow: inset 0 0 0 1px var(--color-border-strong); }
    .sold__seat.is-sold { background: var(--color-text); box-shadow: none; }
    .alerts { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-top: 4px; }
    .alert { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: var(--radius-pill); font-size: var(--text-xs); font-weight: 700; }
    .alert--warning { background: var(--color-accent-soft); color: var(--color-text); }
    .alert--danger { background: var(--color-danger-soft); color: var(--color-danger-text); }
    .alert--info { background: var(--color-primary-soft); color: var(--color-link); }
    .row__main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .small { font-size: var(--text-sm); }
    .status { flex-shrink: 0; min-width: 104px; padding: 4px 10px; border-radius: var(--radius-pill); font-size: var(--text-xs); font-weight: 700; text-align: center; background: var(--color-surface-muted); }
    .status--published, .status--active { background: var(--color-accent); color: var(--color-on-accent); }
    .status--scheduled { background: var(--color-primary-soft); color: var(--color-link); }
    .status--cancelled { background: var(--color-danger-soft); color: var(--color-danger-text); }
  `,
})
export default class CoordinatorDashboardPage implements AfterViewInit {
  private readonly api = inject(CatalogApi);
  private readonly router = inject(Router);
  protected readonly entitlements = inject(EntitlementsStore);
  private readonly access = viewChild.required(CoordinatorAccessComponent);
  protected readonly ready = signal(false);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly trips = signal<PublishedTrip[]>([]);
  protected readonly filter = signal<Filter>('all');
  protected readonly filters: Array<{ value: Filter; label: string }> = [
    { value: 'all', label: 'Tutti' },
    { value: 'draft', label: 'Bozze' },
    { value: 'scheduled', label: 'Programmati' },
    { value: 'published', label: 'Pubblicati' },
    { value: 'active', label: 'In corso' },
    { value: 'completed', label: 'Conclusi' },
    { value: 'cancelled', label: 'Annullati' },
    { value: 'archived', label: 'Archiviati' },
  ];
  protected readonly visible = computed(() => this.filter() === 'all' ? this.trips() : this.trips().filter((trip) => trip.effectiveStatus === this.filter()));

  async ngAfterViewInit(): Promise<void> {
    if (await this.access().check()) {
      this.ready.set(true);
      await this.load();
    }
    this.loading.set(false);
  }

  async load(): Promise<void> {
    try {
      this.trips.set(await this.api.myPublished());
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    }
  }

  protected count(filter: Filter): number {
    return filter === 'all' ? this.trips().length : this.trips().filter((trip) => trip.effectiveStatus === filter).length;
  }

  /** Segmenti della barra dei posti: pieni quelli venduti (CB-07). */
  protected seatsOf(trip: PublishedTrip): boolean[] {
    const sold = trip.requests?.confirmed ?? 0;
    return Array.from({ length: trip.capacity ?? 0 }, (_, index) => index < sold);
  }

  protected alertIcon(kind: string): IconName {
    return kind === 'balance_due' ? 'credit-card' : kind === 'requests_pending' ? 'users' : 'alert-triangle';
  }

  protected label(status: PublishedTripStatus): string {
    return PUBLISHED_STATUS_LABELS[status];
  }

  protected price(trip: PublishedTrip): string {
    return formatPrice(trip.priceCents, trip.currency);
  }

  protected goNew(): void {
    void this.router.navigate(['/coordinatore/nuovo']);
  }
}
