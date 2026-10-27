import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { SavedTrip } from '@odys/domain';
import { TripsStore } from '../../core/state/trips.store';
import { TripCardComponent } from '../../shared/travel/trip-card.component';
import { TripManagementDialogsComponent } from '../../shared/travel/trip-management-dialogs.component';
import { EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';

/** Tutti i viaggi salvati, ordinati dall'ultima modifica, con ricerca per nome o destinazione. */
@Component({
  selector: 'odys-trips-page',
  imports: [FormsModule, TripCardComponent, TripManagementDialogsComponent, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="head">
        <p class="eyebrow">La tua raccolta</p>
        <h1>I miei viaggi</h1>
        <p class="muted">I viaggi sono ordinati dall’ultima modifica e restano salvati nel tuo spazio Odys.</p>
      </header>

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
  `,
  styles: `
    .head { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-6); }
    h1 { font-size: var(--text-3xl); }
    .search { display: flex; align-items: center; gap: var(--space-2); max-width: 420px; min-height: 48px; padding: 0 var(--space-4); margin-bottom: var(--space-5); border-radius: var(--radius-pill); background: var(--color-surface); border: var(--border-width) solid var(--color-border-strong); color: var(--color-text-muted); }
    .search:focus-within { border-color: var(--color-primary); }
    .search input { flex: 1; border: 0; outline: 0; background: transparent; color: var(--color-text); }
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

  ngOnInit(): void {
    void this.store.load();
  }
}
