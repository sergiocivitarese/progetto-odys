import type { PlanTier, SubscriptionPlan } from '@odys/domain';
import type { AuthUser } from './auth';

/*
 * Contratti di partecipazione ai viaggi e di candidatura al ruolo di coordinatore.
 * Requisiti: U-14, U-16, C-15 (richieste e partecipanti), C-01, C-02, G-01 (candidature).
 */

/**
 * Stati di una prenotazione: posto riservato (checkout in corso) → richiesta
 * inviata (acconto confermato) → confermata dal coordinatore → saldata.
 */
export type ParticipationStatus = 'reserved' | 'pending' | 'confirmed' | 'balance_paid' | 'declined' | 'withdrawn';

/** Minuti di riserva del posto durante il checkout (valore provvisorio, come nella funzione SQL). */
export const SEAT_RESERVATION_MINUTES = 15;

export interface ParticipationRequest {
  id: string;
  tripId: string;
  status: ParticipationStatus;
  message?: string;
  createdAt: string;
  decidedAt?: string;
  /** Scadenza della riserva del posto (solo nello stato `reserved`). */
  reservedUntil?: string;
  /** Numero del posto assegnato alla riserva, es. «Posto 8 di 12». */
  seatNumber?: number;
  /** Importi fissati alla riserva, in centesimi. */
  priceCents?: number;
  depositCents?: number;
  currency: string;
  balanceDueDate?: string;
  /** Ultimo sollecito del saldo inviato dal coordinatore (CP-03). */
  balanceRemindedAt?: string;
}

export type PaymentKind = 'deposit' | 'balance';
export type PaymentStatus = 'processing' | 'confirmed' | 'failed';
export type PaymentMethod = 'card' | 'wallet';

export interface Payment {
  id: string;
  requestId: string;
  kind: PaymentKind;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  provider: string;
  method: PaymentMethod;
  createdAt: string;
  confirmedAt?: string;
}

/** Vero se la prenotazione occupa un posto: stessa regola di `participation_holds_seat`. */
export function holdsSeat(request: Pick<ParticipationRequest, 'status' | 'reservedUntil'>, now = Date.now()): boolean {
  if (request.status === 'pending' || request.status === 'confirmed' || request.status === 'balance_paid') return true;
  return request.status === 'reserved' && !!request.reservedUntil && Date.parse(request.reservedUntil) > now;
}

/** Richiesta vista dal coordinatore del viaggio (CB-08): il contatto arriva solo dopo la conferma. */
export interface Participant extends ParticipationRequest {
  userId: string;
  firstName: string;
  lastName: string;
  email?: string;
  age?: number;
  /** Interessi in comune con il viaggio. */
  sharedInterests?: number;
}

export interface ParticipationCounts {
  pending: number;
  /** Posti venduti: confermati, con o senza saldo. */
  confirmed: number;
  /** Confermati che non hanno ancora pagato il saldo. */
  balanceDue: number;
}

export interface ParticipationRepository {
  /** Le richieste dell'utente, dalla più recente. */
  mine(): Promise<ParticipationRequest[]>;
  /** Una prenotazione dell'utente. */
  get(id: string): Promise<ParticipationRequest | null>;
  /** Riserva un posto per il tempo del checkout (TB-08); una riserva ancora valida viene restituita com'è. */
  /** `channel`: da dove arriva chi prenota (AG-07): community Odys o link diretto. */
  reserve(tripId: string, channel?: 'odys' | 'direct'): Promise<ParticipationRequest>;
  withdraw(tripId: string): Promise<ParticipationRequest | null>;
  /** Avvia l'acconto o il saldo: l'importo lo calcola l'archivio dalla prenotazione (TB-09). */
  startPayment(requestId: string, kind: PaymentKind, method: PaymentMethod, acceptTerms: boolean): Promise<Payment>;
  /** Conferma del fornitore simulato: fa avanzare la prenotazione. Con il fornitore reale arriverà dal webhook. */
  confirmSimulatedPayment(paymentId: string): Promise<Payment>;
  /** Pagamenti di una propria prenotazione, dal più recente. */
  payments(requestId: string): Promise<Payment[]>;
  /** Partecipanti di un viaggio del coordinatore. */
  participants(tripId: string): Promise<Participant[]>;
  decide(tripId: string, requestId: string, status: 'confirmed' | 'declined'): Promise<ParticipationRequest | null>;
  /** Richieste in attesa (acconto pagato) e posti confermati o saldati dei viaggi indicati (solo quelli del coordinatore). */
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

export type ReportTarget = 'post' | 'published_trip' | 'profile';
export type ReportReason = 'spam' | 'inappropriate' | 'misleading' | 'copyright' | 'safety' | 'other';
export type ReportStatus = 'open' | 'resolved' | 'dismissed';
/** `hidden`: post o viaggio archiviato; `suspended`: account dell'autore sospeso. */
export type ReportAction = 'dismiss' | 'none' | 'hidden' | 'suspended';

export interface ReportInput {
  targetKind: ReportTarget;
  targetId: string;
  reason: ReportReason;
  details?: string;
}

export interface ContentReport extends ReportInput {
  id: string;
  status: ReportStatus;
  actionTaken?: 'none' | 'hidden' | 'suspended';
  decidedAt?: string;
  createdAt: string;
}

/** Segnalazione nella coda dell'amministratore (G-04), con riepilogo del contenuto. */
export interface ReportReview extends ContentReport {
  resolutionNote?: string;
  reporterEmail?: string;
  targetTitle?: string;
  targetOwnerId?: string;
  targetOwnerName?: string;
  reportsOnTarget: number;
}

export interface AccountSummary {
  id: string;
  email?: string;
  firstName: string;
  lastName: string;
  role: 'traveler' | 'coordinator' | 'agency' | 'admin';
  status: 'active' | 'suspended' | 'disabled';
  createdAt: string;
  /** Profilo effettivo (piano e ruolo). */
  plan: PlanTier;
}

/** Segnalazioni inviate dagli utenti (S-07). */
export interface ReportsRepository {
  create(input: ReportInput): Promise<ContentReport>;
}

export interface AdminRepository {
  isAdmin(): Promise<boolean>;
  listApplications(status?: ApplicationStatus): Promise<ApplicationReview[]>;
  decideApplication(id: string, approve: boolean, adminNote?: string, reviewerMessage?: string): Promise<ApplicationReview | null>;
  listReports(status?: ReportStatus): Promise<ReportReview[]>;
  resolveReport(id: string, action: ReportAction, note?: string): Promise<ReportReview | null>;
  listAccounts(query?: string): Promise<AccountSummary[]>;
  updateAccount(id: string, changes: { role?: AccountSummary['role']; status?: AccountSummary['status'] }, note?: string): Promise<AccountSummary | null>;
  /** Assegna (o revoca, con null) un piano: per demo e collaudo finché mancano i pagamenti. */
  setPlan(id: string, plan: SubscriptionPlan | null, note?: string): Promise<AccountSummary | null>;
}

export interface ReviewInput {
  coordinatorRating: number;
  tripRating: number;
  body: string;
}

export interface Review extends ReviewInput {
  id: string;
  tripId: string;
  createdAt: string;
}

/** Segui i coordinatori (TB-11) e recensioni a fine viaggio (TB-12). */
export interface SocialRepository {
  isFollowing(coordinatorId: string): Promise<boolean>;
  follow(coordinatorId: string): Promise<void>;
  unfollow(coordinatorId: string): Promise<void>;
  /** La propria recensione di un viaggio, se c'è. */
  myReview(tripId: string): Promise<Review | null>;
  /** Crea o aggiorna la propria recensione: solo partecipanti e solo a viaggio concluso. */
  saveReview(tripId: string, input: ReviewInput): Promise<Review>;
}

/** Fabbriche dei repository di questa area, per l'utente della richiesta. */
export interface CommunityStore {
  participation(user: AuthUser): ParticipationRepository;
  applications(user: AuthUser): ApplicationsRepository;
  admin(user: AuthUser): AdminRepository;
  reports(user: AuthUser): ReportsRepository;
  social(user: AuthUser): SocialRepository;
}
