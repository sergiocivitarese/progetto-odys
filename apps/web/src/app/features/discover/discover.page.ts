import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { sharesInterest } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, daysUntil, type PublishedTripSummary } from '../../core/api/catalog.api';
import { AuthStore } from '../../core/auth/auth.store';
import { AccountStore } from '../../core/state/account.store';
import { PublishedTripCardComponent, type TripCardTone } from '../../shared/travel/published-trip-card.component';
import { ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';

type QuickFilter = 'Tutti' | 'Weekend' | 'Mare' | 'Avventura' | 'Città';

/**
 * Esplora (TB-01): la home pubblica. Saluto, ricerca per intento, filtri
 * rapidi, viaggio in evidenza e «Partono a breve». Il login si chiede solo
 * per salvare o prenotare.
 */
@Component({
  selector: 'odys-discover-page',
  imports: [FormsModule, RouterLink, PublishedTripCardComponent, ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page discover">
      @if (avviso() === 'account-eliminato') {<odys-notice tone="success">Il tuo account è stato eliminato insieme ai tuoi dati.</odys-notice>}

      <header class="intro">
        @if (firstName()) {<p class="meta-line hello">Ciao {{ firstName() }}</p>}
        <h1>Dove ti porta la prossima orbita?</h1>
      </header>

      <form class="search" role="search" (submit)="$event.preventDefault(); search()">
        <odys-icon name="search" [size]="22" />
        <label class="visually-hidden" for="discover-search">Cerca una meta: paese, regione o città</label>
        <input id="discover-search" type="search" name="q" placeholder="Prova: Messico" autocomplete="off" [ngModel]="query()" (ngModelChange)="query.set($event)" />
        <button type="submit" class="search__go" aria-label="Cerca"><odys-icon name="arrow-right" [size]="20" [strokeWidth]="2.4" /></button>
      </form>

      <div class="filters" role="group" aria-label="Filtri rapidi">
        @for (item of quickFilters; track item) {
          <button odysChip [selected]="filter() === item" (click)="filter.set(item)">{{ item }}</button>
        }
      </div>

      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}

      @if (loading()) {
        <div class="skeleton skeleton--lg" aria-busy="true" aria-label="Caricamento dei viaggi"></div>
      } @else if (featured(); as trip) {
        <odys-published-trip-card class="featured" [trip]="trip" tone="blue" [saved]="account.savedTrips().has(trip.id)" (toggleSave)="toggleSaved($event)" />

        @if (soon().length) {
          <section aria-labelledby="soon-title">
            <div class="section-head">
              <h2 id="soon-title">Partono a breve</h2>
              <a routerLink="/cerca" [queryParams]="{ ordine: 'data' }">Vedi tutti</a>
            </div>
            <div class="rail">
              @for (item of soon(); track item.trip.id; let index = $index) {
                <odys-published-trip-card size="sm" [trip]="item.trip" [tone]="railTones[index % railTones.length]" [label]="item.label" [saved]="account.savedTrips().has(item.trip.id)" (toggleSave)="toggleSaved($event)" />
              }
            </div>
          </section>
        }
      } @else if (!error()) {
        <odys-empty-state icon="compass" [title]="filter() === 'Tutti' ? 'Ancora nessun viaggio in partenza' : 'Nessun viaggio per «' + filter() + '»'"
          [description]="filter() === 'Tutti' ? 'I coordinatori Odys stanno preparando le prossime partenze.' : 'Prova un altro filtro o cerca una meta.'"
          [actionLabel]="filter() === 'Tutti' ? undefined : 'Mostra tutti'" (action)="filter.set('Tutti')" />
      }
    </div>
  `,
  styles: `
    .discover { display: flex; flex-direction: column; gap: var(--space-5); max-width: 760px; }
    .intro { display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-2); }
    .hello { color: var(--color-link); font-weight: 700; }
    h1 { font-size: clamp(2.25rem, 1.4rem + 4.4vw, 3.5rem); max-width: 14ch; }

    .search { display: flex; align-items: center; gap: var(--space-3); min-height: 64px; padding: 0 var(--space-2) 0 var(--space-5); border-radius: var(--radius-pill); background: var(--color-surface); border: var(--border-width) solid var(--color-border); color: var(--color-text-muted); box-shadow: var(--shadow-sm); transition: border-color var(--duration-fast) var(--ease-out); }
    .search:focus-within { border-color: var(--color-text); }
    .search input { flex: 1; min-width: 0; height: 48px; border: 0; outline: 0; background: transparent; color: var(--color-text); font-size: var(--text-lg); font-weight: 600; }
    .search input::placeholder { color: var(--color-text-muted); font-weight: 500; opacity: 1; }
    .search__go { display: grid; place-items: center; flex-shrink: 0; width: 48px; height: 48px; border: 0; border-radius: 50%; background: var(--odys-ink); color: var(--odys-lime); cursor: pointer; transition: transform var(--duration-fast) var(--ease-out); }
    .search__go:hover { transform: translateX(2px); }

    .filters { display: flex; gap: var(--space-2); overflow-x: auto; margin-inline: calc(-1 * var(--layout-gutter)); padding: 2px var(--layout-gutter); scrollbar-width: none; }
    .filters::-webkit-scrollbar { display: none; }
    .filters button { flex-shrink: 0; }

    .featured { min-height: 400px; }
    .featured ::ng-deep .card { min-height: 400px; }

    .section-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); margin: var(--space-4) 0 var(--space-4);
      h2 { font-size: var(--text-2xl); }
      a { font-weight: 800; text-decoration: none; min-height: 44px; display: inline-flex; align-items: center; }
      a:hover { text-decoration: underline; } }
    .rail { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(200px, 46%); gap: var(--space-3); overflow-x: auto; scroll-snap-type: x proximity; margin-inline: calc(-1 * var(--layout-gutter)); padding: 2px var(--layout-gutter) var(--space-3); scrollbar-width: none; }
    .rail::-webkit-scrollbar { display: none; }
    .rail > * { scroll-snap-align: start; }

    .skeleton { border-radius: var(--radius-xl); background: var(--color-surface-muted); animation: pulse 1.4s ease-in-out infinite; }
    .skeleton--lg { min-height: 400px; }
    @keyframes pulse { 50% { opacity: 0.55; } }

    @media (min-width: 900px) {
      .discover { max-width: var(--layout-max); display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); column-gap: var(--space-10); align-items: start; }
      .discover > odys-notice, .discover > odys-empty-state { grid-column: 1 / -1; }
      .intro, .search, .filters { grid-column: 1; }
      .intro { padding-top: var(--space-8); }
      .featured, .skeleton--lg { grid-column: 2; grid-row: 1 / span 4; }
      .discover > section { grid-column: 1 / -1; }
      .rail { grid-auto-columns: minmax(220px, 1fr); }
    }
  `,
})
export default class DiscoverPage implements OnInit {
  private readonly catalog = inject(CatalogApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  protected readonly account = inject(AccountStore);
  /** `?avviso=account-eliminato` dopo l'eliminazione dell'account. */
  readonly avviso = input<string>();

  protected readonly quickFilters: QuickFilter[] = ['Tutti', 'Weekend', 'Mare', 'Avventura', 'Città'];
  protected readonly railTones: TripCardTone[] = ['lime', 'ink', 'coral', 'blue'];
  protected readonly trips = signal<PublishedTripSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly query = signal('');
  protected readonly filter = signal<QuickFilter>('Tutti');
  protected readonly firstName = computed(() => this.account.profile()?.firstName || (this.auth.isAuthenticated() ? this.auth.displayName().split(' ')[0] : ''));

  /** Solo viaggi prenotabili, con il filtro rapido applicato. */
  private readonly filtered = computed(() => {
    const filter = this.filter();
    return this.trips().filter((trip) => trip.effectiveStatus === 'published' && (
      filter === 'Tutti' ? true : filter === 'Weekend' ? (trip.durationDays ?? 99) <= 3 : sharesInterest([filter], trip.interests)));
  });
  /** In evidenza: il più affine (il server ordina per affinità, poi per data) con posti liberi. */
  protected readonly featured = computed(() => this.filtered().find((trip) => trip.seatsLeft !== 0) ?? this.filtered()[0] ?? null);
  protected readonly soon = computed(() => {
    const featured = this.featured();
    return this.filtered()
      .filter((trip) => trip.id !== featured?.id && trip.startDate)
      .sort((a, b) => a.startDate!.localeCompare(b.startDate!))
      .slice(0, 6)
      .map((trip) => {
        const days = daysUntil(trip.startDate) ?? 0;
        return { trip, label: days <= 0 ? 'Parte oggi' : days === 1 ? 'Parte domani' : `Tra ${days} giorni` };
      });
  });

  async ngOnInit(): Promise<void> {
    // Con l'accesso il server aggiunge l'affinità: prima si aspetta la sessione.
    await this.auth.start();
    try {
      this.trips.set(await this.catalog.list());
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile caricare i viaggi.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected search(): void {
    void this.router.navigate(['/cerca'], { queryParams: { q: this.query().trim() || null } });
  }

  protected async toggleSaved(id: string): Promise<void> {
    await this.account.toggleSavedTripWithLogin(id, '/').catch((error) => this.error.set(apiErrorMessage(error, 'Non è stato possibile salvare il viaggio.')));
  }
}
