import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { displayDayDate } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, formatPrice, PARTICIPATION_STATUS_LABELS, PUBLISHED_STATUS_LABELS, type ParticipationRequest, type PublishedTrip } from '../../core/api/catalog.api';
import { AuthStore } from '../../core/auth/auth.store';
import { AccountStore } from '../../core/state/account.store';
import { TripsStore } from '../../core/state/trips.store';
import { ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';

/**
 * Dettaglio di un viaggio pubblicato (U-06, U-07, U-17): informazioni operative,
 * incluso/escluso, itinerario giorno per giorno, coordinatore (U-04).
 * Azioni: salva (U-08), usa come base (U-21), richiesta di partecipazione (U-14, U-16).
 * La richiesta non prevede pagamento: il posto lo conferma il coordinatore; il checkout (U-15) arriverà con i pagamenti.
 */
@Component({
  selector: 'odys-published-trip-page',
  imports: [DatePipe, FormsModule, RouterLink, ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './published-trip.page.html',
  styleUrl: './published-trip.page.scss',
})
export default class PublishedTripPage {
  private readonly catalog = inject(CatalogApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly trips = inject(TripsStore);
  protected readonly account = inject(AccountStore);

  readonly id = input.required<string>();

  protected readonly trip = signal<PublishedTrip | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly copying = signal(false);
  protected readonly saved = computed(() => this.account.savedTrips().has(this.id()));
  protected readonly price = computed(() => formatPrice(this.trip()?.priceCents, this.trip()?.currency));
  protected readonly statusLabel = computed(() => this.trip() ? PUBLISHED_STATUS_LABELS[this.trip()!.effectiveStatus] : '');

  /** `?partecipa=1`: al ritorno dal login riapre la richiesta di partecipazione (U-11). */
  readonly partecipa = input<string>();
  protected readonly participation = signal<ParticipationRequest | null>(null);
  protected readonly requestOpen = signal(false);
  protected readonly requestMessage = signal('');
  protected readonly requesting = signal(false);
  protected readonly requestError = signal('');
  protected readonly participationLabel = computed(() => this.participation() ? PARTICIPATION_STATUS_LABELS[this.participation()!.status] : '');
  /** Richiesta attiva: in attesa o confermata. */
  protected readonly hasActiveRequest = computed(() => ['pending', 'confirmed'].includes(this.participation()?.status ?? ''));
  protected readonly isOwnTrip = computed(() => !!this.trip() && this.trip()!.coordinator.id === this.account.profile()?.id);
  protected readonly soldOut = computed(() => this.trip()?.seatsLeft === 0);
  protected readonly bookable = computed(() => this.trip()?.effectiveStatus === 'published' && !this.soldOut());

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.trip.set(await this.catalog.get(id));
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Viaggio non disponibile.'));
    } finally {
      this.loading.set(false);
    }
    await this.loadParticipation(id);
    if (this.partecipa() === '1' && this.auth.isAuthenticated() && this.bookable() && !this.hasActiveRequest() && !this.isOwnTrip()) this.requestOpen.set(true);
  }

  /** Stato della propria richiesta (solo per chi ha effettuato l'accesso). */
  private async loadParticipation(id: string): Promise<void> {
    await this.auth.start();
    if (!this.auth.isAuthenticated()) { this.participation.set(null); return; }
    try {
      this.participation.set((await this.catalog.myParticipations()).find((item) => item.tripId === id) ?? null);
    } catch {
      this.participation.set(null);
    }
  }

  /** "Blocca il tuo posto" (U-14): chiede l'accesso solo ora (U-10) e poi riporta qui (U-11). */
  protected async openRequest(): Promise<void> {
    await this.auth.start();
    if (!this.auth.isAuthenticated()) {
      await this.router.navigate(['/accedi'], { queryParams: { ritorno: `/gruppi/${this.id()}?partecipa=1` } });
      return;
    }
    this.requestError.set('');
    this.requestOpen.set(true);
  }

  protected async sendRequest(): Promise<void> {
    this.requesting.set(true);
    this.requestError.set('');
    try {
      this.participation.set(await this.catalog.requestParticipation(this.id(), this.requestMessage().trim()));
      this.requestOpen.set(false);
      this.requestMessage.set('');
    } catch (error) {
      this.requestError.set(apiErrorMessage(error, 'Non è stato possibile inviare la richiesta.'));
    } finally {
      this.requesting.set(false);
    }
  }

  protected async withdrawRequest(): Promise<void> {
    this.requesting.set(true);
    this.requestError.set('');
    try {
      this.participation.set(await this.catalog.withdrawParticipation(this.id()));
      this.trip.set(await this.catalog.get(this.id()));
    } catch (error) {
      this.requestError.set(apiErrorMessage(error, 'Non è stato possibile ritirare la richiesta.'));
    } finally {
      this.requesting.set(false);
    }
  }

  /** Orario in formato HH:MM; altrimenti la colonna mostra un trattino. */
  protected clock(value: string | undefined): boolean {
    return /^\d{1,2}:\d{2}$/.test(value ?? '');
  }

  protected dayDate(value: string): string {
    return displayDayDate(value);
  }

  protected async toggleSaved(): Promise<void> {
    if (!(await this.ensureLoggedIn())) return;
    try {
      await this.account.toggleSavedTrip(this.id());
      this.message.set(this.saved() ? 'Salvato tra le tue idee: lo trovi nel tuo account.' : 'Rimosso dalle idee salvate.');
    } catch (error) {
      this.message.set(apiErrorMessage(error));
    }
  }

  /** Crea una copia modificabile tra i propri viaggi e la apre. */
  protected async useAsBase(): Promise<void> {
    if (!(await this.ensureLoggedIn())) return;
    this.copying.set(true);
    try {
      const copy = await this.catalog.copy(this.id());
      this.trips.upsertLocal(copy);
      await this.router.navigate(['/itinerario', copy.id]);
    } catch (error) {
      this.message.set(apiErrorMessage(error, 'Non è stato possibile copiare il viaggio.'));
    } finally {
      this.copying.set(false);
    }
  }

  private async ensureLoggedIn(): Promise<boolean> {
    await this.auth.start();
    if (this.auth.isAuthenticated()) return true;
    await this.router.navigate(['/accedi'], { queryParams: { ritorno: `/gruppi/${this.id()}` } });
    return false;
  }
}
