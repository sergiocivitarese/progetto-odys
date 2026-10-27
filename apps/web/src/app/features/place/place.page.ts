import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { findPlace, normalizePlan, recalculateRoutes, type Activity, type Itinerary, type LocationNode, type PlaceMetadata } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { ServicesApi } from '../../core/api/services.api';
import { TripsApi } from '../../core/api/trips.api';
import { TripsStore } from '../../core/state/trips.store';
import { ButtonComponent, IconComponent, InfoRowComponent, NoticeComponent, SectionHeaderComponent, StatusBadgeComponent } from '../../shared/ui';
import { placeDataState } from '@odys/domain';

/** Guida di un luogo (ex app/place.tsx): contenuti demo, info pratiche, posizione e aggiunta al viaggio. */
@Component({
  selector: 'odys-place-page',
  imports: [FormsModule, ButtonComponent, IconComponent, InfoRowComponent, NoticeComponent, SectionHeaderComponent, StatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './place.page.html',
  styleUrl: './place.page.scss',
})
export default class PlacePage {
  private readonly services = inject(ServicesApi);
  private readonly tripsApi = inject(TripsApi);
  private readonly trips = inject(TripsStore);
  protected readonly location = inject(Location);

  readonly id = input.required<string>();
  readonly title = input<string>();
  readonly destination = input<string>();
  readonly viaggio = input<string>();

  protected readonly place = signal<PlaceMetadata>(findPlace('mercato-locale'));
  protected readonly message = signal('');
  protected readonly messageTone = signal<'success' | 'info' | 'danger'>('info');
  protected readonly adding = signal(false);
  protected readonly audioOpen = signal(false);
  protected readonly editorOpen = signal(false);
  protected readonly query = signal('');
  protected readonly results = signal<LocationNode[]>([]);
  protected readonly searchMessage = signal('');
  protected readonly geoState = computed(() => placeDataState({ time: '', title: '', detail: '', category: this.place().category, place: this.place() }));

  constructor() {
    effect(() => {
      const [id, title, destination] = [this.id(), this.title(), this.destination()];
      untracked(() => void this.load(id, title, destination));
    });
  }

  private async load(id: string, title?: string, destination?: string): Promise<void> {
    this.place.set(findPlace(id, title, destination));
    try {
      this.place.set(await this.services.place(id, title, destination));
    } catch {
      // Resta la scheda locale: il contenuto è demo in ogni caso.
    }
  }

  protected async addToTrip(): Promise<void> {
    const tripId = this.viaggio();
    if (!tripId) {
      this.notify('Salva prima il viaggio: potrai poi aggiungere questa tappa senza perderla.', 'info');
      return;
    }
    this.adding.set(true);
    try {
      const trip = await this.tripsApi.get(tripId);
      const place = this.place();
      if (trip.itinerary.days.some((day) => day.activities.some((activity) => activity.place?.id === place.id))) {
        this.notify('Questo luogo è già presente nel viaggio.', 'info');
        return;
      }
      const activity: Activity = { time: '16:30', title: place.title, detail: place.whyRecommended, category: place.category, transport: 'a piedi', setting: place.setting ?? 'outdoor', requiresBooking: false, place };
      const itinerary: Itinerary = { ...trip.itinerary, days: trip.itinerary.days.map((day, index) => index === 0 ? { ...day, activities: [...day.activities, activity] } : day), version: 5 };
      await this.trips.save(normalizePlan(recalculateRoutes(itinerary, itinerary.lodging)), trip.id, { title: trip.title, changeKind: 'edited' });
      this.notify('Luogo aggiunto al primo giorno del viaggio.', 'success');
    } catch (error) {
      this.notify(apiErrorMessage(error), 'danger');
    } finally {
      this.adding.set(false);
    }
  }

  protected async search(): Promise<void> {
    try {
      const result = await this.services.searchPlace(this.query());
      this.results.set(result.candidates);
      this.searchMessage.set(result.message ?? (result.candidates.length ? 'Scegli il luogo corretto per confermare la posizione.' : 'Nessun risultato: conserviamo il testo senza inventare una posizione.'));
    } catch {
      this.searchMessage.set('Ricerca non disponibile in questo momento.');
    }
  }

  protected select(node: LocationNode): void {
    this.place.update((current) => ({
      ...current,
      id: node.providerPlaceId ? `geoapify-${node.providerPlaceId}` : current.id,
      title: node.label,
      address: node.address ?? current.address,
      city: node.city ?? current.city,
      country: node.country ?? current.country,
      timezone: node.timezone ?? current.timezone,
      latitude: node.latitude,
      longitude: node.longitude,
      placeId: node.providerPlaceId ?? node.providerId ?? current.placeId,
      providerId: node.providerId,
      providerPlaceId: node.providerPlaceId,
      confidence: node.confidence,
      source: node.source ?? current.source,
      updatedAt: node.updatedAt ?? current.updatedAt,
      geoStatus: node.geoStatus === 'TO_VERIFY' ? 'TO_VERIFY' : 'CONFIRMED',
    }));
    this.results.set([]);
    this.editorOpen.set(false);
    this.notify('Luogo aggiornato: la posizione selezionata verrà salvata quando lo aggiungi al viaggio.', 'info');
  }

  private notify(text: string, tone: 'success' | 'info' | 'danger'): void {
    this.message.set(text);
    this.messageTone.set(tone);
  }
}
