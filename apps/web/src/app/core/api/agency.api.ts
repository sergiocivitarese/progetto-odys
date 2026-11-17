import { inject, Injectable } from '@angular/core';
import type { AgencyDashboardSummary, AgencyLinkType, AgencyMemberStatus, AgencyRole, BillingCycle, DashboardPeriodKey, LicenseQuote } from '@odys/domain';
import { ApiClient } from './api-client';
import type { CoordinatorCard, PublishedTripSummary } from './catalog.api';

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

export interface MyAgency { agency: Agency; role: AgencyRole; memberId: string; linkType?: AgencyLinkType; quote: LicenseQuote }

export interface AgencyMember {
  id: string; userId: string; firstName: string; lastName: string; email?: string; role: AgencyRole; linkType?: AgencyLinkType;
  status: AgencyMemberStatus; licensed: boolean; umbrellaDefault: boolean; createdAt: string; acceptedAt?: string;
  isCoordinator: boolean; verified: boolean; tripsOnSale: number; tripsRunning: number;
}

export interface AgencyInvite { id: string; agencyId: string; agencyName: string; agencySlug: string; role: AgencyRole; linkType?: AgencyLinkType; createdAt: string }

export interface AgencyPublicProfile {
  id: string; slug: string; displayName: string; description: string; logoUrl?: string; email?: string; phone?: string; website?: string; city?: string; country?: string;
  coordinators: CoordinatorCard[];
}

export type AgencyProfileForm = Partial<Pick<Agency, 'legalName' | 'displayName' | 'slug' | 'description' | 'logoUrl' | 'email' | 'phone' | 'website' | 'city' | 'country' | 'saleTerms'>>;

/** Viaggio nel catalogo dell'agenzia, con i posti occupati (AG-03). */
export type CatalogTrip = PublishedTripSummary & { seatsTaken: number };

/** Endpoint `/api/agency` (area agenzia e inviti) e `/api/agencies/:slug` (pagina pubblica). */
@Injectable({ providedIn: 'root' })
export class AgencyApi {
  private readonly api = inject(ApiClient);
  mine() { return this.api.get<MyAgency | null>('/agency'); }
  create(form: AgencyProfileForm) { return this.api.post<Agency>('/agency', form); }
  update(id: string, form: AgencyProfileForm) { return this.api.put<Agency>(`/agency/${encodeURIComponent(id)}`, form); }
  team(id: string) { return this.api.get<AgencyMember[]>(`/agency/${encodeURIComponent(id)}/team`); }
  invite(id: string, email: string, role: AgencyRole) { return this.api.post<{ id: string }>(`/agency/${encodeURIComponent(id)}/team`, { email, role }); }
  remove(memberId: string) { return this.api.delete(`/agency/members/${encodeURIComponent(memberId)}`); }
  assignLicense(memberId: string) { return this.api.post<void>(`/agency/members/${encodeURIComponent(memberId)}/license`, {}); }
  revokeLicense(memberId: string) { return this.api.delete(`/agency/members/${encodeURIComponent(memberId)}/license`); }
  setLicenses(id: string, seats: number, billingCycle: BillingCycle) { return this.api.put<{ agency: Agency; quote: LicenseQuote }>(`/agency/${encodeURIComponent(id)}/licenses`, { seats, billingCycle }); }
  invites() { return this.api.get<AgencyInvite[]>('/agency/invites/mine'); }
  respond(memberId: string, accept: boolean) { return this.api.post<{ status: AgencyMemberStatus }>(`/agency/invites/${encodeURIComponent(memberId)}/${accept ? 'accept' : 'decline'}`, {}); }
  catalog(id: string) { return this.api.get<{ trips: CatalogTrip[]; coordinatorTrips: CatalogTrip[] }>(`/agency/${encodeURIComponent(id)}/catalog`); }
  addDeparture(tripId: string, startDate: string, endDate: string) { return this.api.post<{ id: string }>(`/agency/trips/${encodeURIComponent(tripId)}/departures`, { startDate, endDate }); }
  assignCoordinator(tripId: string, userId: string | null) { return this.api.put<void>(`/agency/trips/${encodeURIComponent(tripId)}/coordinator`, { userId }); }
  setUmbrella(id: string, tripId: string, on: boolean) { return this.api.put<void>(`/agency/${encodeURIComponent(id)}/umbrella/${encodeURIComponent(tripId)}`, { on }); }
  setUmbrellaDefault(memberId: string, on: boolean) { return this.api.put<void>(`/agency/members/${encodeURIComponent(memberId)}/umbrella`, { on }); }
  dashboard(id: string, periodo: DashboardPeriodKey) { return this.api.get<{ summary: AgencyDashboardSummary; periods: Record<DashboardPeriodKey, string> }>(`/agency/${encodeURIComponent(id)}/dashboard`, { periodo }); }
  publicProfile(slug: string) { return this.api.get<AgencyPublicProfile>(`/agencies/${encodeURIComponent(slug)}`); }
}
