import type { SplitCategory, SplitExpense, SplitShare } from '@odys/domain';
import type { AuthUser } from './auth';

/* Cassa comune del viaggio di gruppo (TP-09). */

export interface SplitMember {
  userId: string;
  displayName: string;
  initials: string;
  isCoordinator: boolean;
}

/** Un viaggio di cui l'utente fa parte del gruppo. */
export interface SplitGroup {
  tripId: string;
  title: string;
  destination: string;
  startDate?: string;
  endDate?: string;
}

export interface NewSplitExpense {
  description: string;
  category: SplitCategory;
  amountCents: number;
  paidBy: string;
  shares: SplitShare[];
}

export interface SplitRepository {
  groups(): Promise<SplitGroup[]>;
  /** Membri del gruppo; errore 403 se l'utente non ne fa parte. */
  members(tripId: string): Promise<SplitMember[]>;
  expenses(tripId: string): Promise<SplitExpense[]>;
  add(tripId: string, expense: NewSplitExpense): Promise<SplitExpense>;
  remove(expenseId: string): Promise<void>;
}

export interface SplitStore {
  split(user: AuthUser): SplitRepository;
}
