import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, type PublishedTripSummary } from '../../core/api/catalog.api';
import { AccountStore } from '../../core/state/account.store';
import { PublishedTripCardComponent } from '../../shared/travel/published-trip-card.component';
import { EmptyStateComponent, NoticeComponent } from '../../shared/ui';

/** Viaggi salvati con il cuore (TB-07): l'elenco resta collegato al viaggio del coordinatore. */
@Component({
  selector: 'odys-saved-page',
  imports: [PublishedTripCardComponent, EmptyStateComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page saved">
      <header>
        <h1>Salvati</h1>
        @if (trips().length) {<p class="meta-line muted">{{ trips().length }} {{ trips().length === 1 ? 'viaggio' : 'viaggi' }}</p>}
      </header>
      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
      @if (loading()) {
        <div class="skeleton" aria-busy="true"></div>
      } @else if (trips().length) {
        <div class="grid">
          @for (trip of trips(); track trip.id) {
            <odys-published-trip-card [trip]="trip" [saved]="account.savedTrips().has(trip.id)" (toggleSave)="remove($event)" />
          }
        </div>
      } @else if (!error()) {
        <odys-empty-state icon="heart" title="Ancora nessun viaggio salvato" description="Tocca il cuore su un viaggio per ritrovarlo qui e tenere d’occhio i posti liberi." actionLabel="Esplora i viaggi" (action)="router.navigate(['/'])" />
      }
    </div>
  `,
  styles: `
    .saved { display: flex; flex-direction: column; gap: var(--space-5); }
    header { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); h1 { font-size: var(--text-3xl); } }
    .grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); }
    .grid ::ng-deep .card { min-height: 320px; }
    .skeleton { min-height: 320px; border-radius: var(--radius-xl); background: var(--color-surface-muted); }
  `,
})
export default class SavedPage implements OnInit {
  private readonly catalog = inject(CatalogApi);
  protected readonly account = inject(AccountStore);
  protected readonly router = inject(Router);
  protected readonly trips = signal<PublishedTripSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  async ngOnInit(): Promise<void> {
    try {
      this.trips.set(await this.catalog.savedTrips());
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile caricare i viaggi salvati.'));
    } finally {
      this.loading.set(false);
    }
  }

  /** Togliere il cuore toglie il viaggio dall'elenco. */
  protected async remove(id: string): Promise<void> {
    try {
      await this.account.toggleSavedTrip(id);
      this.trips.update((list) => list.filter((trip) => trip.id !== id));
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile aggiornare i salvati.'));
    }
  }
}
