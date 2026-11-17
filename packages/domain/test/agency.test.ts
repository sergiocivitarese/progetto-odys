import assert from 'node:assert/strict';
import test from 'node:test';
import { agencyCan, agencySlug, isValidAgencySlug, licenseQuote, tierFor } from '../src/lib/agency.ts';

test('ruoli interni: ogni azione controlla il ruolo (AG-02)', () => {
  assert.equal(agencyCan('owner', 'licenses.seats'), true);
  assert.equal(agencyCan('admin', 'licenses.seats'), false, 'solo il proprietario compra licenze');
  assert.equal(agencyCan('admin', 'licenses.assign'), true);
  assert.equal(agencyCan('operator', 'team.view'), true);
  assert.equal(agencyCan('operator', 'team.invite'), false);
  assert.equal(agencyCan('coordinator', 'team.view'), false);
  assert.equal(agencyCan(null, 'team.view'), false);
});

test('scaglioni: prezzo per licenza, totale, quanto manca al successivo (AG-10)', () => {
  assert.equal(tierFor(0), null);
  assert.equal(tierFor(4)?.from, 1);
  assert.equal(tierFor(5)?.from, 5);
  assert.equal(tierFor(120)?.to, null);

  const three = licenseQuote(3);
  assert.deepEqual([three.perLicenseMonthlyCents, three.totalCents, three.next?.tier.from, three.next?.missing], [4900, 14700, 5, 2]);
  const five = licenseQuote(5);
  assert.equal(five.totalCents, 5 * 3900, 'il prezzo dello scaglione vale per tutte le licenze');
  assert.ok(five.totalCents < licenseQuote(4).totalCents + 4900, 'più licenze, meno costa ciascuna');
  const annual = licenseQuote(3, 'annual');
  assert.equal(annual.totalCents, 4900 * 3 * 10);
  assert.equal(licenseQuote(45).next, null);
  assert.deepEqual([licenseQuote(0).totalCents, licenseQuote(0).next?.missing], [0, 1]);
});

test('indirizzo pubblico dell’agenzia', () => {
  assert.equal(agencySlug('Viaggi Lenti Srl'), 'viaggi-lenti-srl');
  assert.equal(agencySlug('  Città & Mare — Tour  '), 'citta-mare-tour');
  assert.equal(isValidAgencySlug('viaggi-lenti'), true);
  assert.equal(isValidAgencySlug('-no'), false);
  assert.equal(isValidAgencySlug('a'), false);
});

test('moduli a piano: membri, dati avanzati e automazioni per livello (AG-08)', async () => {
  const { AGENCY_TIER_MODULES, canAddMember, tierForModule, isAgencyTier } = await import('../src/lib/agency.ts');
  assert.equal(canAddMember('start', 4), true);
  assert.equal(canAddMember('start', 5), false);
  assert.equal(canAddMember('pro', 19), true);
  assert.equal(canAddMember('business', 500), true);
  assert.equal(tierForModule('advancedAnalytics'), 'pro');
  assert.equal(tierForModule('automations'), 'business');
  assert.equal(AGENCY_TIER_MODULES.start.advancedAnalytics, false);
  assert.equal(isAgencyTier('pro'), true);
  assert.equal(isAgencyTier('gold'), false);
});
