import { inject, Injectable } from '@angular/core';
import type { Affinity, Itinerary } from '@odys/domain';
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
  /** Valutazione media e numero di recensioni (TB-12), follower e viaggi conclusi (TB-11). */
  rating?: number;
  reviewsCount?: number;
  followers?: number;
  tripsCompleted?: number;
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
  country: string;
  region: string;
  /** Interessi del viaggio (filtri e affinità). */
  interests: string[];
  /** Acconto per bloccare il posto e scadenza del saldo. */
  depositCents?: number;
  balanceDueDate?: string;
  visibility: TripVisibility;
  ageMin?: number;
  ageMax?: number;
  /** Posti liberi; assente se il conteggio non è disponibile. */
  seatsLeft?: number;
  /** Affinità con i tuoi interessi (solo con l'accesso e con interessi nel profilo). */
  affinity?: Affinity;
}

export type TripVisibility = 'public' | 'followers' | 'invite';

export interface PlaceSuggestion {
  kind: 'country' | 'region' | 'city';
  label: string;
  context?: string;
  trips: number;
}

export interface PublishedTrip extends PublishedTripSummary {
  included: string[];
  excluded: string[];
  itinerary: Itinerary;
  sourceTripId?: string;
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
  /** Predefinito: affinità, poi data di partenza. */
  sort?: 'affinity' | 'upcoming' | 'price' | 'recent';
  maxPrice?: number;
  interests?: string[];
  /** Mese di partenza, 1–12. */
  month?: number;
  minDays?: number;
  maxDays?: number;
  onlyAvailable?: boolean;
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
  country?: string;
  region?: string;
  interests?: string[];
  /** In euro, come la quota. */
  deposit?: number;
  balanceDueDate?: string;
  visibility?: TripVisibility;
  ageMin?: number | null;
  ageMax?: number | null;
}

export type CoordinatorAction = 'publish' | 'schedule' | 'unpublish' | 'cancel' | 'archive';

/** Endpoint `/api/catalog` (pubblici) e `/api/coordinator` (area coordinatore). */
@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly api = inject(ApiClient);

  list(query: CatalogQuery = {}) {
    return this.api.get<PublishedTripSummary[]>('/catalog/trips', {
      q: query.q || undefined,
      sort: query.sort,
      maxPrice: query.maxPrice ? String(query.maxPrice) : undefined,
      interests: query.interests?.length ? query.interests.join(',') : undefined,
      month: query.month ? String(query.month) : undefined,
      minDays: query.minDays ? String(query.minDays) : undefined,
      maxDays: query.maxDays ? String(query.maxDays) : undefined,
      available: query.onlyAvailable ? '1' : undefined,
    });
  }
  /** Suggerimenti di paese, regione e città con il numero di viaggi (TB-02). */
  suggest(q: string) { return this.api.get<PlaceSuggestion[]>('/catalog/suggest', { q }); }
  /** «Chi cerca X guarda anche». */
  similar(q: string) { return this.api.get<Array<{ label: string; trips: number }>>('/catalog/similar', { q }); }
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

/** Quota senza decimali quando è tonda, es. «€1.680» (card e barre del prezzo). */
export function formatAmount(cents: number | undefined, currency = 'EUR'): string {
  if (cents === undefined || cents === null) return '—';
  const digits = cents % 100 === 0 ? 0 : 2;
  const number = new Intl.NumberFormat('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: true }).format(cents / 100);
  // Simbolo davanti, come nei mockup: «€1.680».
  const symbol = currency === 'EUR' ? '€' : `${currency} `;
  return `${symbol}${number}`;
}

/** Iniziali per l'avatar, es. «Marco R.» → «MR». */
export function initialsOf(name: string): string {
  return name.split(/\s+/).map((part) => part[0] ?? '').join('').replace(/[^\p{L}]/gu, '').slice(0, 2).toUpperCase() || 'O';
}

/** Giorni da oggi alla data (negativo se è passata). */
export function daysUntil(date: string | undefined, today = new Date()): number | undefined {
  if (!date) return undefined;
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.parse(`${date}T00:00:00Z`) - start) / 86_400_000);
}

/** «12 – 17 mar» oppure «28 apr – 3 mag»; con `year` aggiunge l'anno. */
export function formatDateRange(start: string | undefined, end: string | undefined, year = false): string {
  if (!start) return 'Date da definire';
  const day = (value: string) => String(Number(value.slice(8, 10)));
  const month = (value: string) => new Intl.DateTimeFormat('it-IT', { month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)).replace('.', '');
  const suffix = year ? ` ${(end ?? start).slice(0, 4)}` : '';
  if (!end || end === start) return `${day(start)} ${month(start)}${suffix}`;
  return start.slice(0, 7) === end.slice(0, 7) ? `${day(start)} – ${day(end)} ${month(end)}${suffix}` : `${day(start)} ${month(start)} – ${day(end)} ${month(end)}${suffix}`;
}

/** Etichetta di urgenza della card (TB-05): sotto i 5 posti liberi. */
export function urgencyLabel(trip: Pick<PublishedTripSummary, 'seatsLeft' | 'effectiveStatus'>): string | null {
  if (trip.effectiveStatus !== 'published' || trip.seatsLeft === undefined) return null;
  if (trip.seatsLeft === 0) return 'Tutto esaurito';
  if (trip.seatsLeft < 5) return trip.seatsLeft === 1 ? 'Ultimo posto' : `Ultimi ${trip.seatsLeft} posti`;
  return null;
}
