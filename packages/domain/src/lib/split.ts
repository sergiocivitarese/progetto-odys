/*
 * Split delle spese (TP-09): cassa comune del viaggio.
 *
 * Importi sempre in centesimi interi. Ogni spesa ha chi ha pagato e le quote
 * di chi la divide; il saldo di ciascuno è (pagato − dovuto). Il «saldo
 * semplificato» chiude tutti i conti con il minor numero di pagamenti
 * ragionevole (algoritmo goloso: il debitore più grande paga il creditore più grande).
 * Un rimborso tra due persone è una spesa di categoria `settlement` pagata dal
 * debitore e attribuita per intero al creditore.
 */

export const SPLIT_CATEGORIES = ['food', 'transport', 'activities', 'lodging', 'other', 'settlement'] as const;
export type SplitCategory = (typeof SPLIT_CATEGORIES)[number];

export const SPLIT_CATEGORY_LABELS: Record<SplitCategory, string> = {
  food: 'Cibo',
  transport: 'Trasporti',
  activities: 'Attività',
  lodging: 'Alloggi',
  other: 'Altro',
  settlement: 'Rimborso',
};

export interface SplitShare {
  userId: string;
  amountCents: number;
}

export interface SplitExpense {
  id: string;
  description: string;
  category: SplitCategory;
  amountCents: number;
  paidBy: string;
  shares: SplitShare[];
  createdAt: string;
}

export interface SplitTransfer {
  from: string;
  to: string;
  amountCents: number;
}

/** Divide un importo in parti uguali; i centesimi che avanzano vanno ai primi, così la somma torna sempre. */
export function splitEqually(amountCents: number, userIds: readonly string[]): SplitShare[] {
  const unique = [...new Set(userIds)];
  if (!unique.length) throw new Error('Scegli almeno una persona con cui dividere la spesa.');
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('L’importo deve essere maggiore di zero.');
  const base = Math.floor(amountCents / unique.length);
  const rest = amountCents - base * unique.length;
  return unique.map((userId, index) => ({ userId, amountCents: base + (index < rest ? 1 : 0) }));
}

/** Saldo di ciascuno: positivo = deve ricevere, negativo = deve dare. */
export function splitBalances(expenses: readonly SplitExpense[], members: readonly string[] = []): Map<string, number> {
  const balances = new Map<string, number>(members.map((id) => [id, 0]));
  for (const expense of expenses) {
    balances.set(expense.paidBy, (balances.get(expense.paidBy) ?? 0) + expense.amountCents);
    for (const share of expense.shares) balances.set(share.userId, (balances.get(share.userId) ?? 0) - share.amountCents);
  }
  return balances;
}

/** Pagamenti che chiudono tutti i conti: ognuno salda al massimo con pochi passaggi. */
export function simplifyDebts(balances: ReadonlyMap<string, number>): SplitTransfer[] {
  const debtors = [...balances].filter(([, value]) => value < 0).map(([id, value]) => ({ id, amount: -value }));
  const creditors = [...balances].filter(([, value]) => value > 0).map(([id, value]) => ({ id, amount: value }));
  const transfers: SplitTransfer[] = [];
  const byAmount = (a: { amount: number; id: string }, b: { amount: number; id: string }) => b.amount - a.amount || a.id.localeCompare(b.id);
  while (debtors.length && creditors.length) {
    debtors.sort(byAmount);
    creditors.sort(byAmount);
    const debtor = debtors[0];
    const creditor = creditors[0];
    const amount = Math.min(debtor.amount, creditor.amount);
    transfers.push({ from: debtor.id, to: creditor.id, amountCents: amount });
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (!debtor.amount) debtors.shift();
    if (!creditor.amount) creditors.shift();
  }
  return transfers;
}

/** Quanti pagamenti servirebbero senza semplificare: uno per ogni coppia debitore → pagatore. */
export function naiveTransferCount(expenses: readonly SplitExpense[]): number {
  const pairs = new Set<string>();
  for (const expense of expenses) {
    if (expense.category === 'settlement') continue;
    for (const share of expense.shares) if (share.userId !== expense.paidBy && share.amountCents > 0) pairs.add(`${share.userId}>${expense.paidBy}`);
  }
  return pairs.size;
}

/** Totale speso dal gruppo per categoria (i rimborsi non sono spese). */
export function splitCategoryTotals(expenses: readonly SplitExpense[]): Array<{ category: SplitCategory; amountCents: number; percent: number }> {
  const totals = new Map<SplitCategory, number>();
  for (const expense of expenses) {
    if (expense.category === 'settlement') continue;
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amountCents);
  }
  const sum = [...totals.values()].reduce((total, value) => total + value, 0);
  return [...totals].map(([category, amountCents]) => ({ category, amountCents, percent: sum ? Math.round((amountCents / sum) * 100) : 0 }))
    .sort((a, b) => b.amountCents - a.amountCents);
}

/** Riepilogo per chi guarda: totale del gruppo, la sua quota, il suo saldo e i pagamenti semplificati. */
export function summarizeSplit(expenses: readonly SplitExpense[], members: readonly string[], viewer: string) {
  const balances = splitBalances(expenses, members);
  const spent = expenses.filter((expense) => expense.category !== 'settlement');
  return {
    totalCents: spent.reduce((total, expense) => total + expense.amountCents, 0),
    myShareCents: spent.reduce((total, expense) => total + (expense.shares.find((share) => share.userId === viewer)?.amountCents ?? 0), 0),
    myBalanceCents: balances.get(viewer) ?? 0,
    balances: Object.fromEntries(balances),
    transfers: simplifyDebts(balances),
    naiveTransfers: naiveTransferCount(expenses),
    categories: splitCategoryTotals(expenses),
  };
}
