import { inject, Injectable } from '@angular/core';
import type { SplitCategory, SplitExpense, SplitTransfer } from '@odys/domain';
import { ApiClient } from './api-client';
import type { PublishedTripSummary } from './catalog.api';

export interface SplitMember { userId: string; displayName: string; initials: string; isCoordinator: boolean }
export interface SplitGroup { tripId: string; title: string; destination: string; startDate?: string; endDate?: string }

export interface SplitView {
  trip: PublishedTripSummary | null;
  members: SplitMember[];
  expenses: SplitExpense[];
  summary: {
    totalCents: number;
    myShareCents: number;
    myBalanceCents: number;
    balances: Record<string, number>;
    transfers: SplitTransfer[];
    naiveTransfers: number;
    categories: Array<{ category: SplitCategory; amountCents: number; percent: number }>;
  };
}

/** Endpoint `/api/split`: cassa comune del viaggio (TP-09). */
@Injectable({ providedIn: 'root' })
export class SplitApi {
  private readonly api = inject(ApiClient);
  groups() { return this.api.get<SplitGroup[]>('/split'); }
  view(tripId: string) { return this.api.get<SplitView>(`/split/${encodeURIComponent(tripId)}`); }
  add(tripId: string, expense: { description: string; category: SplitCategory; amount: number; paidBy: string; among: string[] }) {
    return this.api.post<SplitView>(`/split/${encodeURIComponent(tripId)}/expenses`, expense);
  }
  settle(tripId: string, to: string, amount: number) { return this.api.post<SplitView>(`/split/${encodeURIComponent(tripId)}/settle`, { to, amount }); }
  remove(expenseId: string) { return this.api.delete(`/split/expenses/${encodeURIComponent(expenseId)}`); }
}
