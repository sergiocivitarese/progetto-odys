import { inject, Injectable } from '@angular/core';
import type { Itinerary, SavedTrip } from '@odys/domain';
import { ApiClient } from './api-client';

/** Motivo di un salvataggio: finisce nello storico delle versioni. */
export type TripChangeKind = 'created' | 'edited' | 'dates' | 'budget' | 'lodging' | 'geography' | 'progress' | 'route' | 'import' | 'restore';

export interface SaveOptions {
  title?: string;
  changeKind?: TripChangeKind;
  /** false per aggiornamenti automatici che non devono creare una versione (es. meteo). */
  recordVersion?: boolean;
}

export interface StoredTrip extends SavedTrip {
  currentVersion: number;
}

export interface TripVersionSummary {
  version: number;
  changeKind: TripChangeKind;
  summary?: string;
  createdAt: string;
}

/** Endpoint `/api/trips`: viaggi salvati, import ed export. */
@Injectable({ providedIn: 'root' })
export class TripsApi {
  private readonly api = inject(ApiClient);

  list() { return this.api.get<StoredTrip[]>('/trips'); }
  get(id: string) { return this.api.get<StoredTrip>(`/trips/${encodeURIComponent(id)}`); }
  create(itinerary: Itinerary, title?: string) { return this.api.post<StoredTrip>('/trips', { itinerary, title }); }
  update(id: string, itinerary: Itinerary, options: SaveOptions = {}) { return this.api.put<StoredTrip>(`/trips/${encodeURIComponent(id)}`, { itinerary, ...options }); }
  rename(id: string, title: string) { return this.api.patch<StoredTrip>(`/trips/${encodeURIComponent(id)}`, { title }); }
  versions(id: string) { return this.api.get<TripVersionSummary[]>(`/trips/${encodeURIComponent(id)}/versions`); }
  restore(id: string, version: number) { return this.api.post<StoredTrip>(`/trips/${encodeURIComponent(id)}/versions/${version}/restore`, {}); }
  remove(id: string) { return this.api.delete(`/trips/${encodeURIComponent(id)}`); }
  exportJson(id: string) { return this.api.getText(`/trips/${encodeURIComponent(id)}/export`); }
  previewImport(raw: string) { return this.api.post<{ trip: SavedTrip; replacesExisting: boolean }>('/trips/import/preview', { raw }); }
  import(raw: string) { return this.api.post<{ trip: StoredTrip; replaced: boolean }>('/trips/import', { raw }); }
}
