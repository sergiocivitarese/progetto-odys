import { inject, Injectable } from '@angular/core';
import type { GeneratedTrip, GeneratorDates, GeneratorDuration } from '@odys/domain';
import { ApiClient } from './api-client';
import type { StoredTrip } from './trips.api';

export interface GeneratorRequest {
  destination: string;
  surprise: boolean;
  dates: GeneratorDates;
  duration: GeneratorDuration;
  /** In euro, a persona. */
  budget: number;
  interests: string[];
  /** Cambia a ogni «Rigenera». */
  seed: number;
}

/** Anteprima dell'itinerario generato (senza l'itinerario completo, che resta sul server). */
export type GeneratedPreview = Omit<GeneratedTrip, 'itinerary'>;

/** Endpoint `/api/generator`: generatore di itinerari del Traveller Premium (TP-01…TP-03). */
@Injectable({ providedIn: 'root' })
export class GeneratorApi {
  private readonly api = inject(ApiClient);
  generate(request: GeneratorRequest) { return this.api.post<GeneratedPreview>('/generator', request); }
  accept(request: GeneratorRequest) { return this.api.post<StoredTrip>('/generator/accept', request); }
}
