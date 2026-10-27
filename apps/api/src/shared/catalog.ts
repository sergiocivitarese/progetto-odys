import type { Itinerary } from '@odys/domain';
import type { StoredTrip } from './data';

/*
 * Contratti di catalogo (viaggi pubblicati dai coordinatori) e area coordinatore.
 * Requisiti: U-01…U-09, U-17, U-21, C-04, C-06…C-14, P-06, §11.2.
 */

export type PublishedTripStatus = 'draft' | 'scheduled' | 'published' | 'active' | 'completed' | 'cancelled' | 'archived';

/** Versione delle linee guida del coordinatore da accettare (C-04). */
export const COORDINATOR_GUIDELINES_VERSION = 'linee-guida-2026-10';

export interface CoordinatorCard {
  id: string;
  /** Nome e iniziale del cognome, es. "Giulia B." */
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
  /** Stato reale considerando le date: un viaggio pubblicato in corso è "active". */
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
  /** Posti ancora disponibili (capienza meno partecipanti confermati), nel dettaglio pubblico. */
  seatsLeft?: number;
  /** Richieste ricevute, solo nell'area del coordinatore (C-15). */
  requests?: { pending: number; confirmed: number };
}

export interface CatalogFilters {
  q?: string;
  destination?: string;
  coordinatorId?: string;
  maxPriceCents?: number;
  sort?: 'upcoming' | 'price' | 'recent';
  includeCompleted?: boolean;
}

/** Lettura pubblica del catalogo (anche senza accesso, U-01). */
export interface CatalogRepository {
  list(filters: CatalogFilters): Promise<PublishedTripSummary[]>;
  get(id: string): Promise<PublishedTrip | null>;
  getMany(ids: string[]): Promise<PublishedTripSummary[]>;
  /** Partecipanti confermati di un viaggio visibile. */
  confirmedCount(id: string): Promise<number>;
  coordinator(id: string): Promise<CoordinatorCard | null>;
}

export interface PublishedTripInput {
  title: string;
  summary: string;
  destination: string;
  startDate?: string;
  endDate?: string;
  priceCents?: number;
  capacity?: number;
  included: string[];
  excluded: string[];
  coverImageUrl?: string;
  itinerary: Itinerary;
  sourceTripId?: string;
}

/** Operazioni del coordinatore sui propri viaggi pubblicati (C-09…C-14). */
export interface CoordinatorRepository {
  isCoordinator(): Promise<boolean>;
  hasAcceptedGuidelines(): Promise<boolean>;
  acceptGuidelines(): Promise<void>;
  list(): Promise<PublishedTrip[]>;
  get(id: string): Promise<PublishedTrip | null>;
  create(input: PublishedTripInput): Promise<PublishedTrip>;
  update(id: string, patch: Partial<PublishedTripInput>): Promise<PublishedTrip | null>;
  setStatus(id: string, status: PublishedTripStatus, scheduledFor?: string): Promise<PublishedTrip | null>;
}

/** Salvataggi e copie dei viaggi pubblicati per l'utente (U-08, U-21). */
export interface SavedTripsRepository {
  listIds(): Promise<string[]>;
  save(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  copy(id: string): Promise<StoredTrip>;
}

/** Un viaggio accetta richieste finché è pubblicato e non è ancora partito (§11.2). */
export function acceptsRequests(trip: Pick<PublishedTripSummary, 'effectiveStatus'>): boolean {
  return trip.effectiveStatus === 'published';
}

/** Stato effettivo di un viaggio pubblicato in base alle date (§11.2: attivo, concluso). */
export function effectiveStatus(status: PublishedTripStatus, startDate?: string, endDate?: string, scheduledFor?: string, today = new Date()): PublishedTripStatus {
  const day = today.toISOString().slice(0, 10);
  if (status === 'scheduled' && scheduledFor && Date.parse(scheduledFor) <= today.getTime()) status = 'published';
  if (status !== 'published') return status;
  if (endDate && endDate < day) return 'completed';
  if (startDate && startDate <= day) return 'active';
  return 'published';
}

export function displayName(firstName?: string, lastInitial?: string): string {
  const name = (firstName ?? '').trim();
  const initial = (lastInitial ?? '').trim().slice(0, 1).toUpperCase();
  return [name, initial ? `${initial}.` : ''].filter(Boolean).join(' ') || 'Coordinatore Odys';
}
