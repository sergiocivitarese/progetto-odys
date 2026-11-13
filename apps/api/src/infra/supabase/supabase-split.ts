import type { SupabaseClient } from '@supabase/supabase-js';
import type { SplitCategory, SplitExpense } from '@odys/domain';
import type { AppConfig } from '../../config/env';
import type { AuthUser } from '../../shared/auth';
import type { NewSplitExpense, SplitGroup, SplitMember, SplitRepository, SplitStore } from '../../shared/split';
import { dbError, userClient } from './client';

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

interface ExpenseRow {
  id: string;
  description: string;
  category: SplitCategory;
  amount_cents: number;
  paid_by: string;
  created_at: string;
  split_shares: Array<{ user_id: string; amount_cents: number }>;
}

function toExpense(row: ExpenseRow): SplitExpense {
  return {
    id: row.id, description: row.description, category: row.category, amountCents: row.amount_cents, paidBy: row.paid_by, createdAt: row.created_at,
    shares: (row.split_shares ?? []).map((share) => ({ userId: share.user_id, amountCents: share.amount_cents })),
  };
}

/** Cassa comune su Supabase: lettura con RLS, scrittura solo con le funzioni del database. */
class SupabaseSplitRepository implements SplitRepository {
  constructor(private readonly db: SupabaseClient, private readonly user: AuthUser) {}

  async groups(): Promise<SplitGroup[]> {
    const [own, joined] = await Promise.all([
      this.db.from('published_trips').select('id, title, destination, start_date, end_date').eq('coordinator_id', this.user.id).in('status', ['published', 'active', 'completed']),
      this.db.from('participation_requests').select('published_trip_id').eq('user_id', this.user.id).in('status', ['confirmed', 'balance_paid']),
    ]);
    if (own.error) throw dbError(own.error);
    if (joined.error) throw dbError(joined.error);
    const ids = (joined.data ?? []).map((row) => row.published_trip_id as string);
    const others = ids.length ? await this.db.from('published_trips').select('id, title, destination, start_date, end_date').in('id', ids) : { data: [], error: null };
    if (others.error) throw dbError(others.error);
    const rows = [...(own.data ?? []), ...(others.data ?? [])] as Array<{ id: string; title: string; destination: string; start_date: string | null; end_date: string | null }>;
    const unique = new Map(rows.map((row) => [row.id, row]));
    return [...unique.values()]
      .map((row) => ({ tripId: row.id, title: row.title, destination: row.destination, startDate: row.start_date ?? undefined, endDate: row.end_date ?? undefined }))
      .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
  }

  async members(tripId: string): Promise<SplitMember[]> {
    if (!isUuid(tripId)) throw dbError({ code: 'P0002' });
    const { data, error } = await this.db.rpc('split_group', { p_published_trip_id: tripId });
    if (error) throw dbError(error);
    return (data as Array<{ user_id: string; display_name: string; initials: string; is_coordinator: boolean }>).map((row) => ({
      userId: row.user_id, displayName: row.display_name, initials: row.initials, isCoordinator: row.is_coordinator,
    }));
  }

  async expenses(tripId: string): Promise<SplitExpense[]> {
    if (!isUuid(tripId)) return [];
    const { data, error } = await this.db.from('split_expenses').select('id, description, category, amount_cents, paid_by, created_at, split_shares (user_id, amount_cents)')
      .eq('published_trip_id', tripId).is('deleted_at', null).order('created_at', { ascending: false });
    if (error) throw dbError(error);
    return (data as ExpenseRow[]).map(toExpense);
  }

  async add(tripId: string, expense: NewSplitExpense): Promise<SplitExpense> {
    const { data, error } = await this.db.rpc('add_split_expense', {
      p_published_trip_id: tripId, p_description: expense.description, p_category: expense.category,
      p_amount_cents: expense.amountCents, p_paid_by: expense.paidBy, p_shares: expense.shares,
    }).single();
    if (error) throw dbError(error);
    const row = data as Omit<ExpenseRow, 'split_shares'>;
    return toExpense({ ...row, split_shares: expense.shares.map((share) => ({ user_id: share.userId, amount_cents: share.amountCents })) });
  }

  async remove(expenseId: string): Promise<void> {
    if (!isUuid(expenseId)) throw dbError({ code: 'P0002' });
    const { error } = await this.db.rpc('delete_split_expense', { p_expense_id: expenseId });
    if (error) throw dbError(error);
  }
}

export function supabaseSplit(config: AppConfig): SplitStore {
  return { split: (user) => new SupabaseSplitRepository(userClient(config, user.accessToken), user) };
}
