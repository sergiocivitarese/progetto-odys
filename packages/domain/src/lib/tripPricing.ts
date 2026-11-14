/*
 * Composizione del prezzo di un viaggio pubblicato (CB-04): voci di costo,
 * servizio Odys, margine per partecipante, punto di pareggio e guadagno del
 * coordinatore a viaggio pieno.
 *
 * Tutti gli importi sono in centesimi. La commissione Odys è un punto aperto
 * del cliente: SERVICE_RATE è un valore provvisorio, usato solo per mostrare
 * al coordinatore una stima. Il prezzo pagato dal viaggiatore resta quello
 * indicato dal coordinatore (il servizio si considera compreso).
 */

export const COST_CATEGORIES = ['alloggi', 'trasporti', 'attivita', 'altro'] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  alloggi: 'Alloggi',
  trasporti: 'Trasporti',
  attivita: 'Attività',
  altro: 'Altro',
};

/** `per_person`: si paga per ogni partecipante (hotel, biglietti); `group`: una volta per il gruppo (pulmino, guida, il volo del coordinatore). */
export type CostBasis = 'per_person' | 'group';

export interface CostItem {
  id: string;
  label: string;
  category: CostCategory;
  basis: CostBasis;
  amountCents: number;
}

/** Servizio Odys provvisorio: 10% della quota a persona, compreso nel prezzo. */
export const SERVICE_RATE = 0.1;
export const MAX_COST_ITEMS = 40;

export interface PricingInput {
  priceCents: number | undefined;
  capacity: number | undefined;
  costs: readonly CostItem[];
  serviceRate?: number;
}

export interface PricingSummary {
  /** Somma dei costi per persona, per un partecipante. */
  perPersonCostsCents: number;
  /** Somma dei costi fissi del gruppo. */
  groupCostsCents: number;
  /** Servizio Odys per partecipante. */
  serviceFeeCents: number;
  /** Quanto resta al coordinatore per ogni partecipante, prima dei costi di gruppo. */
  marginPerParticipantCents: number | null;
  /** Partecipanti necessari per coprire tutti i costi; null se il margine non è positivo. */
  breakEven: number | null;
  /** Il pareggio si raggiunge entro i posti disponibili. */
  breakEvenReachable: boolean;
  /** Guadagno del coordinatore con tutti i posti venduti. */
  earningsAtFullCents: number | null;
  /** Guadagno con il numero di partecipanti del pareggio (zero o poco più). */
  earningsAtBreakEvenCents: number | null;
  /** Costo totale per categoria a viaggio pieno. */
  byCategory: Record<CostCategory, number>;
}

function sum(costs: readonly CostItem[], basis: CostBasis): number {
  return costs.filter((cost) => cost.basis === basis).reduce((total, cost) => total + cost.amountCents, 0);
}

export function summarizePricing(input: PricingInput): PricingSummary {
  const rate = input.serviceRate ?? SERVICE_RATE;
  const capacity = input.capacity && input.capacity > 0 ? input.capacity : undefined;
  const perPersonCostsCents = sum(input.costs, 'per_person');
  const groupCostsCents = sum(input.costs, 'group');
  const price = input.priceCents !== undefined && input.priceCents >= 0 ? input.priceCents : undefined;
  const serviceFeeCents = price === undefined ? 0 : Math.round(price * rate);
  const byCategory = Object.fromEntries(COST_CATEGORIES.map((category) => [category, 0])) as Record<CostCategory, number>;
  for (const cost of input.costs) byCategory[cost.category] += cost.basis === 'per_person' ? cost.amountCents * (capacity ?? 1) : cost.amountCents;

  if (price === undefined) {
    return { perPersonCostsCents, groupCostsCents, serviceFeeCents, marginPerParticipantCents: null, breakEven: null, breakEvenReachable: false, earningsAtFullCents: null, earningsAtBreakEvenCents: null, byCategory };
  }
  const margin = price - serviceFeeCents - perPersonCostsCents;
  const breakEven = margin > 0 ? Math.max(1, Math.ceil(groupCostsCents / margin)) : null;
  return {
    perPersonCostsCents,
    groupCostsCents,
    serviceFeeCents,
    marginPerParticipantCents: margin,
    breakEven,
    breakEvenReachable: breakEven !== null && capacity !== undefined && breakEven <= capacity,
    earningsAtFullCents: capacity === undefined ? null : capacity * margin - groupCostsCents,
    earningsAtBreakEvenCents: breakEven === null ? null : breakEven * margin - groupCostsCents,
    byCategory,
  };
}

/**
 * Quota a persona che, con tutti i posti venduti, copre costi e servizio Odys
 * e lascia al coordinatore almeno il compenso desiderato. Arrotondata all'euro in su.
 */
export function suggestedPriceCents(input: { capacity: number | undefined; costs: readonly CostItem[]; targetEarningsCents: number; serviceRate?: number }): number | null {
  const rate = input.serviceRate ?? SERVICE_RATE;
  if (!input.capacity || input.capacity <= 0 || rate >= 1) return null;
  const needPerPerson = (sum(input.costs, 'group') + Math.max(0, input.targetEarningsCents)) / input.capacity + sum(input.costs, 'per_person');
  let price = Math.ceil(needPerPerson / (1 - rate) / 100) * 100;
  // L'arrotondamento del servizio può costare un centesimo: si sale di un euro finché il compenso è coperto.
  while ((price - Math.round(price * rate) - sum(input.costs, 'per_person')) * input.capacity - sum(input.costs, 'group') < input.targetEarningsCents) price += 100;
  return price;
}

/** Valida le voci di costo ricevute dal client (API) o lette dall'archivio. */
export function normalizeCostItems(value: unknown): CostItem[] {
  if (!Array.isArray(value)) throw new Error('Le voci di costo devono essere un elenco.');
  if (value.length > MAX_COST_ITEMS) throw new Error(`Al massimo ${MAX_COST_ITEMS} voci di costo.`);
  return value.map((raw, index) => {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const label = typeof entry['label'] === 'string' ? entry['label'].trim().slice(0, 80) : '';
    if (!label) throw new Error(`Dai un nome alla voce di costo ${index + 1}.`);
    const amount = Number(entry['amountCents']);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) throw new Error(`L’importo di «${label}» non è valido.`);
    const basis = entry['basis'];
    if (basis !== 'per_person' && basis !== 'group') throw new Error(`Indica se «${label}» si paga per persona o per il gruppo.`);
    const category = COST_CATEGORIES.includes(entry['category'] as CostCategory) ? (entry['category'] as CostCategory) : 'altro';
    const id = typeof entry['id'] === 'string' && entry['id'].trim() ? entry['id'].trim().slice(0, 64) : `cost-${index + 1}-${Math.random().toString(36).slice(2, 8)}`;
    return { id, label, category, basis, amountCents: Math.round(amount) };
  });
}
