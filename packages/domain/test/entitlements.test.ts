import assert from 'node:assert/strict';
import test from 'node:test';
import { describeEntitlements, PLAN_ENTITLEMENTS, resolvePlan } from '../src/lib/entitlements.ts';

test('i quattro profili individuali sono cumulativi', () => {
  const chain = ['traveller_base', 'traveller_premium', 'coordinator_base', 'coordinator_premium'] as const;
  for (let index = 1; index < chain.length; index += 1) {
    for (const right of PLAN_ENTITLEMENTS[chain[index - 1]]) assert.ok(PLAN_ENTITLEMENTS[chain[index]].includes(right), `${chain[index]} eredita ${right}`);
  }
});

test('l’agenzia non prenota e non usa lo Split, ma vende e ha il generatore AI', () => {
  const agency = PLAN_ENTITLEMENTS.agency;
  assert.ok(!agency.includes('trips.book') && !agency.includes('split.use') && !agency.includes('analytics.coordinator'));
  assert.ok(agency.includes('trips.sell') && agency.includes('ai.generate') && agency.includes('agency.licenses'));
});

test('il profilo dipende da ruolo e piani attivi', () => {
  assert.equal(resolvePlan('traveler', []), 'traveller_base');
  assert.equal(resolvePlan('traveler', ['traveller_premium']), 'traveller_premium');
  assert.equal(resolvePlan('coordinator', []), 'coordinator_base');
  assert.equal(resolvePlan('coordinator', ['traveller_premium']), 'coordinator_base');
  assert.equal(resolvePlan('coordinator', ['coordinator_premium']), 'coordinator_premium');
  assert.equal(resolvePlan('agency', []), 'agency');
  assert.ok(describeEntitlements('admin', []).entitlements.includes('admin.moderate'));
  assert.ok(!describeEntitlements('traveler', []).entitlements.includes('ai.generate'));
});
