import type { Itinerary, SavedTrip } from '@odys/domain';
import type { AuthUser } from './auth';
import type { CatalogRepository, CoordinatorRepository, SavedTripsRepository } from './catalog';
import type { CommunityStore } from './community';

/*
 * Contratti dell'archivio dati. Implementazioni:
 *   - `supabase/` per l'uso reale (RLS: ogni query gira con il token dell'utente);
 *   - `memory/` per i test e per sviluppare senza rete.
 */

export type TripChangeKind = 'created' | 'edited' | 'dates' | 'budget' | 'lodging' | 'geography' | 'progress' | 'route' | 'import' | 'restore' | 'copied';

/** Motivi che il client può indicare salvando (la copia la registra solo il server). */
export const TRIP_CHANGE_KINDS: TripChangeKind[] = ['created', 'edited', 'dates', 'budget', 'lodging', 'geography', 'progress', 'route', 'import', 'restore'];

export interface SaveTripInput {
  tripId?: string;
  title?: string;
  itinerary: Itinerary;
  changeKind: TripChangeKind;
  summary?: string;
  legacyId?: string;
  /** false per aggiornamenti automatici (meteo, arricchimenti) che non vanno nello storico. */
  recordVersion?: boolean;
}

export interface TripVersionSummary {
  version: number;
  changeKind: TripChangeKind;
  summary?: string;
  createdAt: string;
}

export interface TripVersion extends TripVersionSummary {
  itinerary: Itinerary;
}

/** Viaggio salvato con i dati dello storico (estende il formato Triply v5). */
export interface StoredTrip extends SavedTrip {
  currentVersion: number;
}

export interface TripsRepository {
  list(): Promise<StoredTrip[]>;
  get(id: string): Promise<StoredTrip | null>;
  findByLegacyId(legacyId: string): Promise<StoredTrip | null>;
  save(input: SaveTripInput): Promise<StoredTrip>;
  rename(id: string, title: string): Promise<StoredTrip | null>;
  softDelete(id: string): Promise<boolean>;
  listVersions(id: string): Promise<TripVersionSummary[]>;
  getVersion(id: string, version: number): Promise<TripVersion | null>;
}

export type ThemePreference = 'light' | 'dark' | 'system';

export interface Profile {
  id: string;
  email?: string;
  firstName: string;
  lastName: string;
  birthDate?: string;
  bio?: string;
  interests: string[];
  avatarUrl?: string;
  publicHeadline?: string;
  role: 'traveler' | 'coordinator' | 'agency' | 'admin';
  status: 'active' | 'suspended' | 'disabled';
  createdAt: string;
}

export interface Preferences {
  theme: ThemePreference;
  onboardingCompletedAt?: string;
}

export interface ProfilePatch {
  firstName?: string;
  lastName?: string;
  bio?: string;
  interests?: string[];
  /** Frase di presentazione pubblica (profilo coordinatore, C-06). */
  publicHeadline?: string;
}

export interface AuditEntry {
  action: string;
  entity?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface AccountRepository {
  getProfile(): Promise<Profile | null>;
  updateProfile(patch: ProfilePatch): Promise<Profile>;
  getPreferences(): Promise<Preferences>;
  updatePreferences(patch: Partial<Preferences>): Promise<Preferences>;
  listSavedIdeas(): Promise<string[]>;
  saveIdea(id: string): Promise<void>;
  removeIdea(id: string): Promise<void>;
  /** Registro delle attività (S-06). Non deve mai bloccare l'operazione principale. */
  record(entry: AuditEntry): Promise<void>;
  listActivity(limit?: number): Promise<AuditEntry[]>;
}

/** Fabbrica dei repository per l'utente della richiesta. */
export interface DataStore extends CommunityStore {
  trips(user: AuthUser): TripsRepository;
  account(user: AuthUser): AccountRepository;
  /** Catalogo pubblico: leggibile anche senza accesso. */
  catalog(): CatalogRepository;
  coordinator(user: AuthUser): CoordinatorRepository;
  saved(user: AuthUser): SavedTripsRepository;
}
