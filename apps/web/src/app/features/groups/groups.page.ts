import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { GroupTrip } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, type CatalogQuery, type PublishedTripSummary } from '../../core/api/catalog.api';
import { ServicesApi } from '../../core/api/services.api';
import { AuthStore } from '../../core/auth/auth.store';
import { AccountStore } from '../../core/state/account.store';
import { PublishedTripCardComponent } from '../../shared/travel/published-trip-card.component';
import { ButtonComponent, ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent, StatusBadgeComponent } from '../../shared/ui';

/**
 * Viaggi di gruppo: i viaggi pubblicati dai coordinatori (U-01…U-04, U-08),
 * consultabili senza accesso e salvabili con un account.
 */
@Component({
  selector: 'odys-groups-page',
  imports: [FormsModule, PublishedTripCardComponent, ButtonComponent, ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent, StatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './groups.page.html',
  styleUrl: './groups.page.scss',
})
export default class GroupsPage implements OnInit {
  private readonly catalog = inject(CatalogApi);
  private readonly services = inject(ServicesApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  protected readonly account = inject(AccountStore);

  protected readonly trips = signal<PublishedTripSummary[]>([]);
  protected readonly examples = signal<GroupTrip[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly query = signal('');
  protected readonly sort = signal<NonNullable<CatalogQuery['sort']>>('upcoming');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit(): void {
    void this.load();
  }

  protected onQuery(value: string): void {
    this.query.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(), 350);
  }

  protected setSort(sort: NonNullable<CatalogQuery['sort']>): void {
    this.sort.set(sort);
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.trips.set(await this.catalog.list({ q: this.query().trim(), sort: this.sort() }));
    } catch (error) {
      this.trips.set([]);
      this.error.set(apiErrorMessage(error, 'Non è stato possibile caricare i viaggi di gruppo.'));
    } finally {
      this.loading.set(false);
    }
    if (!this.trips().length && !this.query() && !this.examples().length) {
      this.examples.set(await this.services.groupTrips().catch(() => []));
    }
  }

  /** Salva o rimuove il viaggio; senza accesso porta al login e poi torna qui (U-10, U-11). */
  protected async toggleSaved(id: string): Promise<void> {
    if (!(await this.ensureLoggedIn())) return;
    try {
      await this.account.toggleSavedTrip(id);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile salvare il viaggio.'));
    }
  }

  protected async toggleExample(id: string): Promise<void> {
    if (!(await this.ensureLoggedIn())) return;
    await this.account.toggleIdea(id).catch(() => undefined);
  }

  private async ensureLoggedIn(): Promise<boolean> {
    await this.auth.start();
    if (this.auth.isAuthenticated()) return true;
    await this.router.navigate(['/accedi'], { queryParams: { ritorno: '/gruppi' } });
    return false;
  }
}
