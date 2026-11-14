import type { AgencyLinkType, AgencyMemberStatus, AgencyRole, BillingCycle } from '@odys/domain';
import type { AuthUser } from './auth';
import type { CoordinatorCard, PublishedTripSummary } from './catalog';

/*
 * Agenzia (AG-01, AG-02, AG-05, AG-09, AG-10): contratti dell'area agenzia.
 * Le regole stanno nelle funzioni SQL (migrazione 0020) e, per i test,
 * nell'archivio in memoria; le stesse tabelle di permessi in @odys/domain.
 */

export interface Agency {
  id: string;
  legalName: string;
  displayName: string;
  slug: string;
  description: string;
  logoUrl?: string;
  email?: string;
  phone?: string;
  website?: string;
  city?: string;
  country?: string;
  licenseSeats: number;
  billingCycle: BillingCycle;
  /** Condizioni di vendita mostrate nel checkout dei viaggi in ombrello (AG-12). */
  saleTerms: string;
  createdAt: string;
}

export type AgencyProfileInput = Partial<Pick<Agency, 'legalName' | 'displayName' | 'slug' | 'description' | 'logoUrl' | 'email' | 'phone' | 'website' | 'city' | 'country' | 'saleTerms'>>;

/** Membro del team visto da proprietario, amministratori e operatori (AG-05). */
export interface AgencyMember {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email?: string;
  role: AgencyRole;
  linkType?: AgencyLinkType;
  status: AgencyMemberStatus;
  licensed: boolean;
  /** I viaggi nuovi del coordinatore nascono coperti dall'agenzia (AG-11). */
  umbrellaDefault: boolean;
  createdAt: string;
  acceptedAt?: string;
  /** Profilo coordinatore attivo e candidatura approvata («documenti verificati»). */
  isCoordinator: boolean;
  verified: boolean;
  tripsOnSale: number;
  tripsRunning: number;
}

/** Invito ricevuto da un'agenzia, visto dall'invitato. */
export interface AgencyInvite {
  id: string;
  agencyId: string;
  agencyName: string;
  agencySlug: string;
  role: AgencyRole;
  linkType?: AgencyLinkType;
  createdAt: string;
}

/** Agenzia di cui l'utente fa parte, con il suo ruolo interno. */
export interface MyAgency {
  agency: Agency;
  role: AgencyRole;
  memberId: string;
  linkType?: AgencyLinkType;
}

export interface AgencyPublicProfile {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  logoUrl?: string;
  email?: string;
  phone?: string;
  website?: string;
  city?: string;
  country?: string;
  coordinators: CoordinatorCard[];
}

export interface AgencyRepository {
  /** Agenzie attive dell'utente (di solito una). */
  mine(): Promise<MyAgency[]>;
  create(input: { legalName: string; displayName: string; slug: string }): Promise<Agency>;
  updateProfile(agencyId: string, patch: AgencyProfileInput): Promise<Agency>;
  team(agencyId: string): Promise<AgencyMember[]>;
  invite(agencyId: string, email: string, role: AgencyRole): Promise<string>;
  invites(): Promise<AgencyInvite[]>;
  respond(memberId: string, accept: boolean): Promise<AgencyMemberStatus>;
  assignLicense(memberId: string): Promise<void>;
  revokeLicense(memberId: string): Promise<void>;
  remove(memberId: string): Promise<void>;
  setSeats(agencyId: string, seats: number, cycle: BillingCycle): Promise<Agency>;
  /** Catalogo (AG-03): viaggi dell'agenzia e viaggi dei coordinatori del team (per l'ombrello). */
  catalog(agencyId: string): Promise<{ trips: PublishedTripSummary[]; coordinatorTrips: PublishedTripSummary[] }>;
  addDeparture(tripId: string, startDate: string, endDate: string): Promise<string>;
  assignCoordinator(tripId: string, userId: string | null): Promise<void>;
  setUmbrella(agencyId: string, tripId: string, on: boolean): Promise<void>;
  setUmbrellaDefault(memberId: string, on: boolean): Promise<void>;
}

export interface AgencyStore {
  agency(user: AuthUser): AgencyRepository;
  /** Profilo pubblico per indirizzo, senza accesso. */
  agencyBySlug(slug: string): Promise<AgencyPublicProfile | null>;
}
