import assert from 'node:assert/strict';
import test from 'node:test';
import { simplifyDebts, splitBalances, splitCategoryTotals, splitEqually, summarizeSplit, type SplitExpense } from '../src/lib/split.ts';

const expense = (id: string, paidBy: string, amountCents: number, among: string[], category: SplitExpense['category'] = 'food'): SplitExpense =>
  ({ id, description: id, category, amountCents, paidBy, shares: splitEqually(amountCents, among), createdAt: '2027-05-15T20:00:00Z' });

test('la divisione in parti uguali non perde centesimi', () => {
  const shares = splitEqually(1000, ['a', 'b', 'c']);
  assert.deepEqual(shares.map((share) => share.amountCents), [334, 333, 333]);
  assert.throws(() => splitEqually(0, ['a']), /maggiore di zero/);
  assert.throws(() => splitEqually(100, []), /almeno una persona/);
});

test('saldi e saldo semplificato con il minor numero di pagamenti (TP-09)', () => {
  const expenses = [
    expense('cena', 'sara', 21600, ['sara', 'luca', 'giulia']),
    expense('traghetto', 'giulia', 9000, ['sara', 'luca', 'giulia'], 'transport'),
    expense('museo', 'luca', 3000, ['luca', 'giulia'], 'activities'),
  ];
  const balances = splitBalances(expenses, ['sara', 'luca', 'giulia']);
  assert.equal([...balances.values()].reduce((a, b) => a + b, 0), 0, 'i saldi si compensano');
  const transfers = simplifyDebts(balances);
  assert.ok(transfers.length <= 2);
  // Applicando i pagamenti, tutti tornano a zero.
  const after = new Map(balances);
  for (const t of transfers) { after.set(t.from, after.get(t.from)! + t.amountCents); after.set(t.to, after.get(t.to)! - t.amountCents); }
  assert.ok([...after.values()].every((value) => value === 0));

  // Un rimborso chiude il debito senza contare come spesa.
  const paid = [...expenses, expense('rimborso', transfers[0].from, transfers[0].amountCents, [transfers[0].to], 'settlement')];
  const summary = summarizeSplit(paid, ['sara', 'luca', 'giulia'], 'giulia');
  assert.equal(summary.totalCents, 33600);
  assert.equal(summary.transfers.length, transfers.length - 1);
  assert.deepEqual(splitCategoryTotals(paid).map((item) => item.category), ['food', 'transport', 'activities']);
});
