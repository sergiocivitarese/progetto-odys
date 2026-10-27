import { inject, Injectable } from '@angular/core';
import { ApiClient } from './api-client';

/* Segnalazioni (S-07) e strumenti dell'amministratore (G-02…G-04). */

export type ReportTarget = 'post' | 'published_trip' | 'profile';
export type ReportReason = 'spam' | 'inappropriate' | 'misleading' | 'copyright' | 'safety' | 'other';
export type ReportStatus = 'open' | 'resolved' | 'dismissed';
export type ReportAction = 'dismiss' | 'hidden' | 'suspended';
export type AccountRole = 'traveler' | 'coordinator' | 'agency' | 'admin';
export type AccountStatus = 'active' | 'suspended' | 'disabled';

export interface ReportReview {
  id: string;
  targetKind: ReportTarget;
  targetId: string;
  reason: ReportReason;
  details?: string;
  status: ReportStatus;
  actionTaken?: 'none' | 'hidden' | 'suspended';
  resolutionNote?: string;
  decidedAt?: string;
  createdAt: string;
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
  role: AccountRole;
  status: AccountStatus;
  createdAt: string;
}

export const REPORT_REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: 'misleading', label: 'Informazioni false o ingannevoli' },
  { value: 'inappropriate', label: 'Contenuto inappropriato' },
  { value: 'spam', label: 'Spam o pubblicità' },
  { value: 'copyright', label: 'Viola diritti d’autore o privacy' },
  { value: 'safety', label: 'Rischio per la sicurezza' },
  { value: 'other', label: 'Altro' },
];

export const REPORT_TARGET_LABELS: Record<ReportTarget, string> = { post: 'Post', published_trip: 'Viaggio di gruppo', profile: 'Profilo' };
export const ROLE_LABELS: Record<AccountRole, string> = { traveler: 'Viaggiatore', coordinator: 'Coordinatore', agency: 'Agenzia', admin: 'Amministratore' };
export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = { active: 'Attivo', suspended: 'Sospeso', disabled: 'Disattivato' };

@Injectable({ providedIn: 'root' })
export class ModerationApi {
  private readonly api = inject(ApiClient);

  report(targetKind: ReportTarget, targetId: string, reason: ReportReason, details?: string) {
    return this.api.post<{ id: string; status: ReportStatus }>('/reports', { targetKind, targetId, reason, details: details || undefined });
  }

  reports(status?: ReportStatus) { return this.api.get<ReportReview[]>('/admin/reports', { status }); }
  resolve(id: string, action: ReportAction, note: string) { return this.api.post<ReportReview>(`/admin/reports/${encodeURIComponent(id)}/resolve`, { action, note: note || undefined }); }
  accounts(query?: string) { return this.api.get<AccountSummary[]>('/admin/accounts', { q: query || undefined }); }
  updateAccount(id: string, changes: { role?: AccountRole; status?: AccountStatus }, note: string) {
    return this.api.patch<AccountSummary>(`/admin/accounts/${encodeURIComponent(id)}`, { ...changes, note: note || undefined });
  }
}
