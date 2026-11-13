import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CatalogApi, formatDateRange, PARTICIPATION_STATUS_LABELS, type MyParticipation } from '../../core/api/catalog.api';
import { EntitlementsStore } from '../../core/state/entitlements.store';
import type { SavedTrip } from '@odys/domain';
import { TripsStore } from '../../core/state/trips.store';
import { TripCardComponent } from '../../shared/travel/trip-card.component';
import { TripManagementDialogsComponent } from '../../shared/travel/trip-management-dialogs.component';
import { ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';
import { ImportTripDialogComponent } from './import-trip-dialog.component';

/** Tutti i viaggi salvati, ordinati dall'ultima modifica, con ricerca per nome o destinazione. */
@Component({
  selector: 'odys-trips-page',
  imports: [FormsModule, RouterLink, TripCardComponent, TripManagementDialogsComponent, ImportTripDialogComponent, ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="head">
        <h1>I miei viaggi</h1>
        <p class="muted">I viaggi sono ordinati dall’ultima modifica e restano salvati nel tuo spazio Odys.</p>
        <div class="row">
          @if (entitlements.has('ai.generate')) {<button odysButton variant="primary" size="sm" icon="sparkles" (click)="router.navigate(['/crea'])">Crea con il generatore</button>}
          <button odysButton [variant]="entitlements.has('ai.generate') ? 'secondary' : 'primary'" size="sm" icon="plus" (click)="router.navigate(['/pianifica'])">Nuovo viaggio</button>
          <button odysButton variant="secondary" size="sm" icon="upload" (click)="importMessage.set(''); importOpen.set(true)">Importa JSON</button>
        </div>
      </header>
      @if (importMessage()) {<odys-notice tone="success">{{ importMessage() }}</odys-notice>}

      @if (booked().length) {
        <section class="booked" aria-labelledby="booked-title">
          <h2 id="booked-title">Prenotati</h2>
          <ul>
            @for (item of booked(); track item.id) {
              <li>
                <a [routerLink]="['/gruppi', item.tripId]">
                  <span class="booked__cover" aria-hidden="true">{{ item.trip!.destination.slice(0, 3) }}</span>
                  <span class="booked__text"><strong>{{ item.trip!.title }}</strong><span>{{ dates(item) }} · con {{ item.trip!.coordinator.displayName }}</span></span>
                  <span class="booked__status">{{ status(item) }}</span>
                </a>
              </li>
            }
          </ul>
          <a class="booked__more" routerLink="/prossimo-viaggio">Prossimo viaggio<odys-icon name="arrow-right" [size]="16" /></a>
        </section>
        <h2 class="own-title">I tuoi itinerari</h2>
      }
      @if (!entitlements.has('ai.generate') && !store.loading()) {
        <a class="upsell" routerLink="/premium" [queryParams]="{ funzione: 'ai.generate' }"><odys-icon name="sparkles" [size]="20" /><span><strong>Con Premium</strong> l’itinerario te lo prepara Odys: meta, date, budget e interessi.</span><odys-icon name="chevron-right" [size]="18" /></a>
      }

      @if (store.trips().length > 3) {
        <label class="search">
          <odys-icon name="search" [size]="18" />
          <span class="visually-hidden">Cerca nei tuoi viaggi</span>
          <input type="search" placeholder="Cerca per nome o destinazione" [ngModel]="query()" (ngModelChange)="query.set($event)" />
        </label>
      }

      @if (store.error()) {<odys-notice tone="danger">{{ store.error() }}</odys-notice>}

      @if (!store.loading() && store.trips().length === 0) {
        <odys-empty-state icon="bookmark" title="La raccolta è vuota" description="Crea un viaggio e salvalo: lo ritroverai qui, pronto da riaprire." actionLabel="Crea un viaggio" (action)="router.navigate(['/pianifica'])" />
      } @else {
        <div class="grid">
          @for (trip of filtered(); track trip.id) {
            <odys-trip-card [trip]="trip" (open)="router.navigate(['/itinerario', $event.id])" (rename)="renaming.set($event)" (remove)="deleting.set($event)" />
          } @empty {
            @if (!store.loading()) {<p class="muted">Nessun viaggio corrisponde a “{{ query() }}”.</p>}
          }
        </div>
      }
    </div>
    <odys-trip-management-dialogs [renaming]="renaming()" [deleting]="deleting()" (done)="renaming.set(null); deleting.set(null)" />
    <odys-import-trip-dialog [open]="importOpen()" (closed)="importOpen.set(false)" (imported)="onImported($event)" />
  `,
  styles: `
    .head { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-6); }
    h1 { font-size: var(--text-3xl); }
    .search { display: flex; align-items: center; gap: var(--space-2); max-width: 420px; min-height: 48px; padding: 0 var(--space-4); margin-bottom: var(--space-5); border-radius: var(--radius-pill); background: var(--color-surface); border: var(--border-width) solid var(--color-border-strong); color: var(--color-text-muted); }
    .search:focus-within { border-color: var(--color-primary); }
    .search input { flex: 1; border: 0; outline: 0; background: transparent; color: var(--color-text); }
    .booked { margin-bottom: var(--space-6);
      h2 { font-size: var(--text-xl); margin-bottom: var(--space-3); }
      ul { list-style: none; margin: 0 0 var(--space-2); padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
      li a { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--space-3); padding: var(--space-3); border-radius: var(--radius-xl); background: var(--color-surface); border: var(--border-width) solid var(--color-border); color: var(--color-text); text-decoration: none; }
      li a:hover { border-color: var(--color-text); } }
    .booked__cover { display: grid; place-items: center; width: 56px; height: 56px; border-radius: var(--radius-md); background: var(--odys-blue); color: #fff; font-weight: 900; font-size: var(--text-sm); text-transform: uppercase; }
    .booked__text { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; strong { font-weight: 900; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } span { color: var(--color-text-muted); font-size: var(--text-sm); } }
    .booked__status { padding: 4px 12px; border-radius: var(--radius-pill); background: var(--odys-lime); color: var(--odys-ink); font-size: var(--text-xs); font-weight: 900; white-space: nowrap; }
    .booked__more { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; font-weight: 800; text-decoration: none; }
    .own-title { font-size: var(--text-xl); margin-bottom: var(--space-3); }
    .upsell { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-5); padding: var(--space-4); border-radius: var(--radius-xl); background: var(--odys-lime); color: var(--odys-ink); text-decoration: none; line-height: 1.35; span { flex: 1; } strong { font-weight: 900; } }
    .grid { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); }
  `,
})
export default class TripsPage implements OnInit {
  protected readonly store = inject(TripsStore);
  protected readonly router = inject(Router);
  protected readonly query = signal('');
  protected readonly renaming = signal<SavedTrip | null>(null);
  protected readonly deleting = signal<SavedTrip | null>(null);
  protected readonly filtered = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('it');
    return query
      ? this.store.trips().filter((trip) => `${trip.title} ${trip.itinerary.destination}`.toLocaleLowerCase('it').includes(query))
      : this.store.trips();
  });

  private readonly catalog = inject(CatalogApi);
  protected readonly entitlements = inject(EntitlementsStore);
  /** Viaggi di gruppo prenotati (acconto pagato): stanno nella stessa lista degli itinerari (TP-04). */
  protected readonly booked = signal<MyParticipation[]>([]);
  protected readonly importOpen = signal(false);
  protected readonly importMessage = signal('');

  ngOnInit(): void {
    void this.store.load();
    void this.catalog.myParticipations()
      .then((list) => this.booked.set(list.filter((item) => item.trip && ['pending', 'confirmed', 'balance_paid'].includes(item.status))))
      .catch(() => undefined); // un elenco in più: se non risponde restano gli itinerari
  }

  protected dates(item: MyParticipation): string { return formatDateRange(item.trip?.startDate, item.trip?.endDate, true); }
  protected status(item: MyParticipation): string { return PARTICIPATION_STATUS_LABELS[item.status]; }

  protected onImported(result: { trip: SavedTrip; replaced: boolean }): void {
    this.importOpen.set(false);
    this.importMessage.set(result.replaced ? `“${result.trip.title}” è stato sostituito con l’export confermato.` : `“${result.trip.title}” è stato importato.`);
  }
}
