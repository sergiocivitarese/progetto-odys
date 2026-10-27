import { inject, Injectable } from '@angular/core';
import type { GeocodingResult, PlaceSuggestionKind, GeoEnrichmentIssue, GeoTarget, GroupTrip, Itinerary, LocationNode, PlaceMetadata, RouteSegment, WeatherSnapshot } from '@odys/domain';
import { ApiClient } from './api-client';

export interface PublicConfig {
  providers: { geocoding: boolean; routing: boolean; maps: boolean; weather: boolean };
  attributions: { weather: string; maps: string };
  /** Supabase (URL e chiave pubblica) se l'archivio è configurato sul server. */
  auth: { url: string; anonKey: string } | null;
  accountDeletion: boolean;
}

export interface EnrichResult {
  itinerary: Itinerary;
  changed: boolean;
  issues: GeoEnrichmentIssue[];
  messages: string[];
}

/** Provider esterni mediati dal backend: geocoding, meteo, percorsi, mappe, catalogo. */
@Injectable({ providedIn: 'root' })
export class ServicesApi {
  private readonly api = inject(ApiClient);

  config() { return this.api.get<PublicConfig>('/config'); }
  groupTrips() { return this.api.get<GroupTrip[]>('/group-trips'); }
  place(id: string, title?: string, destination?: string) { return this.api.get<PlaceMetadata>(`/places/${encodeURIComponent(id)}`, { title, destination }); }

  suggestPlaces(query: string, kind: PlaceSuggestionKind) { return this.api.get<{ suggestions: LocationNode[]; provider: string; attribution: string }>('/geo/suggest', { q: query, kind }); }
  searchPlace(query: string, city?: string, type?: LocationNode['type']) { return this.api.get<GeocodingResult>('/geo/search', { q: query, city, type }); }
  enrichGeography(itinerary: Itinerary) { return this.api.post<EnrichResult>('/geo/enrich', { itinerary }); }
  confirmGeography(itinerary: Itinerary, target: GeoTarget, node: LocationNode) { return this.api.post<Itinerary>('/geo/confirm', { itinerary, target, node }); }

  refreshWeather(itinerary: Itinerary) { return this.api.post<{ weather: WeatherSnapshot[]; requested: number }>('/weather/refresh', { itinerary }); }
  calculateRoute(segment: RouteSegment) { return this.api.post<{ patch: Partial<RouteSegment> }>('/routes/calculate', { segment }); }
  staticMapUrl(latitude: number, longitude: number, zoom = 12) { return this.api.url(`/maps/static?lat=${latitude}&lon=${longitude}&zoom=${zoom}`); }
}
