import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { SavedTrip } from '@odys/domain';
import { TripsStore } from '../../core/state/trips.store';
import { AuthStore } from '../../core/auth/auth.store';
import { TripCardComponent } from '../../shared/travel/trip-card.component';
import { TripManagementDialogsComponent } from '../../shared/travel/trip-management-dialogs.component';
import { ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent, SectionHeaderComponent } from '../../shared/ui';
import { HomeHeroComponent } from './components/home-hero.component';
import { ImportTripDialogComponent } from './components/import-trip-dialog.component';

/** Home: ispirazione, viaggi salvati, prossimo viaggio, import e viaggi di gruppo. */
@Component({
  selector: 'odys-home-page',
  imports: [
    RouterLink, DatePipe, HomeHeroComponent, ImportTripDialogComponent, TripCardComponent, TripManagementDialogsComponent,
    ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent, SectionHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
})
export default class HomePage implements OnInit {
  protected readonly store = inject(TripsStore);
  protected readonly auth = inject(AuthStore);
  /** `?avviso=account-eliminato` dopo l'eliminazione dell'account. */
  readonly avviso = input<string>();
  private readonly router = inject(Router);

  protected readonly previewTrips = computed(() => this.store.trips().slice(0, 4));
  protected readonly importOpen = signal(false);
  protected readonly importMessage = signal('');
  protected readonly renaming = signal<SavedTrip | null>(null);
  protected readonly deleting = signal<SavedTrip | null>(null);

  ngOnInit(): void {
    void this.store.load();
  }

  protected openTrip(trip: SavedTrip): void {
    void this.router.navigate(['/itinerario', trip.id]);
  }

  protected openImport(): void {
    this.importMessage.set('');
    if (!this.auth.isAuthenticated()) {
      void this.router.navigate(['/accedi'], { queryParams: { ritorno: '/' } });
      return;
    }
    this.importOpen.set(true);
  }

  protected goToPlanner(): void {
    void this.router.navigate(['/pianifica']);
  }

  protected onImported(result: { trip: SavedTrip; replaced: boolean }): void {
    this.importOpen.set(false);
    this.importMessage.set(result.replaced ? `“${result.trip.title}” è stato sostituito con l’export confermato.` : `“${result.trip.title}” è stato importato.`);
  }

  protected closeManagement(): void {
    this.renaming.set(null);
    this.deleting.set(null);
  }
}
