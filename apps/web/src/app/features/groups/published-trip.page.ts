import { OrganizerBadgeComponent } from '../../shared/travel/organizer-badge.component';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { displayDayDate, MAX_TRIP_PARTICIPANTS } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import {
  CatalogApi, formatAmount, formatDateRange, initialsOf, PARTICIPATION_STATUS_LABELS, PUBLISHED_STATUS_LABELS,
  type MyParticipation, type PlaceStory, type PublishedTrip,
} from '../../core/api/catalog.api';
import { AuthStore } from '../../core/auth/auth.store';
import { AccountStore } from '../../core/state/account.store';
import { EntitlementsStore } from '../../core/state/entitlements.store';
import { TripsStore } from '../../core/state/trips.store';
import { toneOf } from '../../shared/travel/published-trip-card.component';
import { StopsMapComponent, tripStops } from '../../shared/travel/stops-map.component';
import { ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';

/**
 * Dettaglio di un viaggio pubblicato (TB-06): copertina con la meta, coordinatore,
 * mappa delle tappe, itinerario in breve e giorno per giorno, incluso/escluso,
 * partecipanti e barra fissa con prezzo, acconto e «Blocca il tuo posto» (TB-08).
 * Il cuore salva il viaggio (TB-07); «Usa come base» ne copia l'itinerario (U-21).
 */
@Component({
  selector: 'odys-published-trip-page',
  imports: [RouterLink, ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent, StopsMapComponent, OrganizerBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './published-trip.page.html',
  styleUrl: './published-trip.page.scss',
})
export default class PublishedTripPage {
  private readonly catalog = inject(CatalogApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly trips = inject(TripsStore);
  private readonly entitlements = inject(EntitlementsStore);
  protected readonly account = inject(AccountStore);

  readonly id = input.required<string>();
  /** `?prenota=1`: al ritorno dal login riprende «Blocca il tuo posto» (TB-08). */
  readonly prenota = input<string>();
  /** `?canale=diretto`: si arriva dal link condiviso fuori da Odys (AG-07). Resta memorizzato anche dopo l'accesso. */
  readonly canale = input<string>();

  protected readonly trip = signal<PublishedTrip | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly busy = signal(false);
  protected readonly copying = signal(false);
  protected readonly showDays = signal(false);
  protected readonly openStory = signal('');
  protected readonly booking = signal<MyParticipation | null>(null);

  protected readonly saved = computed(() => this.account.savedTrips().has(this.id()));
  protected readonly tone = computed(() => toneOf(this.id()));
  protected readonly price = computed(() => formatAmount(this.trip()?.priceCents, this.trip()?.currency));
  protected readonly deposit = computed(() => formatAmount(this.trip()?.depositCents, this.trip()?.currency));
  protected readonly stops = computed(() => (this.trip() ? tripStops(this.trip()!.itinerary) : []));
  protected readonly coordinatorInitials = computed(() => initialsOf(this.trip()?.coordinator.displayName ?? ''));
  protected readonly metaLine = computed(() => {
    const trip = this.trip();
    if (!trip) return '';
    const days = trip.durationDays ?? trip.itinerary.days.length;
    return [trip.country || trip.region, formatDateRange(trip.startDate, trip.endDate, true), `${days} gg`].filter(Boolean).join(' · ');
  });
  /** Posti presi su 12 (o sulla capienza), per la barra a segmenti. */
  protected readonly seats = computed(() => {
    const trip = this.trip();
    const capacity = trip?.capacity ?? MAX_TRIP_PARTICIPANTS;
    const taken = trip?.seatsLeft === undefined ? undefined : capacity - trip.seatsLeft;
    return { capacity, taken, segments: Array.from({ length: capacity }, (_, index) => taken !== undefined && index < taken) };
  });
  protected readonly ageRange = computed(() => {
    const trip = this.trip();
    if (!trip?.ageMin && !trip?.ageMax) return '';
    if (trip.ageMin && trip.ageMax) return `${trip.ageMin}–${trip.ageMax} anni`;
    return trip.ageMin ? `dai ${trip.ageMin} anni` : `fino a ${trip.ageMax} anni`;
  });
  protected readonly avatars = computed(() => {
    const list = this.trip()?.participants ?? [];
    return { shown: list.slice(0, 2), more: Math.max(0, list.length - 2) };
  });
  protected readonly statusLabel = computed(() => (this.trip() ? PUBLISHED_STATUS_LABELS[this.trip()!.effectiveStatus] : ''));
  protected readonly isOwnTrip = computed(() => !!this.trip() && this.trip()!.coordinator.id === this.account.profile()?.id);
  protected readonly soldOut = computed(() => this.trip()?.seatsLeft === 0);
  protected readonly bookable = computed(() => this.trip()?.effectiveStatus === 'published' && !this.soldOut());
  /** Prenotazione con acconto già pagato: si segue da Prossimo viaggio. */
  protected readonly activeBooking = computed(() => {
    const booking = this.booking();
    return booking && ['pending', 'confirmed', 'balance_paid'].includes(booking.status) ? booking : null;
  });
  protected readonly bookingLabel = computed(() => (this.activeBooking() ? PARTICIPATION_STATUS_LABELS[this.activeBooking()!.status] : ''));
  protected readonly ctaLabel = computed(() => {
    if (this.soldOut()) return 'Tutto esaurito';
    if (!this.bookable()) return 'Iscrizioni chiuse';
    return this.booking()?.status === 'declined' ? 'Richiesta non accettata' : 'Blocca il tuo posto';
  });

  constructor() {
    // Il canale si memorizza all'arrivo: il ritorno dopo l'accesso non porta più `?canale=diretto`.
    effect(() => { if (this.canale() === 'diretto') untracked(() => this.channel()); });
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.showDays.set(false);
    // Con l'accesso il server aggiunge affinità e viaggi «Solo follower».
    await this.auth.start();
    try {
      this.trip.set(await this.catalog.get(id));
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Viaggio non disponibile.'));
    } finally {
      this.loading.set(false);
    }
    await this.loadBooking(id);
    if (this.prenota() === '1' && this.auth.isAuthenticated() && this.bookable() && !this.activeBooking() && !this.isOwnTrip()) void this.reserve();
  }

  private async loadBooking(id: string): Promise<void> {
    if (!this.auth.isAuthenticated()) { this.booking.set(null); return; }
    try {
      this.booking.set((await this.catalog.myParticipations()).find((item) => item.tripId === id) ?? null);
    } catch {
      this.booking.set(null);
    }
  }

  /** «Blocca il tuo posto» (TB-08): login se serve, con ritorno qui; poi riserva e checkout. */
  private channel(): 'odys' | 'direct' {
    const key = `odys-canale-${this.id()}`;
    try {
      if (this.canale() === 'diretto') sessionStorage.setItem(key, 'direct');
      return sessionStorage.getItem(key) === 'direct' ? 'direct' : 'odys';
    } catch {
      return this.canale() === 'diretto' ? 'direct' : 'odys';
    }
  }

  protected async reserve(): Promise<void> {
    await this.auth.start();
    if (!this.auth.isAuthenticated()) {
      await this.router.navigate(['/accedi'], { queryParams: { ritorno: `/gruppi/${this.id()}?prenota=1` } });
      return;
    }
    await this.entitlements.refresh();
    if (!this.entitlements.has('trips.book')) {
      await this.router.navigate(['/premium'], { queryParams: { funzione: 'trips.book' } });
      return;
    }
    this.busy.set(true);
    this.message.set('');
    try {
      const booking = await this.catalog.reserve(this.id(), this.channel());
      await this.router.navigate(['/prenota', booking.id]);
    } catch (error) {
      this.message.set(apiErrorMessage(error, 'Non è stato possibile bloccare il posto.'));
      this.trip.set(await this.catalog.get(this.id()).catch(() => this.trip()));
    } finally {
      this.busy.set(false);
    }
  }

  /** Tempo di lettura a circa 200 parole al minuto. */
  protected readingMinutes(story: PlaceStory): number {
    return Math.max(1, Math.round(`${story.intro} ${story.body}`.split(/\s+/).length / 200));
  }

  protected dayDate(value: string): string {
    return displayDayDate(value);
  }

  /** Orario in formato HH:MM; altrimenti la colonna mostra un trattino. */
  protected clock(value: string | undefined): boolean {
    return /^\d{1,2}:\d{2}$/.test(value ?? '');
  }

  protected async toggleSaved(): Promise<void> {
    try {
      if (await this.account.toggleSavedTripWithLogin(this.id(), `/gruppi/${this.id()}`)) {
        this.message.set(this.saved() ? 'Salvato: lo ritrovi in Salvati.' : 'Tolto dai salvati.');
      }
    } catch (error) {
      this.message.set(apiErrorMessage(error));
    }
  }

  protected async share(): Promise<void> {
    const url = location.href;
    const title = this.trip()?.title ?? 'Odys';
    try {
      if (navigator.share) await navigator.share({ title, url });
      else { await navigator.clipboard.writeText(url); this.message.set('Link copiato.'); }
    } catch {
      // Condivisione annullata: nessun messaggio.
    }
  }

  /** Crea una copia modificabile tra i propri viaggi e la apre. */
  protected async useAsBase(): Promise<void> {
    await this.auth.start();
    if (!this.auth.isAuthenticated()) {
      await this.router.navigate(['/accedi'], { queryParams: { ritorno: `/gruppi/${this.id()}` } });
      return;
    }
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
}
