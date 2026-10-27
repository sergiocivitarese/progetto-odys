import type { AuthUser } from './auth';

/*
 * Contratti di partecipazione ai viaggi e di candidatura al ruolo di coordinatore.
 * Requisiti: U-14, U-16, C-15 (richieste e partecipanti), C-01, C-02, G-01 (candidature).
 */

export type ParticipationStatus = 'pending' | 'confirmed' | 'declined' | 'withdrawn';

export interface ParticipationRequest {
  id: string;
  tripId: string;
  status: ParticipationStatus;
  message?: string;
  createdAt: string;
  decidedAt?: string;
}

/** Richiesta vista dal coordinatore del viaggio (C-15): il contatto arriva solo dopo la conferma. */
export interface Participant extends ParticipationRequest {
  userId: string;
  firstName: string;
  lastName: string;
  email?: string;
}

export interface ParticipationCounts {
  pending: number;
  confirmed: number;
}

export interface ParticipationRepository {
  /** Le richieste dell'utente, dalla più recente. */
  mine(): Promise<ParticipationRequest[]>;
  /** Apre la richiesta (o riapre quella ritirata) per un viaggio prenotabile. */
  request(tripId: string, message?: string): Promise<ParticipationRequest>;
  withdraw(tripId: string): Promise<ParticipationRequest | null>;
  /** Partecipanti di un viaggio del coordinatore. */
  participants(tripId: string): Promise<Participant[]>;
  decide(tripId: string, requestId: string, status: 'confirmed' | 'declined'): Promise<ParticipationRequest | null>;
  /** Richieste in attesa e confermate dei viaggi indicati (solo quelli del coordinatore). */
  counts(tripIds: string[]): Promise<Map<string, ParticipationCounts>>;
}

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

export interface CoordinatorApplicationInput {
  motivation: string;
  experience: string;
  tripsLed: number;
  languages: string[];
  links: string[];
}

export interface CoordinatorApplication extends CoordinatorApplicationInput {
  id: string;
  status: ApplicationStatus;
  /** Messaggio dell'amministratore per il candidato (la nota interna non esce mai da qui). */
  reviewerMessage?: string;
  createdAt: string;
  decidedAt?: string;
}

/** Candidatura vista dall'amministratore (G-01), con profilo del candidato e nota interna. */
export interface ApplicationReview extends CoordinatorApplication {
  userId: string;
  firstName: string;
  lastName: string;
  email?: string;
  bio?: string;
  interests: string[];
  adminNote?: string;
}

export interface ApplicationsRepository {
  latest(): Promise<CoordinatorApplication | null>;
  submit(input: CoordinatorApplicationInput, guidelinesVersion: string): Promise<CoordinatorApplication>;
}

export interface AdminRepository {
  isAdmin(): Promise<boolean>;
  listApplications(status?: ApplicationStatus): Promise<ApplicationReview[]>;
  decideApplication(id: string, approve: boolean, adminNote?: string, reviewerMessage?: string): Promise<ApplicationReview | null>;
}

/** Fabbriche dei repository di questa area, per l'utente della richiesta. */
export interface CommunityStore {
  participation(user: AuthUser): ParticipationRepository;
  applications(user: AuthUser): ApplicationsRepository;
  admin(user: AuthUser): AdminRepository;
}
