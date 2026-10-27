import { inject, Injectable } from '@angular/core';
import type { Itinerary } from '@odys/domain';
import { ApiClient } from './api-client';
import type { StoredTrip } from './trips.api';

export type PublishedTripStatus = 'draft' | 'scheduled' | 'published' | 'active' | 'completed' | 'cancelled' | 'archived';

export interface CoordinatorCard {
  id: string;
  displayName: string;
  headline?: string;
  bio?: string;
  interests: string[];
  avatarUrl?: string;
  memberSince?: string;
}

export interface PublishedTripSummary {
  id: string;
  status: PublishedTripStatus;
  effectiveStatus: PublishedTripStatus;
  title: string;
  summary: string;
  destination: string;
  startDate?: string;
  endDate?: string;
  durationDays?: number;
  priceCents?: number;
  currency: string;
  capacity?: number;
  coverImageUrl?: string;
  publishedAt?: string;
  scheduledFor?: string;
  updatedAt: string;
  coordinator: CoordinatorCard;
}

export interface PublishedTrip extends PublishedTripSummary {
  included: string[];
  excluded: string[];
  itinerary: Itinerary;
  sourceTripId?: string;
  /** Posti ancora disponibili (dettaglio pubblico). */
  seatsLeft?: number;
  /** Richieste ricevute (solo area coordinatore). */
  requests?: { pending: number; confirmed: number };
}

export type ParticipationStatus = 'pending' | 'confirmed' | 'declined' | 'withdrawn';

export interface ParticipationRequest {
  id: string;
  tripId: string;
  status: ParticipationStatus;
  message?: string;
  createdAt: string;
  decidedAt?: string;
}

/** Richiesta dell'utente con il viaggio collegato (null se il viaggio non è più pubblico). */
export interface MyParticipation extends ParticipationRequest {
  trip: PublishedTripSummary | null;
}

/** Richiesta vista dal coordinatore: il contatto arriva solo dopo la conferma. */
export interface Participant extends ParticipationRequest {
  userId: string;
  firstName: string;
  lastName: string;
  email?: string;
}

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

export interface CoordinatorApplicationForm {
  motivation: string;
  experience: string;
  tripsLed: number;
  languages: string[];
  links: string[];
  acceptGuidelines: boolean;
}

export interface CoordinatorApplication {
  id: string;
  status: ApplicationStatus;
  motivation: string;
  experience: string;
  tripsLed: number;
  languages: string[];
  links: string[];
  reviewerMessage?: string;
  createdAt: string;
  decidedAt?: string;
}

/** Candidatura vista dall'amministratore. */
export interface ApplicationReview extends CoordinatorApplication {
  userId: string;
  firstName: string;
  lastName: string;
  email?: string;
  bio?: string;
  interests: string[];
  adminNote?: string;
}

export interface CoordinatorStatus {
  isCoordinator: boolean;
  guidelinesAccepted: boolean;
  guidelinesVersion: string;
  application: CoordinatorApplication | null;
}

export interface CatalogQuery {
  q?: string;
  sort?: 'upcoming' | 'price' | 'recent';
  maxPrice?: number;
}

export interface PublishedTripForm {
  sourceTripId?: string;
  title?: string;
  summary?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  /** In euro: il server lo salva in centesimi (P-06). */
  price?: number;
  capacity?: number;
  included?: string[];
  excluded?: string[];
  coverImageUrl?: string;
  refreshItinerary?: boolean;
}

export type CoordinatorAction = 'publish' | 'schedule' | 'unpublish' | 'cancel' | 'archive';

/** Endpoint `/api/catalog` (pubblici) e `/api/coordinator` (area coordinatore). */
@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly api = inject(ApiClient);

  list(query: CatalogQuery = {}) {
    return this.api.get<PublishedTripSummary[]>('/catalog/trips', { q: query.q || undefined, sort: query.sort, maxPrice: query.maxPrice ? String(query.maxPrice) : undefined });
  }
  get(id: string) { return this.api.get<PublishedTrip>(`/catalog/trips/${encodeURIComponent(id)}`); }
  coordinator(id: string) { return this.api.get<{ coordinator: CoordinatorCard; trips: PublishedTripSummary[] }>(`/catalog/coordinators/${encodeURIComponent(id)}`); }
  copy(id: string) { return this.api.post<StoredTrip>(`/catalog/trips/${encodeURIComponent(id)}/copy`, {}); }

  savedTrips() { return this.api.get<PublishedTripSummary[]>('/me/saved-trips'); }
  saveTrip(id: string) { return this.api.put<void>(`/me/saved-trips/${encodeURIComponent(id)}`, {}); }
  unsaveTrip(id: string) { return this.api.delete(`/me/saved-trips/${encodeURIComponent(id)}`); }

  myParticipations() { return this.api.get<MyParticipation[]>('/me/participations'); }
  requestParticipation(id: string, message?: string) { return this.api.post<ParticipationRequest>(`/catalog/trips/${encodeURIComponent(id)}/participation`, { message: message || undefined }); }
  withdrawParticipation(id: string) { return this.api.delete<ParticipationRequest>(`/catalog/trips/${encodeURIComponent(id)}/participation`); }

  coordinatorStatus() { return this.api.get<CoordinatorStatus>('/coordinator/status'); }
  applyAsCoordinator(form: CoordinatorApplicationForm) { return this.api.post<CoordinatorApplication>('/coordinator/application', form); }
  participants(id: string) { return this.api.get<Participant[]>(`/coordinator/trips/${encodeURIComponent(id)}/participants`); }
  decideParticipant(id: string, requestId: string, decision: 'confirm' | 'decline') {
    return this.api.post<ParticipationRequest>(`/coordinator/trips/${encodeURIComponent(id)}/participants/${encodeURIComponent(requestId)}/${decision}`, {});
  }

  applications(status?: ApplicationStatus) { return this.api.get<ApplicationReview[]>('/admin/applications', { status }); }
  decideApplication(id: string, decision: 'approve' | 'reject', adminNote: string, reviewerMessage: string) {
    return this.api.post<ApplicationReview>(`/admin/applications/${encodeURIComponent(id)}/${decision}`, { adminNote: adminNote || undefined, reviewerMessage: reviewerMessage || undefined });
  }
  acceptGuidelines() { return this.api.post<void>('/coordinator/guidelines', {}); }
  myPublished() { return this.api.get<PublishedTrip[]>('/coordinator/trips'); }
  myPublishedTrip(id: string) { return this.api.get<PublishedTrip>(`/coordinator/trips/${encodeURIComponent(id)}`); }
  createPublished(form: PublishedTripForm) { return this.api.post<PublishedTrip>('/coordinator/trips', form); }
  updatePublished(id: string, form: PublishedTripForm) { return this.api.put<PublishedTrip>(`/coordinator/trips/${encodeURIComponent(id)}`, form); }
  changeStatus(id: string, action: CoordinatorAction, scheduledFor?: string) {
    return this.api.post<PublishedTrip>(`/coordinator/trips/${encodeURIComponent(id)}/${action}`, scheduledFor ? { scheduledFor } : {});
  }
}

/** Quota formattata (prezzi in centesimi, P-06). */
export function formatPrice(cents: number | undefined, currency = 'EUR'): string {
  if (cents === undefined || cents === null) return 'Quota da definire';
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

export const PUBLISHED_STATUS_LABELS: Record<PublishedTripStatus, string> = {
  draft: 'Bozza',
  scheduled: 'Programmato',
  published: 'Pubblicato',
  active: 'In corso',
  completed: 'Concluso',
  cancelled: 'Annullato',
  archived: 'Archiviato',
};

export const PARTICIPATION_STATUS_LABELS: Record<ParticipationStatus, string> = {
  pending: 'In attesa di conferma',
  confirmed: 'Confermata',
  declined: 'Non accettata',
  withdrawn: 'Ritirata',
};
