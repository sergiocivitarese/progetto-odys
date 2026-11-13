import { DatePipe } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MAX_TRIP_PARTICIPANTS, TRIP_INTERESTS } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, PUBLISHED_STATUS_LABELS, type CoordinatorAction, type PublishedTrip, type PublishedTripForm, type TripVisibility } from '../../core/api/catalog.api';
import { TripsStore } from '../../core/state/trips.store';
import { ButtonComponent, ChipComponent, IconComponent, NoticeComponent, TextFieldComponent } from '../../shared/ui';
import { CoordinatorAccessComponent } from './coordinator-access.component';

function lines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * Creazione e modifica di un viaggio pubblicato (C-09, C-12, C-13).
 * Si parte da un itinerario salvato; si aggiungono i dati di vendita;
 * poi si pubblica subito, si programma o si lascia in bozza.
 */
@Component({
  selector: 'odys-published-trip-editor-page',
  imports: [FormsModule, DatePipe, RouterLink, ButtonComponent, ChipComponent, IconComponent, NoticeComponent, TextFieldComponent, CoordinatorAccessComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './published-trip-editor.page.html',
  styleUrl: './published-trip-editor.page.scss',
})
export default class PublishedTripEditorPage implements AfterViewInit {
  private readonly api = inject(CatalogApi);
  private readonly router = inject(Router);
  protected readonly trips = inject(TripsStore);
  private readonly access = viewChild.required(CoordinatorAccessComponent);

  /** Parametro di rotta: assente per un nuovo viaggio. */
  readonly id = input<string>();

  protected readonly ready = signal(false);
  protected readonly existing = signal<PublishedTrip | null>(null);
  protected readonly sourceTripId = signal('');
  protected readonly title = signal('');
  protected readonly summary = signal('');
  protected readonly destination = signal('');
  protected readonly startDate = signal('');
  protected readonly endDate = signal('');
  protected readonly price = signal('');
  protected readonly capacity = signal('');
  protected readonly included = signal('');
  protected readonly excluded = signal('');
  protected readonly coverImageUrl = signal('');
  protected readonly scheduledFor = signal('');
  // Dati per ricerca, affinità e prenotazione (CB-02, CB-04, CB-05).
  protected readonly country = signal('');
  protected readonly region = signal('');
  protected readonly interests = signal<string[]>([]);
  protected readonly deposit = signal('');
  protected readonly balanceDueDate = signal('');
  protected readonly visibility = signal<TripVisibility>('public');
  protected readonly ageMin = signal('');
  protected readonly ageMax = signal('');
  protected readonly interestOptions = TRIP_INTERESTS;
  protected readonly maxSeats = MAX_TRIP_PARTICIPANTS;
  protected readonly visibilities: Array<{ value: TripVisibility; label: string; hint: string }> = [
    { value: 'public', label: 'Pubblico', hint: 'Lo vede chiunque, in Esplora e nella ricerca.' },
    { value: 'followers', label: 'Follower', hint: 'Lo vede solo chi ti segue.' },
    { value: 'invite', label: 'Su invito', hint: 'Resta fuori dal catalogo: gli inviti arrivano in una prossima versione.' },
  ];
  protected readonly visibilityHint = computed(() => this.visibilities.find((item) => item.value === this.visibility())?.hint ?? '');

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly isNew = computed(() => !this.id());
  protected readonly status = computed(() => this.existing()?.effectiveStatus ?? 'draft');
  protected readonly statusLabel = computed(() => PUBLISHED_STATUS_LABELS[this.status()]);
  protected readonly isPublic = computed(() => ['published', 'active', 'completed'].includes(this.status()));

  async ngAfterViewInit(): Promise<void> {
    if (!(await this.access().check())) return;
    await this.start();
  }

  async start(): Promise<void> {
    this.ready.set(true);
    await this.trips.load();
    const id = this.id();
    if (!id) {
      const first = this.trips.trips()[0];
      if (first) this.chooseSource(first.id);
      return;
    }
    try {
      this.fill(await this.api.myPublishedTrip(id));
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Viaggio non trovato.'));
    }
  }

  protected chooseSource(id: string): void {
    this.sourceTripId.set(id);
    const trip = this.trips.trips().find((item) => item.id === id);
    if (!trip) return;
    if (!this.title()) this.title.set(trip.title);
    this.destination.set(trip.itinerary.destination);
    this.startDate.set(trip.itinerary.departure ?? '');
    this.endDate.set(trip.itinerary.returnDate ?? '');
  }

  private fill(trip: PublishedTrip): void {
    this.existing.set(trip);
    this.title.set(trip.title);
    this.summary.set(trip.summary);
    this.destination.set(trip.destination);
    this.startDate.set(trip.startDate ?? '');
    this.endDate.set(trip.endDate ?? '');
    this.price.set(trip.priceCents !== undefined ? String(trip.priceCents / 100) : '');
    this.capacity.set(trip.capacity !== undefined ? String(trip.capacity) : '');
    this.included.set(trip.included.join('\n'));
    this.excluded.set(trip.excluded.join('\n'));
    this.coverImageUrl.set(trip.coverImageUrl ?? '');
    this.country.set(trip.country);
    this.region.set(trip.region);
    this.interests.set([...trip.interests]);
    this.deposit.set(trip.depositCents !== undefined ? String(trip.depositCents / 100) : '');
    this.balanceDueDate.set(trip.balanceDueDate ?? '');
    this.visibility.set(trip.visibility);
    this.ageMin.set(trip.ageMin !== undefined ? String(trip.ageMin) : '');
    this.ageMax.set(trip.ageMax !== undefined ? String(trip.ageMax) : '');
  }

  protected toggleInterest(item: string): void {
    this.interests.update((list) => (list.includes(item) ? list.filter((value) => value !== item) : [...list, item]));
  }

  private form(): PublishedTripForm {
    const price = this.price().trim().replace(',', '.');
    const capacity = this.capacity().trim();
    const deposit = this.deposit().trim().replace(',', '.');
    return {
      title: this.title().trim(),
      summary: this.summary().trim(),
      destination: this.destination().trim(),
      startDate: this.startDate(),
      endDate: this.endDate(),
      price: price ? Number(price) : undefined,
      capacity: capacity ? Number(capacity) : undefined,
      included: lines(this.included()),
      excluded: lines(this.excluded()),
      coverImageUrl: this.coverImageUrl().trim(),
      country: this.country().trim(),
      region: this.region().trim(),
      interests: this.interests(),
      deposit: deposit ? Number(deposit) : undefined,
      balanceDueDate: this.balanceDueDate(),
      visibility: this.visibility(),
      ageMin: this.ageMin().trim() ? Number(this.ageMin()) : null,
      ageMax: this.ageMax().trim() ? Number(this.ageMax()) : null,
    };
  }

  /** Salva i dati; per un nuovo viaggio crea la bozza e passa alla sua pagina. */
  protected async save(): Promise<PublishedTrip | null> {
    return this.run(async () => {
      const existing = this.existing();
      if (!existing) {
        if (!this.sourceTripId()) throw new Error('Scegli uno dei tuoi viaggi da cui partire.');
        const created = await this.api.createPublished({ ...this.form(), sourceTripId: this.sourceTripId() });
        this.fill(created);
        await this.router.navigate(['/coordinatore', created.id], { replaceUrl: true });
        this.message.set('Bozza salvata. Quando è pronta, pubblicala o programmala.');
        return created;
      }
      const updated = await this.api.updatePublished(existing.id, this.form());
      this.fill(updated);
      this.message.set('Modifiche salvate.');
      return updated;
    });
  }

  protected async refreshItinerary(): Promise<void> {
    const existing = this.existing();
    if (!existing) return;
    await this.run(async () => {
      this.fill(await this.api.updatePublished(existing.id, { refreshItinerary: true }));
      this.message.set('Itinerario aggiornato con l’ultima versione del tuo viaggio.');
      return null;
    });
  }

  protected async act(action: CoordinatorAction): Promise<void> {
    if (action === 'schedule' && !this.scheduledFor()) {
      this.error.set('Scegli data e ora di pubblicazione.');
      return;
    }
    const saved = await this.save();
    if (!saved) return;
    await this.run(async () => {
      const scheduled = action === 'schedule' ? new Date(this.scheduledFor()).toISOString() : undefined;
      this.fill(await this.api.changeStatus(saved.id, action, scheduled));
      const messages: Record<CoordinatorAction, string> = {
        publish: this.visibility() === 'public' ? 'Viaggio pubblicato: ora è visibile a tutti in Esplora.' : this.visibility() === 'followers' ? 'Viaggio pubblicato per chi ti segue.' : 'Viaggio pubblicato su invito: resta fuori dal catalogo.',
        schedule: 'Pubblicazione programmata.',
        unpublish: 'Il viaggio è tornato in bozza e non è più visibile al pubblico.',
        cancel: 'Viaggio annullato.',
        archive: 'Viaggio archiviato.',
      };
      this.message.set(messages[action]);
      return null;
    });
  }

  private async run<T>(action: () => Promise<T>): Promise<T | null> {
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      return await action();
    } catch (error) {
      this.error.set(error instanceof Error && !('status' in error) ? error.message : apiErrorMessage(error));
      return null;
    } finally {
      this.busy.set(false);
    }
  }
}
