import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCostItems, suggestedPriceCents, summarizePricing, type CostItem } from '../src/lib/tripPricing.ts';

const item = (label: string, category: CostItem['category'], basis: CostItem['basis'], amountCents: number): CostItem =>
  ({ id: label, label, category, basis, amountCents });

const costs = [
  item('Hotel 4 notti', 'alloggi', 'per_person', 32000),
  item('Pulmino con autista', 'trasporti', 'group', 120000),
  item('Biglietti musei', 'attivita', 'per_person', 4000),
  item('Il mio volo', 'altro', 'group', 30000),
];

test('margine per partecipante, punto di pareggio e guadagno a viaggio pieno (CB-04)', () => {
  const summary = summarizePricing({ priceCents: 69000, capacity: 12, costs, serviceRate: 0.1 });
  assert.equal(summary.perPersonCostsCents, 36000);
  assert.equal(summary.groupCostsCents, 150000);
  assert.equal(summary.serviceFeeCents, 6900);
  assert.equal(summary.marginPerParticipantCents, 69000 - 6900 - 36000);
  // 150000 / 26100 = 5,7 → servono 6 partecipanti.
  assert.equal(summary.breakEven, 6);
  assert.equal(summary.breakEvenReachable, true);
  assert.equal(summary.earningsAtFullCents, 12 * 26100 - 150000);
  assert.equal(summary.earningsAtBreakEvenCents, 6 * 26100 - 150000);
  assert.deepEqual(summary.byCategory, { alloggi: 32000 * 12, trasporti: 120000, attivita: 4000 * 12, altro: 30000 });
});

test('senza margine il pareggio non esiste; oltre i posti non è raggiungibile', () => {
  const loss = summarizePricing({ priceCents: 38000, capacity: 12, costs, serviceRate: 0.1 });
  assert.equal(loss.marginPerParticipantCents, 38000 - 3800 - 36000);
  assert.equal(loss.breakEven, null);
  assert.equal(loss.breakEvenReachable, false);
  assert.ok(loss.earningsAtFullCents < 0);

  const tight = summarizePricing({ priceCents: 50000, capacity: 6, costs, serviceRate: 0.1 });
  // margine 9000: servono 17 persone, ma i posti sono 6.
  assert.equal(tight.breakEven, 17);
  assert.equal(tight.breakEvenReachable, false);
});

test('senza costi di gruppo il pareggio è il primo partecipante; senza prezzo o posti non si calcola', () => {
  const simple = summarizePricing({ priceCents: 50000, capacity: 8, costs: [item('Hotel', 'alloggi', 'per_person', 20000)], serviceRate: 0.1 });
  assert.equal(simple.breakEven, 1);
  const empty = summarizePricing({ priceCents: undefined, capacity: undefined, costs, serviceRate: 0.1 });
  assert.equal(empty.breakEven, null);
  assert.equal(empty.earningsAtFullCents, null);
  assert.equal(empty.serviceFeeCents, 0);
});

test('prezzo consigliato per ottenere il compenso desiderato a viaggio pieno', () => {
  const price = suggestedPriceCents({ capacity: 12, costs, targetEarningsCents: 120000, serviceRate: 0.1 });
  assert.ok(price !== null);
  // Arrotondato all'euro in su e sufficiente a garantire il compenso.
  assert.equal(price % 100, 0);
  const check = summarizePricing({ priceCents: price, capacity: 12, costs, serviceRate: 0.1 });
  assert.ok(check.earningsAtFullCents! >= 120000);
  const oneEuroLess = summarizePricing({ priceCents: price - 100, capacity: 12, costs, serviceRate: 0.1 });
  assert.ok(oneEuroLess.earningsAtFullCents! < 120000);
  assert.equal(suggestedPriceCents({ capacity: undefined, costs, targetEarningsCents: 1000, serviceRate: 0.1 }), null);
});

test('le voci di costo arrivano pulite: etichetta, categoria, base e importo validi', () => {
  const clean = normalizeCostItems([
    { id: 'a', label: '  Hotel ', category: 'alloggi', basis: 'per_person', amountCents: 1200 },
    { label: 'Senza id', category: 'sconosciuta', basis: 'group', amountCents: 500.6 },
  ]);
  assert.equal(clean[0].label, 'Hotel');
  assert.equal(clean[1].category, 'altro');
  assert.equal(clean[1].amountCents, 501);
  assert.ok(clean[1].id);
  assert.throws(() => normalizeCostItems([{ label: '', category: 'alloggi', basis: 'group', amountCents: 100 }]), /nome/);
  assert.throws(() => normalizeCostItems([{ label: 'Hotel', category: 'alloggi', basis: 'group', amountCents: -1 }]), /importo/);
  assert.throws(() => normalizeCostItems([{ label: 'Hotel', category: 'alloggi', basis: 'boh', amountCents: 1 }]), /persona o per il gruppo/);
  assert.throws(() => normalizeCostItems(Array.from({ length: 41 }, (_, i) => ({ label: `v${i}`, category: 'altro', basis: 'group', amountCents: 1 }))), /40 voci/);
});
