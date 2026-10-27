import { inject, Injectable } from '@angular/core';
import type { DateChangeCheck, Itinerary, LodgingInfo, RepositionSuggestion, TripDateFields, TripForm } from '@odys/domain';
import { ApiClient } from './api-client';

/** Endpoint `/api/itineraries`: generazione e ricalcoli lato server. */
@Injectable({ providedIn: 'root' })
export class ItineraryApi {
  private readonly api = inject(ApiClient);

  generate(form: TripForm) { return this.api.post<Itinerary>('/itineraries/generate', { form }); }
  checkDates(itinerary: Itinerary, fields: TripDateFields) { return this.api.post<DateChangeCheck>('/itineraries/dates/check', { itinerary, fields }); }
  applyDates(itinerary: Itinerary, fields: TripDateFields) { return this.api.post<Itinerary>('/itineraries/dates/apply', { itinerary, fields }); }
  confirmBudget(itinerary: Itinerary, fields: { travelers: string; budgetPerTraveler?: string }) { return this.api.post<Itinerary>('/itineraries/budget', { itinerary, fields }); }
  previewOrigin(itinerary: Itinerary, lodging: LodgingInfo) { return this.api.post<Itinerary>('/itineraries/origin/preview', { itinerary, lodging }); }
  confirmOrigin(itinerary: Itinerary, preview: Itinerary) { return this.api.post<Itinerary>('/itineraries/origin/confirm', { itinerary, preview }); }
  finalize(draft: Itinerary, dayIndexes: number[]) { return this.api.post<Itinerary>('/itineraries/finalize', { draft, dayIndexes }); }
  reposition(itinerary: Itinerary, dayIndex: number, activityIndex: number) { return this.api.post<RepositionSuggestion>('/itineraries/reposition', { itinerary, dayIndex, activityIndex }); }
}
