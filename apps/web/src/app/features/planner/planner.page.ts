import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  ARRIVAL_MODES,
  ARRIVAL_TRANSPORT_LABELS,
  PACE_OPTIONS,
  RECOMMENDED_INTERESTS,
  arrivalOption,
  arrivalPointFieldLabel,
  calculateDuration,
  customInterestError,
  initialTripForm,
  locationFromText,
  stopError,
  validateTripForm,
  type ArrivalDestinationKind,
  type ArrivalTransport,
  type LocationNode,
  type LodgingInfo,
  type RecommendedInterest,
  type TripForm,
} from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { ItineraryApi } from '../../core/api/itinerary.api';
import { AuthStore } from '../../core/auth/auth.store';
import { PlanDraftStore } from '../../core/state/plan-draft.store';
import { TripsStore } from '../../core/state/trips.store';
import { PlaceFieldComponent } from '../../shared/travel/place-field.component';
import { ButtonComponent, ChipComponent, IconComponent, NoticeComponent, TextFieldComponent } from '../../shared/ui';
import { PlannerSectionComponent } from './components/planner-section.component';

type SectionId = 'destination' | 'arrival' | 'lodging' | 'interests';

/**
 * Modulo "Pianifica il mio viaggio" (ex app/create.tsx).
 * Lo stato vive in un unico signal `form`; le regole di validazione arrivano da @odys/domain.
 * Essenziale in primo piano (destinazione e date), il resto facoltativo; le località
 * hanno i suggerimenti OpenStreetMap mentre si digita.
 */
@Component({
  selector: 'odys-planner-page',
  imports: [FormsModule, PlannerSectionComponent, PlaceFieldComponent, ButtonComponent, ChipComponent, IconComponent, NoticeComponent, TextFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './planner.page.html',
  styleUrl: './planner.page.scss',
})
export default class PlannerPage {
  private readonly router = inject(Router);
  private readonly itineraryApi = inject(ItineraryApi);
  private readonly trips = inject(TripsStore);
  private readonly draft = inject(PlanDraftStore);
  private readonly auth = inject(AuthStore);

  protected readonly interests = RECOMMENDED_INTERESTS;
  protected readonly paceOptions = PACE_OPTIONS;
  protected readonly arrivalModes = ARRIVAL_MODES;
  protected readonly arrivalLabels = ARRIVAL_TRANSPORT_LABELS;

  protected readonly form = signal<TripForm>(initialTripForm());
  protected readonly activeSection = signal<SectionId>('destination');
  protected readonly customInterest = signal('');
  protected readonly stopDraft = signal('');
  protected readonly returnDetailsVisible = signal(false);
  protected readonly stopsVisible = signal(false);
  protected readonly error = signal('');
  protected readonly generating = signal(false);
  protected readonly savingLater = signal(false);

  protected readonly pointOption = computed(() => arrivalOption(this.form().arrivalTransport ?? 'aereo', this.form().destination));
  protected readonly pointFieldLabel = computed(() => arrivalPointFieldLabel(this.form().arrivalTransport));
  protected readonly duration = computed(() => calculateDuration(this.form().departure, this.form().returnDate));
  protected readonly preferenceCount = computed(() => this.form().interests.length + this.form().customInterests.length);
  protected readonly arrivalPointSelected = computed(() => this.form().arrivalPoint?.placeId === this.pointOption().placeId);

  /** Cosa manca per creare il piano (solo l'essenziale). */
  protected readonly missing = computed(() => {
    const form = this.form();
    return [!form.destination.trim() ? 'la destinazione' : '', !form.departure || !form.returnDate ? 'le date' : ''].filter(Boolean);
  });
  protected readonly essentialsHint = computed(() => {
    const form = this.form();
    if (!form.destination.trim()) return 'Destinazione e date';
    return this.duration() ? `${form.destination} · ${this.duration()} ${this.duration() === 1 ? 'giorno' : 'giorni'}` : `${form.destination} · date da scegliere`;
  });
  protected readonly styleHint = computed(() => `${this.preferenceCount()} interessi · ritmo ${this.form().pace}`);
  protected readonly arrivalHint = computed(() => this.form().departurePoint?.label ? `Da ${this.form().departurePoint!.label}` : 'Facoltativo');
  /** Alloggio scelto dai suggerimenti, come luogo (per il collegamento a OpenStreetMap). */
  protected readonly lodgingNode = computed<LocationNode | null>(() => {
    const lodging = this.form().lodging;
    if (!lodging?.name || lodging.latitude === undefined || lodging.longitude === undefined) return null;
    return { id: 'lodging', label: lodging.name, type: 'accommodation', latitude: lodging.latitude, longitude: lodging.longitude, osmId: lodging.providerId?.includes('/') ? lodging.providerId : undefined, geoStatus: lodging.geoStatus ?? 'CONFIRMED' };
  });

  // --- aggiornamenti del modulo -------------------------------------------------

  protected update<K extends keyof TripForm>(key: K, value: TripForm[K]): void {
    this.form.update((current) => ({ ...current, [key]: value }));
    this.error.set('');
  }

  protected toggleSection(id: SectionId): void {
    this.activeSection.set(id);
  }

  protected selectArrivalMode(mode: ArrivalTransport): void {
    this.form.update((current) => ({ ...current, arrivalTransport: mode, arrivalPoint: undefined }));
  }

  protected toggleArrivalPoint(): void {
    this.update('arrivalPoint', this.arrivalPointSelected() ? undefined : this.pointOption());
  }

  /** Testo scritto a mano: la posizione scelta prima non vale più. */
  protected setDestinationText(value: string): void {
    this.form.update((current) => ({ ...current, destination: value, destinationPoint: current.destinationPoint?.label === value ? current.destinationPoint : undefined }));
    this.error.set('');
  }

  protected pickDestination(node: LocationNode): void {
    this.form.update((current) => ({ ...current, destination: node.label, destinationPoint: node, arrivalPoint: current.arrivalPoint ? arrivalOption(current.arrivalTransport ?? 'aereo', node.label) : undefined }));
    this.error.set('');
  }

  protected pickLocation(key: 'departurePoint' | 'arrivalDestinationPoint' | 'returnPoint', node: LocationNode): void {
    this.update(key, node);
  }

  protected setLodgingName(value: string): void {
    const lodging = this.form().lodging ?? {};
    // Cambiando il nome si perde la posizione trovata per il nome precedente.
    const keepPosition = lodging.name === value;
    this.update('lodging', keepPosition ? { ...lodging, name: value } : { ...lodging, name: value, latitude: undefined, longitude: undefined, geoStatus: undefined, providerId: undefined, source: undefined });
  }

  protected pickLodging(node: LocationNode): void {
    this.update('lodging', {
      ...(this.form().lodging ?? {}),
      name: node.label,
      address: node.address ?? this.form().lodging?.address,
      city: node.city,
      country: node.country,
      latitude: node.latitude,
      longitude: node.longitude,
      geoStatus: 'CONFIRMED',
      providerId: node.osmId ?? node.providerId,
      source: node.source,
    });
  }

  protected selectArrivalDay(value: 'same-day' | 'next-day' | 'specific'): void {
    this.form.update((current) => value === 'specific'
      ? { ...current, arrivalDate: current.arrivalDate || current.departure, arrivalDayOffset: undefined }
      : { ...current, arrivalDate: undefined, arrivalDayOffset: value === 'next-day' ? 1 : 0 });
  }

  protected selectArrivalDestination(kind: ArrivalDestinationKind): void {
    this.form.update((current) => ({ ...current, arrivalDestinationKind: kind, arrivalDestinationPoint: kind === 'custom' ? current.arrivalDestinationPoint : undefined }));
  }

  protected setLocation(key: 'departurePoint' | 'arrivalDestinationPoint' | 'returnPoint', value: string): void {
    this.update(key, locationFromText(value));
  }

  protected updateLodging(key: keyof LodgingInfo, value: string): void {
    this.update('lodging', { ...(this.form().lodging ?? {}), [key]: value });
  }

  protected toggleInterest(interest: RecommendedInterest): void {
    const interests = this.form().interests;
    this.update('interests', interests.includes(interest) ? interests.filter((item) => item !== interest) : [...interests, interest]);
  }

  protected addInterest(input: HTMLInputElement): void {
    const value = input.value;
    const problem = customInterestError(this.form(), value);
    if (problem) { this.error.set(problem); return; }
    this.update('customInterests', [...this.form().customInterests, value.trim()]);
    this.clear(input, this.customInterest);
  }

  protected removeCustomInterest(item: string): void {
    this.update('customInterests', this.form().customInterests.filter((current) => current !== item));
  }

  protected addStop(value: string): void {
    const stop = value.trim();
    if (!stop) return;
    const problem = stopError(this.form(), stop);
    if (problem) { this.error.set(problem); return; }
    this.update('stops', [...(this.form().stops ?? []), stop]);
    this.stopDraft.set('');
  }

  /** Svuota un campo "aggiungi" dopo l'inserimento (DOM e signal restano allineati). */
  private clear(input: HTMLInputElement, draft: ReturnType<typeof signal<string>>): void {
    input.value = '';
    draft.set('');
    input.focus();
  }

  protected removeStop(index: number): void {
    this.update('stops', (this.form().stops ?? []).filter((_, current) => current !== index));
  }

  // --- azioni finali ----------------------------------------------------------

  /** Genera il piano e lo apre senza salvarlo (l'utente decide dopo). */
  protected async submit(): Promise<void> {
    const plan = await this.createPlan(this.generating);
    if (!plan) return;
    this.draft.set(plan);
    await this.router.navigate(['/itinerario', 'bozza']);
  }

  /** Genera, salva subito e apre il viaggio salvato. */
  protected async saveAndCompleteLater(): Promise<void> {
    const plan = await this.createPlan(this.savingLater);
    if (!plan) return;
    // U-10: senza accesso il piano resta in bozza e il salvataggio riparte dopo il login (U-11).
    await this.auth.start();
    if (!this.auth.isAuthenticated()) {
      this.draft.set(plan);
      await this.router.navigate(['/accedi'], { queryParams: { ritorno: '/itinerario/bozza?salva=1', motivo: 'salva' } });
      return;
    }
    this.savingLater.set(true);
    try {
      const saved = await this.trips.save(plan);
      await this.router.navigate(['/itinerario', saved.id], { replaceUrl: true });
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile salvare il viaggio.'));
    } finally {
      this.savingLater.set(false);
    }
  }

  private async createPlan(busy: ReturnType<typeof signal<boolean>>) {
    const problem = validateTripForm(this.form());
    if (problem) {
      this.error.set(problem);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return null;
    }
    busy.set(true);
    try {
      return await this.itineraryApi.generate(this.form());
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile creare l’itinerario.'));
      return null;
    } finally {
      busy.set(false);
    }
  }
}
