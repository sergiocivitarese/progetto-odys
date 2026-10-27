import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import type { Itinerary } from '@odys/domain';
import { apiErrorMessage } from '../api/api-client';
import { TripsApi, type SaveOptions, type StoredTrip } from '../api/trips.api';
import { AuthStore } from '../auth/auth.store';

/**
 * Viaggi salvati dell'utente autenticato (sostituisce l'hook `useSavedTrip`).
 * Senza accesso la lista è vuota; al logout viene svuotata.
 */
@Injectable({ providedIn: 'root' })
export class TripsStore {
  private readonly api = inject(TripsApi);
  private readonly auth = inject(AuthStore);

  readonly trips = signal<StoredTrip[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly latest = computed(() => this.trips()[0]);

  constructor() {
    // Cambio di utente (login/logout): ricarica o svuota la raccolta.
    effect(() => {
      const userId = this.auth.user()?.id;
      untracked(() => {
        this.trips.set([]);
        if (userId) void this.load();
      });
    });
  }

  async load(): Promise<void> {
    this.error.set(null);
    await this.auth.start();
    if (!this.auth.isAuthenticated()) {
      this.trips.set([]);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      this.trips.set(await this.api.list());
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile caricare i viaggi salvati.'));
    } finally {
      this.loading.set(false);
    }
  }

  async save(itinerary: Itinerary, tripId?: string, options: SaveOptions = {}): Promise<StoredTrip> {
    const saved = tripId ? await this.api.update(tripId, itinerary, options) : await this.api.create(itinerary, options.title);
    this.upsertLocal(saved);
    return saved;
  }

  async rename(id: string, title: string): Promise<void> {
    this.upsertLocal(await this.api.rename(id, title));
  }

  async remove(id: string): Promise<void> {
    await this.api.remove(id);
    this.trips.update((trips) => trips.filter((trip) => trip.id !== id));
  }

  previewImport(raw: string) {
    return this.api.previewImport(raw);
  }

  async import(raw: string): Promise<{ trip: StoredTrip; replaced: boolean }> {
    const result = await this.api.import(raw);
    this.upsertLocal(result.trip);
    return result;
  }

  upsertLocal(trip: StoredTrip): void {
    this.trips.update((trips) => [trip, ...trips.filter((item) => item.id !== trip.id)]);
  }
}
