import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { FALLBACK_TRIP_FORM, type Itinerary } from '@odys/domain';
import { createApp } from '../src/app.ts';
import { coordinatorAlerts } from '../src/shared/catalog.ts';
import { loadConfig } from '../src/config/env.ts';
import { MemoryDatabase, memoryAuthProvider, memoryDataStore } from '../src/infra/memory/memory-store.ts';
import { simulatedPaymentProvider } from '../src/shared/payments.ts';

// OpenStreetMap (Photon) simulato: nessuna chiamata di rete nei test.
const osmCalls: string[] = [];
const fakeOsm = (async (input: RequestInfo | URL) => {
  osmCalls.push(String(input));
  if (String(input).includes('/route/v1/')) {
    const route = { distance: 1345.8, duration: 1084.1, geometry: { coordinates: [[12.5, 41.9], [12.51, 41.91]] } };
    return new Response(JSON.stringify({ code: 'Ok', routes: [route] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const features = [{ properties: { osm_type: 'R', osm_id: 5400890, type: 'city', name: 'Lisbon', country: 'Portugal', countrycode: 'PT' }, geometry: { coordinates: [-9.1366, 38.7078] } }];
  return new Response(JSON.stringify({ features }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

let baseUrl = '';
let dataDir = '';
let close: () => void = () => undefined;
const db = new MemoryDatabase();
db.addUser('token-giulia', undefined, 'giulia@example.com');
db.addUser('token-marco', undefined, 'marco@example.com');

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'odys-api-'));
  const app = createApp({ ...loadConfig({}), dataDir }, { auth: memoryAuthProvider(db), store: memoryDataStore(db), fetch: fakeOsm, payments: simulatedPaymentProvider(5) });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  close = () => server.close();
});

after(async () => {
  close();
  await rm(dataDir, { recursive: true, force: true });
});

async function call<T>(method: string, route: string, body?: unknown, token?: string): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  return { status: response.status, data: (text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null) as T };
}

type Trip = { id: string; title: string; itinerary: Itinerary; currentVersion: number };

/** Riprova finché la condizione è vera: la conferma del pagamento arriva dopo la risposta. */
async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, attempts = 50): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Condizione non raggiunta in tempo.');
}

test('la configurazione pubblica non espone chiavi segrete', async () => {
  const { status, data } = await call<{ providers: Record<string, boolean>; auth: unknown }>('GET', '/config');
  assert.equal(status, 200);
  // Senza chiavi restano attivi i servizi gratuiti OpenStreetMap e Open-Meteo.
  assert.deepEqual(data.providers, { geocoding: true, routing: true, maps: true, weather: true });
  assert.equal(data.auth, null);
});

test('pianificare non richiede l’accesso, salvare sì (U-10)', async () => {
  const generated = await call<Itinerary>('POST', '/itineraries/generate', { form: { ...FALLBACK_TRIP_FORM, destination: 'Roma' } });
  assert.equal(generated.status, 200);
  assert.equal((await call('POST', '/trips', { itinerary: generated.data })).status, 401);
  assert.equal((await call('GET', '/trips', undefined, 'token-sbagliato')).status, 401);
});

test('ciclo completo con storico: crea, modifica, versioni, ripristina, rinomina, esporta, importa, elimina', async () => {
  const generated = await call<Itinerary>('POST', '/itineraries/generate', { form: { ...FALLBACK_TRIP_FORM, destination: 'Roma' } });
  const created = await call<Trip>('POST', '/trips', { itinerary: generated.data }, 'token-giulia');
  assert.equal(created.status, 201);
  assert.equal(created.data.currentVersion, 1);
  const id = created.data.id;

  const edited = await call<Trip>('PUT', `/trips/${id}`, { itinerary: { ...generated.data, pace: 'intenso' }, changeKind: 'edited' }, 'token-giulia');
  assert.equal(edited.data.currentVersion, 2);
  const weather = await call<Trip>('PUT', `/trips/${id}`, { itinerary: generated.data, changeKind: 'edited', recordVersion: false }, 'token-giulia');
  assert.equal(weather.data.currentVersion, 2, 'gli aggiornamenti automatici non creano versioni');

  const versions = await call<Array<{ version: number; changeKind: string }>>('GET', `/trips/${id}/versions`, undefined, 'token-giulia');
  assert.deepEqual(versions.data.map((item) => [item.version, item.changeKind]), [[2, 'edited'], [1, 'created']]);

  const restored = await call<Trip>('POST', `/trips/${id}/versions/1/restore`, undefined, 'token-giulia');
  assert.equal(restored.data.currentVersion, 3);
  assert.equal(restored.data.itinerary.pace, generated.data.pace);

  const renamed = await call<Trip>('PATCH', `/trips/${id}`, { title: 'Weekend romano' }, 'token-giulia');
  assert.equal(renamed.data.title, 'Weekend romano');

  const exported = await fetch(`${baseUrl}/trips/${id}/export`, { headers: { Authorization: 'Bearer token-giulia' } }).then((response) => response.text());
  const preview = await call<{ replacesExisting: boolean }>('POST', '/trips/import/preview', { raw: exported }, 'token-giulia');
  assert.equal(preview.data.replacesExisting, true);

  assert.equal((await call('DELETE', `/trips/${id}`, undefined, 'token-giulia')).status, 204);
  assert.equal((await call('GET', `/trips/${id}`, undefined, 'token-giulia')).status, 404);

  const activity = await call<Array<{ action: string }>>('GET', '/me/activity', undefined, 'token-giulia');
  assert.deepEqual(activity.data.map((entry) => entry.action).reverse(), ['trip.create', 'trip.edited', 'trip.restore', 'trip.rename', 'trip.delete']);
});

test('un utente non vede né modifica i viaggi di un altro (S-01)', async () => {
  const generated = await call<Itinerary>('POST', '/itineraries/generate', { form: { ...FALLBACK_TRIP_FORM, destination: 'Lisbona' } });
  const created = await call<Trip>('POST', '/trips', { itinerary: generated.data }, 'token-giulia');
  assert.equal((await call('GET', `/trips/${created.data.id}`, undefined, 'token-marco')).status, 404);
  assert.equal((await call('PUT', `/trips/${created.data.id}`, { itinerary: generated.data }, 'token-marco')).status, 404);
  const list = await call<Trip[]>('GET', '/trips', undefined, 'token-marco');
  assert.equal(list.data.length, 0);
});

test('profilo, preferenze e idee salvate restano associati all’account', async () => {
  const me = await call<{ profile: { email: string } }>('GET', '/me', undefined, 'token-giulia');
  assert.equal(me.data.profile.email, 'giulia@example.com');
  const updated = await call<{ firstName: string; interests: string[] }>('PATCH', '/me', { firstName: 'Giulia', interests: ['Arte', 'Arte', ' Cibo '] }, 'token-giulia');
  assert.deepEqual([updated.data.firstName, updated.data.interests], ['Giulia', ['Arte', 'Cibo']]);
  const prefs = await call<{ theme: string }>('PUT', '/me/preferences', { theme: 'dark' }, 'token-giulia');
  assert.equal(prefs.data.theme, 'dark');
  assert.equal((await call('PUT', '/me/saved-ideas/amalfi', undefined, 'token-giulia')).status, 204);
  const ideas = await call<string[]>('GET', '/me/saved-ideas', undefined, 'token-giulia');
  assert.deepEqual(ideas.data, ['amalfi']);
});

test('l’eliminazione dell’account richiede una conferma esplicita', async () => {
  const token = 'token-temporaneo';
  db.addUser(token);
  assert.equal((await call('DELETE', '/me', { confirm: 'sì' }, token)).status, 400);
  assert.equal((await call('DELETE', '/me', { confirm: 'ELIMINA' }, token)).status, 204);
  assert.equal((await call('GET', '/me', undefined, token)).status, 401);
});

test('il modulo incompleto restituisce un errore leggibile', async () => {
  const { status, data } = await call<{ error: string }>('POST', '/itineraries/generate', { form: { ...FALLBACK_TRIP_FORM, destination: '' } });
  assert.equal(status, 422);
  assert.equal(data.error, 'Inserisci una destinazione.');
});

test('senza chiave GraphHopper il percorso a piedi arriva gratis da OSRM (OpenStreetMap)', async () => {
  const node = { id: 'a', label: 'A', type: 'activity', latitude: 41.9, longitude: 12.5, geoStatus: 'CONFIRMED' };
  const { status, data } = await call<{ patch: { provider: string; duration: string; distance: string } }>('POST', '/routes/calculate', { segment: { recommendedMode: 'a piedi', origin: node, destination: { ...node, id: 'b', latitude: 41.91, longitude: 12.51 } } });
  assert.equal(status, 200);
  assert.deepEqual([data.patch.provider, data.patch.duration, data.patch.distance], ['OSRM', '18 min', '1.3 km']);
  assert.match(osmCalls.at(-1)!, /routed-foot/);
  // Un mezzo non calcolabile online resta manuale.
  const bus = await call<{ error: string }>('POST', '/routes/calculate', { segment: { recommendedMode: 'autobus', origin: node, destination: { ...node, id: 'b' } } });
  assert.equal(bus.status, 422);
});

// ---------------------------------------------------------------------------
// Viaggi pubblicati dai coordinatori
// ---------------------------------------------------------------------------

test('percorso completo: il coordinatore pubblica, un viaggiatore trova, salva e usa come base', async () => {
  const coordinatorToken = 'token-coordinatrice';
  const coordinatorId = db.addUser(coordinatorToken, undefined, 'anna@example.com');
  const travelerToken = 'token-viaggiatore';
  db.addUser(travelerToken);

  // Un viaggiatore non accede all'area coordinatore (C-01).
  assert.equal((await call('GET', '/coordinator/trips', undefined, travelerToken)).status, 403);

  // L'amministratore attiva il ruolo (C-03); prima di pubblicare servono le linee guida (C-04).
  Object.assign(db.user(coordinatorId).profile, { role: 'coordinator', firstName: 'Anna', lastName: 'Verdi' });
  assert.equal((await call('GET', '/coordinator/trips', undefined, coordinatorToken)).status, 428);
  assert.equal((await call('POST', '/coordinator/guidelines', {}, coordinatorToken)).status, 204);

  const generated = await call<Itinerary>('POST', '/itineraries/generate', { form: { ...FALLBACK_TRIP_FORM, destination: 'Napoli' } });
  const own = await call<Trip>('POST', '/trips', { itinerary: generated.data }, coordinatorToken);
  const year = new Date().getFullYear() + 1;
  const created = await call<{ id: string; status: string; destination: string }>('POST', '/coordinator/trips', {
    sourceTripId: own.data.id, title: 'Napoli in piccolo gruppo', price: 690, capacity: 10, included: ['Alloggio'], excluded: ['Voli'],
  }, coordinatorToken);
  assert.equal(created.status, 201);
  assert.equal(created.data.status, 'draft');
  assert.equal(created.data.destination, 'Napoli');

  // Validazioni prima della pubblicazione (C-13).
  const tooEarly = await call<{ error: string }>('POST', `/coordinator/trips/${created.data.id}/publish`, {}, coordinatorToken);
  assert.equal(tooEarly.status, 422);
  await call('PUT', `/coordinator/trips/${created.data.id}`, { summary: 'Quattro giorni tra centro storico, golfo e cucina di quartiere.', startDate: `${year}-04-02`, endDate: `${year}-04-05` }, coordinatorToken);
  const published = await call<{ status: string; priceCents: number }>('POST', `/coordinator/trips/${created.data.id}/publish`, {}, coordinatorToken);
  assert.deepEqual([published.data.status, published.data.priceCents], ['published', 69000]);

  // Il catalogo è pubblico (U-01) e mostra il coordinatore come "Anna V." (U-04).
  const catalog = await call<Array<{ id: string; coordinator: { displayName: string } }>>('GET', '/catalog/trips?q=napoli');
  assert.equal(catalog.data.length, 1);
  assert.equal(catalog.data[0].coordinator.displayName, 'Anna V.');
  const detail = await call<{ included: string[]; itinerary: Itinerary }>('GET', `/catalog/trips/${created.data.id}`);
  assert.deepEqual(detail.data.included, ['Alloggio']);
  assert.ok(detail.data.itinerary.days.length > 0);

  // Salvare richiede l'accesso; il salvataggio resta collegato all'originale (U-08).
  assert.equal((await call('PUT', `/me/saved-trips/${created.data.id}`)).status, 401);
  assert.equal((await call('PUT', `/me/saved-trips/${created.data.id}`, undefined, travelerToken)).status, 204);
  const saved = await call<Array<{ id: string }>>('GET', '/me/saved-trips', undefined, travelerToken);
  assert.deepEqual(saved.data.map((trip) => trip.id), [created.data.id]);

  // "Usa come base" crea una copia modificabile tra i propri viaggi (U-21).
  const copy = await call<Trip>('POST', `/catalog/trips/${created.data.id}/copy`, {}, travelerToken);
  assert.equal(copy.status, 201);
  assert.equal(copy.data.title, 'Napoli in piccolo gruppo');
  const versions = await call<Array<{ changeKind: string }>>('GET', `/trips/${copy.data.id}/versions`, undefined, travelerToken);
  assert.deepEqual(versions.data.map((item) => item.changeKind), ['copied']);

  // Tornato in bozza, il viaggio sparisce dal catalogo.
  await call('POST', `/coordinator/trips/${created.data.id}/unpublish`, {}, coordinatorToken);
  assert.equal((await call('GET', `/catalog/trips/${created.data.id}`)).status, 404);
});

test('partecipazione: richiesta, conferma del coordinatore nel limite dei posti, ritiro (U-14, U-16, C-15)', async () => {
  const coordinatorToken = 'token-guida';
  const coordinatorId = db.addUser(coordinatorToken, undefined, 'guida@example.com');
  Object.assign(db.user(coordinatorId).profile, { role: 'coordinator', firstName: 'Elena', lastName: 'Riva' });
  await call('POST', '/coordinator/guidelines', {}, coordinatorToken);
  const first = 'token-primo';
  const second = 'token-secondo';
  Object.assign(db.user(db.addUser(first, undefined, 'primo@example.com')).profile, { firstName: 'Paolo', lastName: 'Bruni' });
  db.addUser(second, undefined, 'secondo@example.com');

  const generated = await call<Itinerary>('POST', '/itineraries/generate', { form: { ...FALLBACK_TRIP_FORM, destination: 'Torino' } });
  const own = await call<Trip>('POST', '/trips', { itinerary: generated.data }, coordinatorToken);
  const year = new Date().getFullYear() + 1;
  const created = await call<{ id: string }>('POST', '/coordinator/trips', {
    sourceTripId: own.data.id, title: 'Torino a passo lento', price: 320, capacity: 1,
    summary: 'Tre giorni tra portici, caffè storici e colline, in piccolo gruppo.', startDate: `${year}-03-06`, endDate: `${year}-03-08`,
  }, coordinatorToken);
  const id = created.data.id;

  // Finché è una bozza il viaggio non si prenota; servono comunque accesso e pubblicazione.
  assert.equal((await call('POST', `/bookings/trips/${id}`, {}, first)).status, 404);
  await call('POST', `/coordinator/trips/${id}/publish`, {}, coordinatorToken);
  assert.equal((await call('POST', `/bookings/trips/${id}`, {})).status, 401);
  assert.equal((await call('POST', `/bookings/trips/${id}`, {}, coordinatorToken)).status, 422);

  // Blocca il posto (TB-08): riserva con timer e importi decisi dal server.
  type Booking = { id: string; status: string; seatNumber: number; depositCents: number; priceCents: number; reservedUntil?: string; trip: { title: string }; payments: Array<{ status: string }> };
  const reserved = await call<Booking>('POST', `/bookings/trips/${id}`, {}, first);
  assert.equal(reserved.status, 201);
  assert.deepEqual([reserved.data.status, reserved.data.seatNumber, reserved.data.depositCents, reserved.data.trip.title], ['reserved', 1, 8000, 'Torino a passo lento']);
  assert.ok(Date.parse(reserved.data.reservedUntil!) > Date.now() + 14 * 60_000);
  assert.equal((await call<Booking>('POST', `/bookings/trips/${id}`, {}, first)).data.id, reserved.data.id, 'una sola prenotazione per viaggio');
  assert.equal((await call('POST', `/bookings/trips/${id}`, {}, second)).status, 422, 'il posto riservato conta tra i posti occupati');
  assert.equal((await call('GET', `/bookings/${reserved.data.id}`, undefined, second)).status, 404);

  // Checkout (TB-09): servono le condizioni; la conferma arriva dal fornitore, non dal client.
  assert.equal((await call('POST', `/bookings/${reserved.data.id}/payments`, { kind: 'deposit' }, first)).status, 422);
  const payment = await call<{ status: string; amountCents: number }>('POST', `/bookings/${reserved.data.id}/payments`, { kind: 'deposit', method: 'card', acceptTerms: true }, first);
  assert.deepEqual([payment.status, payment.data.status, payment.data.amountCents], [202, 'processing', 8000]);
  const paid = await waitFor(() => call<Booking>('GET', `/bookings/${reserved.data.id}`, undefined, first), (booking) => booking.data.status === 'pending');
  assert.equal(paid.data.payments[0].status, 'confirmed');

  // Prossimo viaggio (TB-10) e area personale mostrano la richiesta inviata.
  const next = await call<Booking>('GET', '/me/next-trip', undefined, first);
  assert.deepEqual([next.data.status, next.data.trip.title], ['pending', 'Torino a passo lento']);
  assert.equal((await call('GET', '/me/next-trip', undefined, second)).data, null);
  const mine = await call<Array<{ status: string; trip: { title: string } }>>('GET', '/me/participations', undefined, first);
  assert.deepEqual(mine.data.map((item) => [item.status, item.trip.title]), [['pending', 'Torino a passo lento']]);

  // Il coordinatore vede solo le richieste con acconto pagato; il contatto dopo la conferma (CB-08).
  assert.equal((await call('GET', `/coordinator/trips/${id}/participants`, undefined, first)).status, 403);
  const before = await call<Array<{ firstName: string; email?: string; depositCents: number }>>('GET', `/coordinator/trips/${id}/participants`, undefined, coordinatorToken);
  assert.deepEqual(before.data.map((item) => [item.firstName, item.email, item.depositCents]), [['Paolo', undefined, 8000]]);
  const list = await call<Array<{ id: string; requests: { pending: number; confirmed: number } }>>('GET', '/coordinator/trips', undefined, coordinatorToken);
  assert.deepEqual(list.data.find((trip) => trip.id === id)?.requests, { pending: 1, confirmed: 0, balanceDue: 0 });

  // Il saldo si paga solo dopo la conferma del coordinatore.
  assert.equal((await call('POST', `/bookings/${reserved.data.id}/payments`, { kind: 'balance' }, first)).status, 422);
  const confirmed = await call<{ status: string }>('POST', `/coordinator/trips/${id}/participants/${reserved.data.id}/confirm`, {}, coordinatorToken);
  assert.equal(confirmed.data.status, 'confirmed');
  const after = await call<Array<{ email?: string }>>('GET', `/coordinator/trips/${id}/participants`, undefined, coordinatorToken);
  assert.equal(after.data[0].email, 'primo@example.com');
  assert.equal((await call<{ seatsLeft: number; participants: string[] }>('GET', `/catalog/trips/${id}`)).data.seatsLeft, 0);
  assert.deepEqual((await call<{ participants: string[] }>('GET', `/catalog/trips/${id}`)).data.participants, ['PB']);

  const balance = await call<{ amountCents: number }>('POST', `/bookings/${reserved.data.id}/payments`, { kind: 'balance' }, first);
  assert.equal(balance.data.amountCents, 24000, 'saldo = quota meno acconto');
  await waitFor(() => call<Booking>('GET', `/bookings/${reserved.data.id}`, undefined, first), (booking) => booking.data.status === 'balance_paid');

  // Chi non può prenotare (un'agenzia) riceve l'invito all'upgrade, non un errore generico.
  const agencyToken = 'token-agenzia';
  Object.assign(db.user(db.addUser(agencyToken)).profile, { role: 'agency' });
  const blocked = await call<{ code: string }>('POST', `/bookings/trips/${id}`, {}, agencyToken);
  assert.deepEqual([blocked.status, blocked.data.code], [403, 'upgrade_required']);
});

test('candidatura a coordinatore: requisiti, revisione dell’amministratore e attivazione del ruolo (C-01, C-02, G-01)', async () => {
  const candidate = 'token-candidata';
  const candidateId = db.addUser(candidate, undefined, 'candidata@example.com');
  const adminToken = 'token-admin';
  Object.assign(db.user(db.addUser(adminToken, undefined, 'admin@example.com')).profile, { role: 'admin' });
  const body = {
    motivation: 'Organizzo da anni viaggi lenti per piccoli gruppi e vorrei farlo con Odys.',
    experience: 'Dieci viaggi di gruppo tra Italia e Portogallo.', tripsLed: 10, languages: ['Italiano', 'Inglese'], links: ['https://example.com/profilo'], acceptGuidelines: true,
  };

  // Servono le linee guida, un testo sensato e un profilo completo.
  assert.equal((await call('POST', '/coordinator/application', { ...body, acceptGuidelines: false }, candidate)).status, 422);
  assert.equal((await call('POST', '/coordinator/application', { ...body, motivation: 'Mi piace viaggiare' }, candidate)).status, 422);
  const incomplete = await call<{ error: string }>('POST', '/coordinator/application', body, candidate);
  assert.equal(incomplete.status, 422);
  assert.match(incomplete.data.error, /Completa il profilo/);
  await call('PATCH', '/me', { firstName: 'Marta', lastName: 'Sala', bio: 'Viaggio da sempre con lo zaino e amo far scoprire i luoghi con calma.' }, candidate);

  const sent = await call<{ id: string; status: string }>('POST', '/coordinator/application', body, candidate);
  assert.deepEqual([sent.status, sent.data.status], [201, 'pending']);
  assert.equal((await call('POST', '/coordinator/application', body, candidate)).status, 409);
  // La candidatura non abilita da sola (C-01).
  const waiting = await call<{ isCoordinator: boolean; application: { status: string; adminNote?: string } }>('GET', '/coordinator/status', undefined, candidate);
  assert.deepEqual([waiting.data.isCoordinator, waiting.data.application.status], [false, 'pending']);
  assert.equal((await call('GET', '/coordinator/trips', undefined, candidate)).status, 403);

  // Solo l'amministratore vede e valuta le candidature (G-01).
  assert.equal((await call('GET', '/admin/applications', undefined, candidate)).status, 403);
  assert.equal((await call('POST', `/admin/applications/${sent.data.id}/approve`, {}, candidate)).status, 403);
  const queue = await call<Array<{ id: string; firstName: string; email: string }>>('GET', '/admin/applications?status=pending', undefined, adminToken);
  assert.deepEqual(queue.data.map((item) => [item.firstName, item.email]), [['Marta', 'candidata@example.com']]);
  const approved = await call<{ status: string; adminNote: string }>('POST', `/admin/applications/${sent.data.id}/approve`, { adminNote: 'Referenze verificate', reviewerMessage: 'Benvenuta!' }, adminToken);
  assert.deepEqual([approved.data.status, approved.data.adminNote], ['approved', 'Referenze verificate']);
  assert.equal((await call('POST', `/admin/applications/${sent.data.id}/reject`, {}, adminToken)).status, 422);

  // Ruolo attivo, linee guida già accettate con la candidatura (C-04): l'area coordinatore si apre.
  assert.equal(db.user(candidateId).profile.role, 'coordinator');
  const status = await call<{ isCoordinator: boolean; guidelinesAccepted: boolean }>('GET', '/coordinator/status', undefined, candidate);
  assert.deepEqual(status.data, { isCoordinator: true, guidelinesAccepted: true, guidelinesVersion: 'linee-guida-2026-10', application: null });
  assert.equal((await call('GET', '/coordinator/trips', undefined, candidate)).status, 200);
  // Feed profilo (CB-09): lingue della candidatura e badge verificato.
  const profile = await call<{ coordinator: { verified: boolean; languages: string[] } }>('GET', `/catalog/coordinators/${candidateId}`);
  assert.deepEqual([profile.data.coordinator.verified, profile.data.coordinator.languages], [true, ['Italiano', 'Inglese']]);
});

test('suggerimenti OpenStreetMap: pubblici, con attribuzione e messi in cache', async () => {
  const first = await call<{ suggestions: Array<{ label: string; osmId: string; geoStatus: string }>; attribution: string }>('GET', '/geo/suggest?q=Lisbo&kind=place');
  assert.equal(first.status, 200);
  assert.deepEqual(first.data.suggestions.map((item) => [item.label, item.osmId, item.geoStatus]), [['Lisbon, Portogallo', 'relation/5400890', 'CONFIRMED']]);
  assert.match(first.data.attribution, /OpenStreetMap/);
  const calls = osmCalls.length;
  await call('GET', '/geo/suggest?q=lisbo&kind=place');
  assert.equal(osmCalls.length, calls, 'la stessa ricerca non interroga di nuovo OpenStreetMap');
  const tooShort = await call<{ suggestions: unknown[] }>('GET', '/geo/suggest?q=L');
  assert.deepEqual(tooShort.data.suggestions, []);
});

test('Creator Studio: bozza privata, media, pubblicazione, feed, like e salvataggi (C-19…C-29, U-05, U-19…U-21)', async () => {
  const author = 'token-creator';
  const authorId = db.addUser(author, undefined, 'creator@example.com');
  Object.assign(db.user(authorId).profile, { role: 'coordinator', firstName: 'Livia', lastName: 'Monti' });
  const fan = 'token-fan';
  db.addUser(fan, undefined, 'fan@example.com');

  // Riservato ai coordinatori che hanno accettato le linee guida.
  assert.equal((await call('GET', '/studio/posts', undefined, fan)).status, 403);
  assert.equal((await call('GET', '/studio/posts', undefined, author)).status, 428);
  await call('POST', '/coordinator/guidelines', {}, author);

  const draft = await call<{ id: string; status: string; media: unknown[] }>('POST', '/studio/posts', { caption: 'Tramonto sul Tago', location: { label: 'Lisbon, Portogallo', latitude: 38.7, longitude: -9.1, osmId: 'relation/5400890' } }, author);
  assert.deepEqual([draft.status, draft.data.status], [201, 'draft']);
  const id = draft.data.id;

  // La bozza è privata (S-02, C-21) e non si pubblica senza media e senza diritti (C-23, M-05).
  assert.equal((await call('GET', `/posts/${id}`)).status, 404);
  assert.match((await call<{ error: string }>('POST', `/studio/posts/${id}/publish`, {}, author)).data.error, /almeno una foto/);
  assert.equal((await call('POST', `/studio/posts/${id}/media`, { mimeType: 'application/pdf', sizeBytes: 10 }, author)).status, 422);
  assert.equal((await call('POST', `/studio/posts/${id}/media`, { mimeType: 'video/mp4', sizeBytes: 1000, durationMs: 90_000 }, author)).status, 422);
  const photo = await call<{ id: string; originalKey: string; displayKey: string; thumbnailKey: string; status: string }>('POST', `/studio/posts/${id}/media`, { mimeType: 'image/jpeg', sizeBytes: 2_000_000, width: 3000, height: 4000, extension: 'jpg' }, author);
  assert.equal(photo.data.status, 'uploading');
  assert.ok(photo.data.originalKey.startsWith(`${authorId}/${id}/`), 'i file stanno nella cartella dell’autore e del post');
  assert.match((await call<{ error: string }>('POST', `/studio/posts/${id}/publish`, {}, author)).data.error, /caricamento/);
  await call('PATCH', `/studio/posts/${id}/media/${photo.data.id}`, { status: 'ready' }, author);
  assert.match((await call<{ error: string }>('POST', `/studio/posts/${id}/publish`, {}, author)).data.error, /diritti/);
  await call('PATCH', `/studio/posts/${id}`, { rightsConfirmed: true }, author);
  assert.equal((await call('PATCH', `/studio/posts/${id}`, { linkAccess: 'paid' }, author)).status, 422);

  // Programmazione (C-22): resta privato fino all'ora indicata.
  assert.equal((await call('POST', `/studio/posts/${id}/schedule`, { scheduledFor: new Date(Date.now() - 60_000).toISOString() }, author)).status, 422);
  const scheduled = await call<{ status: string; scheduledFor: string }>('POST', `/studio/posts/${id}/schedule`, { scheduledFor: new Date(Date.now() + 3_600_000).toISOString() }, author);
  assert.equal(scheduled.data.status, 'scheduled');
  assert.equal((await call('GET', `/posts/${id}`)).status, 404);

  // Pubblicazione immediata (C-23): compare nel feed pubblico con URL firmati e autore (U-05, U-19).
  const published = await call<{ status: string; publishedAt: string }>('POST', `/studio/posts/${id}/publish`, {}, author);
  assert.equal(published.data.status, 'published');
  assert.ok(published.data.publishedAt);
  const feed = await call<Array<{ id: string; author: { displayName: string }; media: Array<{ urls: { display: string; thumbnail: string } }>; likes: number }>>('GET', '/posts');
  const item = feed.data.find((post) => post.id === id)!;
  assert.equal(item.author.displayName, 'Livia M.');
  assert.match(item.media[0].urls.display, /display\.webp$/);
  assert.match(item.media[0].urls.thumbnail, /thumbnail\.webp$/);

  // Like e salvataggi solo con l'accesso (U-20); il contatore è pubblico.
  assert.equal((await call('PUT', `/posts/${id}/like`)).status, 401);
  assert.equal((await call('PUT', `/posts/${id}/like`, undefined, fan)).status, 204);
  assert.equal((await call('PUT', `/posts/${id}/save`, undefined, fan)).status, 204);
  const seen = await call<{ likes: number; liked: boolean; saved: boolean }>('GET', `/posts/${id}`, undefined, fan);
  assert.deepEqual([seen.data.likes, seen.data.liked, seen.data.saved], [1, true, true]);
  assert.equal((await call<{ likes: number }>('GET', `/posts/${id}`)).data.likes, 1);
  const saved = await call<Array<{ id: string }>>('GET', '/posts/saved', undefined, fan);
  assert.deepEqual(saved.data.map((post) => post.id), [id]);

  // Media modificabili solo in bozza; eliminando un media si cancellano i file (M-04).
  assert.equal((await call('DELETE', `/studio/posts/${id}/media/${photo.data.id}`, undefined, author)).status, 422);
  await call('POST', `/studio/posts/${id}/unpublish`, {}, author);
  assert.equal((await call('GET', `/posts/${id}`)).status, 404);
  assert.equal((await call('DELETE', `/studio/posts/${id}/media/${photo.data.id}`, undefined, author)).status, 204);
  assert.ok(db.creator.removedKeys.includes(photo.data.originalKey));

  // Eliminazione morbida: esce da ogni vista.
  assert.equal((await call('DELETE', `/studio/posts/${id}`, undefined, author)).status, 204);
  assert.equal((await call<unknown[]>('GET', '/studio/posts', undefined, author)).data.length, 0);
});

test('moderazione: segnalazione, coda dell’amministratore, rimozione del contenuto e sospensione (S-07, G-02…G-04)', async () => {
  const owner = 'token-autrice';
  const ownerId = db.addUser(owner, undefined, 'autrice@example.com');
  Object.assign(db.user(ownerId).profile, { role: 'coordinator', firstName: 'Nora', lastName: 'Gatti' });
  await call('POST', '/coordinator/guidelines', {}, owner);
  const reporter = 'token-segnalante';
  db.addUser(reporter, undefined, 'segnalante@example.com');
  const adminToken = 'token-moderatore';
  const adminId = db.addUser(adminToken, undefined, 'moderatore@example.com');
  Object.assign(db.user(adminId).profile, { role: 'admin' });

  const post = await call<{ id: string }>('POST', '/studio/posts', { caption: 'Spam sospetto', rightsConfirmed: true }, owner);
  const media = await call<{ id: string }>('POST', `/studio/posts/${post.data.id}/media`, { mimeType: 'image/jpeg', sizeBytes: 1000, extension: 'jpg' }, owner);
  await call('PATCH', `/studio/posts/${post.data.id}/media/${media.data.id}`, { status: 'ready' }, owner);
  await call('POST', `/studio/posts/${post.data.id}/publish`, {}, owner);

  // Segnalare richiede l'accesso, un motivo valido e un contenuto visibile.
  assert.equal((await call('POST', '/reports', { targetKind: 'post', targetId: post.data.id, reason: 'spam' })).status, 401);
  assert.equal((await call('POST', '/reports', { targetKind: 'post', targetId: post.data.id, reason: 'boh' }, reporter)).status, 422);
  assert.equal((await call('POST', '/reports', { targetKind: 'post', targetId: post.data.id, reason: 'other' }, reporter)).status, 422);
  const report = await call<{ id: string; status: string }>('POST', '/reports', { targetKind: 'post', targetId: post.data.id, reason: 'spam', details: 'Link pubblicitari' }, reporter);
  assert.deepEqual([report.status, report.data.status], [201, 'open']);
  assert.equal((await call('POST', '/reports', { targetKind: 'post', targetId: post.data.id, reason: 'spam' }, reporter)).status, 409);

  // Solo l'amministratore vede la coda e decide (G-04).
  assert.equal((await call('GET', '/admin/reports', undefined, reporter)).status, 403);
  const queue = await call<Array<{ id: string; reportsOnTarget: number }>>('GET', '/admin/reports?status=open', undefined, adminToken);
  assert.equal(queue.data.find((item) => item.id === report.data.id)?.reportsOnTarget, 1);
  const resolved = await call<{ status: string; actionTaken: string }>('POST', `/admin/reports/${report.data.id}/resolve`, { action: 'hidden', note: 'Contenuto promozionale' }, adminToken);
  assert.deepEqual([resolved.data.status, resolved.data.actionTaken], ['resolved', 'hidden']);
  assert.equal((await call('GET', `/posts/${post.data.id}`)).status, 404, 'il post rimosso esce dal feed');
  assert.equal((await call('POST', `/admin/reports/${report.data.id}/resolve`, { action: 'dismiss' }, adminToken)).status, 422);

  // Gestione account (G-02): sospensione con traccia; un amministratore non modifica sé stesso.
  const accounts = await call<Array<{ id: string; email: string }>>('GET', '/admin/accounts?q=autrice', undefined, adminToken);
  assert.deepEqual(accounts.data.map((item) => item.email), ['autrice@example.com']);
  const suspended = await call<{ status: string }>('PATCH', `/admin/accounts/${ownerId}`, { status: 'suspended', note: 'Spam ripetuto' }, adminToken);
  assert.equal(suspended.data.status, 'suspended');
  assert.equal((await call('PATCH', `/admin/accounts/${adminId}`, { role: 'traveler' }, adminToken)).status, 422);
  assert.equal((await call('PATCH', `/admin/accounts/${ownerId}`, { role: 'superuser' }, adminToken)).status, 400);
});

test('piani e diritti: il server dice cosa è sbloccato e solo l’amministratore assegna un piano (TP-10)', async () => {
  const token = 'token-piani';
  const id = db.addUser(token, undefined, 'piani@example.com');
  const adminToken = 'token-admin-piani';
  Object.assign(db.user(db.addUser(adminToken, undefined, 'admin.piani@example.com')).profile, { role: 'admin' });

  assert.equal((await call('GET', '/me/entitlements')).status, 401);
  const base = await call<{ plan: string; planLabel: string; entitlements: string[] }>('GET', '/me/entitlements', undefined, token);
  assert.deepEqual(base.data, { plan: 'traveller_base', planLabel: 'Traveller Base', entitlements: ['trips.book'] });

  assert.equal((await call('PUT', `/admin/accounts/${id}/plan`, { plan: 'traveller_premium' }, token)).status, 403);
  assert.equal((await call('PUT', `/admin/accounts/${id}/plan`, { plan: 'oro' }, adminToken)).status, 400);
  const updated = await call<{ plan: string }>('PUT', `/admin/accounts/${id}/plan`, { plan: 'traveller_premium' }, adminToken);
  assert.equal(updated.data.plan, 'traveller_premium');
  const premium = await call<{ plan: string; entitlements: string[] }>('GET', '/me/entitlements', undefined, token);
  assert.ok(premium.data.entitlements.includes('ai.generate') && premium.data.entitlements.includes('split.use'));

  const revoked = await call<{ plan: string }>('PUT', `/admin/accounts/${id}/plan`, { plan: null }, adminToken);
  assert.equal(revoked.data.plan, 'traveller_base');
  assert.ok((await call<{ entitlements: string[] }>('GET', '/me/entitlements', undefined, adminToken)).data.entitlements.includes('admin.moderate'));
});

test('catalogo del Traveller: ricerca per intento, filtri, affinità, posti liberi e visibilità (TB-02…TB-05, CB-05)', async () => {
  const coordinatorToken = 'token-catalogo-coord';
  const coordinatorId = db.addUser(coordinatorToken, undefined, 'giada@example.com');
  Object.assign(db.user(coordinatorId).profile, { role: 'coordinator', firstName: 'Giada', lastName: 'Lombardi' });
  await call('POST', '/coordinator/guidelines', {}, coordinatorToken);
  const travelerToken = 'token-catalogo-viaggiatrice';
  const travelerId = db.addUser(travelerToken, undefined, 'giulia.catalogo@example.com');
  db.user(travelerId).profile.interests = ['Rovine', 'Mare'];

  const generated = await call<Itinerary>('POST', '/itineraries/generate', { form: { ...FALLBACK_TRIP_FORM, destination: 'Mérida' } });
  const own = await call<Trip>('POST', '/trips', { itinerary: generated.data }, coordinatorToken);
  const year = new Date().getFullYear() + 1;
  const publish = async (form: Record<string, unknown>) => {
    const created = await call<{ id: string }>('POST', '/coordinator/trips', { sourceTripId: own.data.id, summary: 'Un viaggio di prova per il catalogo di Odys.', price: 1680, capacity: 12, ...form }, coordinatorToken);
    assert.equal(created.status, 201);
    const published = await call<{ status: string; depositCents: number; balanceDueDate: string }>('POST', `/coordinator/trips/${created.data.id}/publish`, {}, coordinatorToken);
    assert.equal(published.data.status, 'published');
    return { id: created.data.id, ...published.data };
  };

  // Il limite di 12 posti vale anche lato API; l'acconto non supera la quota.
  assert.equal((await call('POST', '/coordinator/trips', { sourceTripId: own.data.id, title: 'Troppi', capacity: 13 }, coordinatorToken)).status, 400);
  const yucatan = await publish({ title: 'Yucatán', destination: 'Mérida', region: 'Yucatán', country: 'Messico', interests: ['Rovine', 'Mare', 'Cibo', 'Avventura'], startDate: `${year}-04-04`, endDate: `${year}-04-12`, deposit: 400, ageMin: 27, ageMax: 36 });
  assert.equal(yucatan.depositCents, 40000);
  assert.equal((await call('PUT', `/coordinator/trips/${yucatan.id}`, { deposit: 5000 }, coordinatorToken)).status, 422);
  const oaxaca = await publish({ title: 'CDMX + Oaxaca', destination: 'Oaxaca', country: 'Messico', interests: ['Cibo', 'Città'], startDate: `${year}-05-10`, endDate: `${year}-05-17`, price: 1490 });
  assert.equal(oaxaca.depositCents, 37000, 'senza acconto indicato vale il valore provvisorio: un quarto della quota');
  await publish({ title: 'Guatemala maya', destination: 'Antigua', country: 'Guatemala', interests: ['Rovine', 'Natura'], startDate: `${year}-06-01`, endDate: `${year}-06-03`, price: 900 });
  const followersOnly = await publish({ title: 'Baja per chi mi segue', destination: 'La Paz', country: 'Messico', interests: ['Mare'], startDate: `${year}-07-01`, endDate: `${year}-07-08`, visibility: 'followers' });

  // Suggerimenti con il numero di viaggi, senza accenti né maiuscole (TB-02).
  const suggest = await call<Array<{ kind: string; label: string; trips: number }>>('GET', '/catalog/suggest?q=mess');
  assert.deepEqual(suggest.data, [{ kind: 'country', label: 'Messico', trips: 2 }]);
  const byCountry = await call<Array<{ id: string; title: string; affinity?: unknown }>>('GET', '/catalog/trips?q=messico');
  assert.deepEqual(byCountry.data.map((trip) => trip.title).sort(), ['CDMX + Oaxaca', 'Yucatán']);
  assert.equal(byCountry.data[0].affinity, undefined, 'senza accesso non c’è affinità');
  const similar = await call<Array<{ label: string; trips: number }>>('GET', '/catalog/similar?q=messico');
  assert.deepEqual(similar.data, [{ label: 'Guatemala', trips: 1 }]);

  // Con l'accesso: affinità sugli interessi e ordinamento predefinito per affinità (TB-03, TB-04).
  const forGiulia = await call<Array<{ title: string; affinity?: { percent: number; explanation: string }; seatsLeft: number }>>('GET', '/catalog/trips?q=messico', undefined, travelerToken);
  assert.deepEqual(forGiulia.data.map((trip) => [trip.title, trip.affinity?.percent]), [['Yucatán', 50], ['CDMX + Oaxaca', 0]]);
  assert.equal(forGiulia.data[0].affinity?.explanation, 'Rovine e mare: i tuoi interessi');
  assert.equal(forGiulia.data[0].seatsLeft, 12);

  // Filtri: interessi, mese, durata, budget (TB-03).
  const titles = async (query: string) => (await call<Array<{ title: string }>>('GET', `/catalog/trips?coordinator=${coordinatorId}&${query}`)).data.map((trip) => trip.title).sort();
  assert.deepEqual(await titles('interests=Natura,Città'), ['CDMX + Oaxaca', 'Guatemala maya']);
  assert.deepEqual(await titles('month=4'), ['Yucatán']);
  assert.deepEqual(await titles('maxDays=3'), ['Guatemala maya']);
  assert.deepEqual(await titles('minDays=9'), ['Yucatán']);
  assert.deepEqual(await titles('maxPrice=1000'), ['Guatemala maya']);

  // «Solo follower» (CB-05): fuori dal catalogo per chi non segue il coordinatore.
  assert.equal((await call('GET', `/catalog/trips/${followersOnly.id}`, undefined, travelerToken)).status, 404);
  db.follows.set(travelerId, new Set([coordinatorId]));
  assert.equal((await call('GET', `/catalog/trips/${followersOnly.id}`, undefined, travelerToken)).status, 200);
  assert.equal((await call('GET', `/catalog/trips/${followersOnly.id}`)).status, 404);

  // Eventi lato server (CP-05): una visualizzazione al giorno per utente, il salvataggio una volta sola.
  await call('GET', `/catalog/trips/${yucatan.id}`, undefined, travelerToken);
  await call('GET', `/catalog/trips/${yucatan.id}`, undefined, travelerToken);
  await call('GET', `/catalog/trips/${yucatan.id}`, undefined, coordinatorToken);
  await call('PUT', `/me/saved-trips/${yucatan.id}`, undefined, travelerToken);
  await call('PUT', `/me/saved-trips/${yucatan.id}`, undefined, travelerToken);
  const events = db.events.filter((event) => event.tripId === yucatan.id).map((event) => event.kind).sort();
  assert.deepEqual(events, ['save', 'view']);
});

test('profilo coordinatore: Segui, recensioni solo dai partecipanti a viaggio concluso (TB-11, TB-12)', async () => {
  const coordinatorToken = 'token-recensioni-coord';
  const coordinatorId = db.addUser(coordinatorToken, undefined, 'marco.rec@example.com');
  Object.assign(db.user(coordinatorId).profile, { role: 'coordinator', firstName: 'Marco', lastName: 'Rinaldi' });
  const travelerToken = 'token-recensioni-giulia';
  const travelerId = db.addUser(travelerToken, undefined, 'giulia.rec@example.com');
  Object.assign(db.user(travelerId).profile, { firstName: 'Giulia', lastName: 'Bianchi' });

  // Viaggio già concluso con Giulia confermata (dati inseriti direttamente nell'archivio).
  const tripId = 'viaggio-concluso-lisbona';
  db.published.set(tripId, {
    id: tripId, coordinatorId, status: 'published', effectiveStatus: 'completed', title: 'Lisbona', summary: 'Fado e tram.', destination: 'Lisbona', country: 'Portogallo', region: '',
    interests: [], visibility: 'public', startDate: '2026-03-12', endDate: '2026-03-17', currency: 'EUR', capacity: 12, priceCents: 89000, included: [], excluded: [],
    itinerary: { days: [] } as unknown as Itinerary, updatedAt: new Date().toISOString(), coordinator: { id: coordinatorId, displayName: 'Marco R.', interests: [] },
  });

  assert.equal((await call('PUT', `/catalog/trips/${tripId}/review`, { coordinatorRating: 5, tripRating: 5 }, travelerToken)).status, 403);
  db.participations.set('partecipazione-lisbona', { id: 'partecipazione-lisbona', tripId, userId: travelerId, status: 'balance_paid', currency: 'EUR', createdAt: '2026-01-10T10:00:00Z' });
  assert.equal((await call('PUT', `/catalog/trips/${tripId}/review`, { coordinatorRating: 7, tripRating: 5 }, travelerToken)).status, 400);
  const saved = await call<{ coordinatorRating: number; body: string }>('PUT', `/catalog/trips/${tripId}/review`, { coordinatorRating: 5, tripRating: 4, body: 'Gruppo perfetto, Marco sa dove portarti a cena.' }, travelerToken);
  assert.deepEqual([saved.status, saved.data.coordinatorRating], [200, 5]);
  assert.equal((await call<{ tripRating: number }>('GET', `/catalog/trips/${tripId}/review`, undefined, travelerToken)).data.tripRating, 4);

  assert.equal((await call('PUT', `/catalog/coordinators/${coordinatorId}/follow`)).status, 401);
  assert.equal((await call('PUT', `/catalog/coordinators/${travelerId}/follow`, {}, coordinatorToken)).status, 404, 'si seguono solo i coordinatori');
  assert.equal((await call('PUT', `/catalog/coordinators/${coordinatorId}/follow`, {}, travelerToken)).status, 204);

  type ProfileView = { coordinator: { rating: number; reviewsCount: number; followers: number; tripsCompleted: number }; reviews: Array<{ authorName: string; body: string }>; following: boolean };
  const profile = await call<ProfileView>('GET', `/catalog/coordinators/${coordinatorId}`, undefined, travelerToken);
  assert.deepEqual([profile.data.coordinator.rating, profile.data.coordinator.reviewsCount, profile.data.coordinator.followers, profile.data.coordinator.tripsCompleted], [5, 1, 1, 1]);
  assert.deepEqual(profile.data.reviews.map((review) => review.authorName), ['Giulia B.']);
  assert.equal(profile.data.following, true);
  assert.equal((await call<ProfileView>('GET', `/catalog/coordinators/${coordinatorId}`)).data.following, false);
  assert.equal((await call('DELETE', `/catalog/coordinators/${coordinatorId}/follow`, undefined, travelerToken)).status, 204);
});

test('Split: cassa comune del gruppo, quote calcolate dal server, solo per chi ha il diritto (TP-09, TP-10)', async () => {
  const coordToken = 'token-split-coord';
  const coordId = db.addUser(coordToken, undefined, 'luca.split@example.com');
  Object.assign(db.user(coordId).profile, { role: 'coordinator', firstName: 'Luca', lastName: 'Testa' });
  const saraToken = 'token-split-sara';
  const saraId = db.addUser(saraToken, undefined, 'sara.split@example.com');
  Object.assign(db.user(saraId).profile, { firstName: 'Sara', lastName: 'Colombo' });
  db.user(saraId).plans = ['traveller_premium'];
  const baseToken = 'token-split-base';
  const baseId = db.addUser(baseToken, undefined, 'base.split@example.com');
  const strangerToken = 'token-split-estraneo';
  db.user(db.addUser(strangerToken)).plans = ['traveller_premium'];

  const tripId = 'viaggio-split-amalfi';
  db.published.set(tripId, {
    id: tripId, coordinatorId: coordId, status: 'published', effectiveStatus: 'published', title: 'Costiera', summary: '', destination: 'Amalfi', country: 'Italia', region: '',
    interests: [], visibility: 'public', startDate: '2027-05-15', endDate: '2027-05-18', currency: 'EUR', capacity: 12, priceCents: 65000, included: [], excluded: [],
    itinerary: { days: [] } as unknown as Itinerary, updatedAt: new Date().toISOString(), coordinator: { id: coordId, displayName: 'Luca T.', interests: [] },
  });
  for (const [id, userId] of [['split-sara', saraId], ['split-base', baseId]]) {
    db.participations.set(id, { id, tripId, userId, status: 'confirmed', currency: 'EUR', createdAt: new Date().toISOString() });
  }

  // TP-10: un Base riceve l'invito all'upgrade; chi non è nel gruppo non vede la cassa.
  assert.equal((await call<{ code: string }>('GET', `/split/${tripId}`, undefined, baseToken)).data.code, 'upgrade_required');
  assert.equal((await call('GET', `/split/${tripId}`, undefined, strangerToken)).status, 403);

  type View = { members: Array<{ userId: string }>; expenses: Array<{ id: string; shares: Array<{ amountCents: number }> }>; summary: { totalCents: number; myBalanceCents: number; transfers: Array<{ from: string; to: string; amountCents: number }> } };
  const groups = await call<Array<{ tripId: string }>>('GET', '/split', undefined, saraToken);
  assert.deepEqual(groups.data.map((group) => group.tripId), [tripId]);
  assert.equal((await call('POST', `/split/${tripId}/expenses`, { description: 'Cena', category: 'food', amount: 10, among: ['sconosciuto'] }, saraToken)).status, 422);
  const dinner = await call<View>('POST', `/split/${tripId}/expenses`, { description: 'Cena da Lucia', category: 'food', amount: '100,00', among: [saraId, coordId, baseId] }, saraToken);
  assert.equal(dinner.status, 201);
  assert.deepEqual(dinner.data.expenses[0].shares.map((share) => share.amountCents), [3334, 3333, 3333]);
  assert.equal(dinner.data.summary.myBalanceCents, 6666);

  const ferry = await call<View>('POST', `/split/${tripId}/expenses`, { description: 'Traghetto', category: 'transport', amount: 30, paidBy: coordId, among: [saraId, coordId] }, coordToken);
  assert.equal(ferry.data.summary.totalCents, 13000);
  const debt = ferry.data.summary.transfers.find((transfer) => transfer.to === saraId && transfer.from === coordId);
  assert.ok(debt, 'Luca deve qualcosa a Sara');

  // «Salda ora»: il rimborso chiude il debito.
  const settled = await call<View>('POST', `/split/${tripId}/settle`, { to: saraId, amount: debt.amountCents / 100 }, coordToken);
  assert.ok(!settled.data.summary.transfers.some((transfer) => transfer.from === coordId));
  assert.equal(settled.data.summary.totalCents, 13000, 'il rimborso non è una spesa');

  // Si elimina solo la propria spesa.
  assert.equal((await call('DELETE', `/split/expenses/${dinner.data.expenses[0].id}`, undefined, coordToken)).status, 403);
  assert.equal((await call('DELETE', `/split/expenses/${dinner.data.expenses[0].id}`, undefined, saraToken)).status, 204);
});

test('generatore di itinerari: solo Premium, rigenera senza salvare, «Salva e accetta» crea il viaggio (TP-01…TP-03, TP-10)', async () => {
  const baseToken = 'token-gen-base';
  db.addUser(baseToken);
  const premiumToken = 'token-gen-premium';
  db.user(db.addUser(premiumToken)).plans = ['traveller_premium'];
  const body = { destination: 'Costiera Amalfitana', dates: { mode: 'flexible', months: [5, 6] }, duration: '3-5', budget: 650, interests: ['Mare', 'Cibo', 'Storia'] };

  const blocked = await call<{ code: string }>('POST', '/generator', body, baseToken);
  assert.deepEqual([blocked.status, blocked.data.code], [403, 'upgrade_required']);
  assert.equal((await call('POST', '/generator', { ...body, destination: '' }, premiumToken)).status, 400);
  assert.equal((await call('POST', '/generator', { ...body, interests: [] }, premiumToken)).status, 400);
  assert.equal((await call('POST', '/generator', { ...body, dates: { mode: 'precise', departure: '2027-05-10', returnDate: '2027-05-01' } }, premiumToken)).status, 422);

  type Generated = { title: string; days: Array<{ title: string; places: string[]; costCents: number }>; totalCents: number; budgetCents: number; itinerary?: unknown };
  const first = await call<Generated>('POST', '/generator', body, premiumToken);
  assert.equal(first.status, 200);
  assert.deepEqual([first.data.title, first.data.days.length, first.data.budgetCents], ['Costiera Amalfitana in 4 giorni', 4, 65000]);
  assert.equal(first.data.itinerary, undefined, 'l’anteprima non porta l’itinerario completo');
  const again = await call<Generated>('POST', '/generator', { ...body, seed: 1 }, premiumToken);
  assert.notDeepEqual(again.data.days.map((day) => day.places), first.data.days.map((day) => day.places));
  const surprise = await call<Generated & { destination: string }>('POST', '/generator', { ...body, destination: '', surprise: true }, premiumToken);
  assert.equal(surprise.data.destination, 'Costiera Amalfitana');

  // Generare non salva; accettare sì.
  assert.equal((await call<Trip[]>('GET', '/trips', undefined, premiumToken)).data.length, 0);
  const accepted = await call<Trip>('POST', '/generator/accept', body, premiumToken);
  assert.equal(accepted.status, 201);
  assert.equal(accepted.data.title, 'Costiera Amalfitana in 4 giorni');
  assert.equal((await call<Trip[]>('GET', '/trips', undefined, premiumToken)).data.length, 1);
});

test('storia dei luoghi: la scrive il coordinatore, la legge chi ha il Premium (TP-08, TP-10)', async () => {
  const coordToken = 'token-storie-coord';
  const coordId = db.addUser(coordToken, undefined, 'storie@example.com');
  Object.assign(db.user(coordId).profile, { role: 'coordinator', firstName: 'Sara', lastName: 'Colombo' });
  await call('POST', '/coordinator/guidelines', {}, coordToken);
  const baseToken = 'token-storie-base';
  db.addUser(baseToken);
  const premiumToken = 'token-storie-premium';
  db.user(db.addUser(premiumToken)).plans = ['traveller_premium'];

  const generated = await call<Itinerary>('POST', '/itineraries/generate', { form: { ...FALLBACK_TRIP_FORM, destination: 'Ravello' } });
  const own = await call<Trip>('POST', '/trips', { itinerary: generated.data }, coordToken);
  const year = new Date().getFullYear() + 1;
  const created = await call<{ id: string }>('POST', '/coordinator/trips', { sourceTripId: own.data.id, title: 'Costiera', summary: 'Quattro giorni tra Amalfi, Ravello e Positano.', price: 650, capacity: 12, startDate: `${year}-05-15`, endDate: `${year}-05-18` }, coordToken);
  const story = { day: 3, title: 'Villa Cimbrone', intro: 'Un viale di glicini che finisce nel vuoto.', body: 'La tenuta nasce nell’XI secolo per una famiglia nobile del borgo.', milestones: [{ when: 'XI secolo', text: 'Tenuta di una famiglia nobile.' }, { when: '1904', text: 'Lord Grimthorpe ridisegna i giardini.' }, { when: 'Oggi', text: 'Hotel con giardino aperto.' }, { when: 'Extra', text: 'Quarta tappa ignorata.' }] };
  assert.equal((await call('PUT', `/coordinator/trips/${created.data.id}`, { placeStories: [{ ...story, body: 'corto' }] }, coordToken)).status, 400);
  const saved = await call<{ placeStories: Array<{ title: string; milestones: unknown[]; source: string }> }>('PUT', `/coordinator/trips/${created.data.id}`, { placeStories: [story] }, coordToken);
  assert.deepEqual([saved.data.placeStories[0].title, saved.data.placeStories[0].milestones.length, saved.data.placeStories[0].source], ['Villa Cimbrone', 3, 'coordinator']);
  await call('POST', `/coordinator/trips/${created.data.id}/publish`, {}, coordToken);

  type Detail = { placeStories?: Array<{ title: string }>; placeStoriesCount: number };
  const anonymous = await call<Detail>('GET', `/catalog/trips/${created.data.id}`);
  assert.deepEqual([anonymous.data.placeStories, anonymous.data.placeStoriesCount], [undefined, 1]);
  assert.equal((await call<Detail>('GET', `/catalog/trips/${created.data.id}`, undefined, baseToken)).data.placeStories, undefined);
  assert.equal((await call<Detail>('GET', `/catalog/trips/${created.data.id}`, undefined, premiumToken)).data.placeStories?.[0].title, 'Villa Cimbrone');
  assert.equal((await call<Detail>('GET', `/catalog/trips/${created.data.id}`, undefined, coordToken)).data.placeStories?.length, 1);
});

test('composizione del prezzo: voci di costo riservate al coordinatore del viaggio (CB-04)', async () => {
  const coordinatorToken = 'token-prezzo-coord';
  Object.assign(db.user(db.addUser(coordinatorToken, undefined, 'prezzo@example.com')).profile, { role: 'coordinator', firstName: 'Nora', lastName: 'Conti' });
  await call('POST', '/coordinator/guidelines', {}, coordinatorToken);
  const otherToken = 'token-prezzo-altro';
  Object.assign(db.user(db.addUser(otherToken, undefined, 'altro-coord@example.com')).profile, { role: 'coordinator' });
  await call('POST', '/coordinator/guidelines', {}, otherToken);

  const generated = await call<Itinerary>('POST', '/itineraries/generate', { form: { ...FALLBACK_TRIP_FORM, destination: 'Matera' } });
  const own = await call<Trip>('POST', '/trips', { itinerary: generated.data }, coordinatorToken);
  const created = await call<{ id: string }>('POST', '/coordinator/trips', { sourceTripId: own.data.id, title: 'Matera e i Sassi', price: 690, capacity: 12 }, coordinatorToken);
  const url = `/coordinator/trips/${created.data.id}/pricing`;

  const empty = await call<{ costs: unknown[]; targetEarningsCents: number | null; serviceRate: number }>('GET', url, undefined, coordinatorToken);
  assert.deepEqual(empty.data.costs, []);
  assert.equal(empty.data.targetEarningsCents, null);
  assert.ok(empty.data.serviceRate > 0 && empty.data.serviceRate < 1);

  const costs = [
    { label: 'Masseria', category: 'alloggi', basis: 'per_person', amountCents: 32000 },
    { label: 'Pulmino', category: 'trasporti', basis: 'group', amountCents: 120000 },
  ];
  const saved = await call<{ costs: Array<{ id: string; label: string }>; targetEarningsCents: number }>('PUT', url, { costs, targetEarningsCents: 150000 }, coordinatorToken);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.costs.length, 2);
  assert.ok(saved.data.costs.every((cost) => cost.id));
  assert.equal((await call<{ costs: unknown[] }>('GET', url, undefined, coordinatorToken)).data.costs.length, 2);

  const invalid = await call<{ error: string }>('PUT', url, { costs: [{ label: 'Pulmino', category: 'trasporti', basis: 'boh', amountCents: 1 }] }, coordinatorToken);
  assert.equal(invalid.status, 400);
  assert.match(invalid.data.error, /per persona o per il gruppo/);
  assert.equal((await call('PUT', url, { costs: [], targetEarningsCents: -5 }, coordinatorToken)).status, 400);

  // Un altro coordinatore non vede né modifica i conti di questo viaggio.
  assert.equal((await call('GET', url, undefined, otherToken)).status, 404);
  assert.equal((await call('PUT', url, { costs: [] }, otherToken)).status, 404);
  assert.equal((await call('GET', url)).status, 401);
});

test('avvisi di «I miei viaggi»: campi mancanti, saldi in sospeso o scaduti, richieste (CB-07)', () => {
  type AlertTrip = Parameters<typeof coordinatorAlerts>[0];
  const draft: AlertTrip = { status: 'draft', effectiveStatus: 'draft', summary: 'Breve', startDate: undefined, endDate: undefined, priceCents: 50000, capacity: 10, interests: [], country: '', balanceDueDate: undefined };
  const [missing] = coordinatorAlerts(draft, { pending: 0, balanceDue: 0 }, '2027-01-10');
  assert.equal(missing.kind, 'missing_fields');
  assert.equal(missing.message, 'Da completare: descrizione, date, paese, interessi');

  const onSale = { ...draft, status: 'published', effectiveStatus: 'published', summary: 'Quattro giorni tra borghi e cantine.', startDate: '2027-03-01', endDate: '2027-03-04', country: 'Italia', interests: ['Cibo'], balanceDueDate: '2027-02-01' } satisfies AlertTrip;
  assert.deepEqual(coordinatorAlerts(onSale, { pending: 0, balanceDue: 0 }, '2027-01-10'), []);
  const due = coordinatorAlerts(onSale, { pending: 2, balanceDue: 3 }, '2027-01-10');
  assert.deepEqual(due.map((alert) => [alert.kind, alert.tone, alert.message]), [
    ['balance_due', 'warning', '3 saldi in sospeso · entro il 01/02/2027'],
    ['requests_pending', 'info', '2 richieste da confermare'],
  ]);
  assert.deepEqual(coordinatorAlerts(onSale, { pending: 0, balanceDue: 1 }, '2027-02-02').map((alert) => [alert.tone, alert.message]), [['danger', '1 saldo scaduto']]);
});

test('viaggio del coordinatore dal generatore e itinerario modificato nell’offerta (CB-02, CB-03)', async () => {
  const coordinatorToken = 'token-itinerario-coord';
  Object.assign(db.user(db.addUser(coordinatorToken, undefined, 'itinerario@example.com')).profile, { role: 'coordinator', firstName: 'Ivo', lastName: 'Sala' });
  await call('POST', '/coordinator/guidelines', {}, coordinatorToken);
  const year = new Date().getFullYear() + 1;
  const generator = { destination: 'Lisbona', surprise: false, dates: { mode: 'precise', departure: `${year}-05-10`, returnDate: `${year}-05-13` }, duration: '3-5', budget: 900, interests: ['Cibo', 'Storia'], seed: 1 };

  const invalid = await call<{ error: string }>('POST', '/coordinator/trips', { generator: { ...generator, interests: [] } }, coordinatorToken);
  assert.equal(invalid.status, 400);
  const created = await call<{ id: string; title: string; sourceTripId?: string; itinerary: Itinerary }>('POST', '/coordinator/trips', { generator, capacity: 10, interests: ['Cibo'] }, coordinatorToken);
  assert.equal(created.status, 201);
  assert.match(created.data.title, /Lisbona/);
  assert.equal(created.data.sourceTripId, undefined);
  assert.equal(created.data.itinerary.days.length, 4);

  // Il coordinatore riordina e rinomina i giorni direttamente nell'offerta.
  const itinerary = structuredClone(created.data.itinerary);
  itinerary.days[0].label = 'Arrivo e Alfama al tramonto';
  const updated = await call<{ itinerary: Itinerary }>('PUT', `/coordinator/trips/${created.data.id}`, { itinerary }, coordinatorToken);
  assert.equal(updated.status, 200);
  assert.equal(updated.data.itinerary.days[0].label, 'Arrivo e Alfama al tramonto');

  itinerary.days[1].activities[0].title = '  ';
  assert.equal((await call('PUT', `/coordinator/trips/${created.data.id}`, { itinerary }, coordinatorToken)).status, 422);
  assert.equal((await call('PUT', `/coordinator/trips/${created.data.id}`, { itinerary: { destination: 'X', days: [] } }, coordinatorToken)).status, 400);

  // Senza il diritto al generatore non si genera (pagina di upgrade, mai un errore generico).
  const traveler = 'token-itinerario-base';
  db.addUser(traveler, undefined, 'base-itinerario@example.com');
  assert.equal((await call('POST', '/coordinator/trips', { generator }, traveler)).status, 403);
});

test('dashboard del Coordinatore Premium: guadagni, funnel, saldi da sollecitare, post che vendono (CP-01…CP-06)', async () => {
  const coach = 'token-dashboard-coord';
  const coachId = db.addUser(coach, undefined, 'dashboard@example.com');
  Object.assign(db.user(coachId).profile, { role: 'coordinator', firstName: 'Dario', lastName: 'Neri' });
  await call('POST', '/coordinator/guidelines', {}, coach);
  const traveler = 'token-dashboard-viaggiatore';
  const travelerId = db.addUser(traveler, undefined, 'dash-viaggio@example.com');
  Object.assign(db.user(travelerId).profile, { firstName: 'Lia', lastName: 'Bassi' });

  // Coordinatore Base: la dashboard porta all'upgrade, non a un errore generico.
  const locked = await call<{ code: string }>('GET', '/coordinator/dashboard', undefined, coach);
  assert.deepEqual([locked.status, locked.data.code], [403, 'upgrade_required']);
  db.user(coachId).plans = ['coordinator_premium'];

  const generated = await call<Itinerary>('POST', '/itineraries/generate', { form: { ...FALLBACK_TRIP_FORM, destination: 'Bologna' } });
  const own = await call<Trip>('POST', '/trips', { itinerary: generated.data }, coach);
  const year = new Date().getFullYear() + 1;
  const trip = (await call<{ id: string }>('POST', '/coordinator/trips', {
    sourceTripId: own.data.id, title: 'Bologna da gustare', price: 400, capacity: 4,
    summary: 'Tre giorni tra portici, mercati e cucina emiliana.', startDate: `${year}-04-10`, endDate: `${year}-04-12`,
  }, coach)).data.id;
  await call('POST', `/coordinator/trips/${trip}/publish`, {}, coach);

  // Un post collegato al viaggio, visto dalla viaggiatrice prima di prenotare.
  const post = (await call<{ id: string }>('POST', '/studio/posts', { caption: 'Tortellini a mano', rightsConfirmed: true, publishedTripId: trip }, coach)).data.id;
  const media = await call<{ id: string }>('POST', `/studio/posts/${post}/media`, { mimeType: 'image/jpeg', sizeBytes: 1000, extension: 'jpg' }, coach);
  await call('PATCH', `/studio/posts/${post}/media/${media.data.id}`, { status: 'ready' }, coach);
  await call('POST', `/studio/posts/${post}/publish`, {}, coach);
  await call('GET', `/posts/${post}`, undefined, traveler);
  await call('GET', `/posts/${post}`, undefined, coach); // l'autore non conta

  await call('GET', `/catalog/trips/${trip}`, undefined, traveler);
  const reserved = await call<{ id: string }>('POST', `/bookings/trips/${trip}`, {}, traveler);
  await call('POST', `/bookings/${reserved.data.id}/payments`, { kind: 'deposit', method: 'card', acceptTerms: true }, traveler);
  await waitFor(() => call<{ status: string }>('GET', `/bookings/${reserved.data.id}`, undefined, traveler), (booking) => booking.data.status === 'pending');
  await call('POST', `/coordinator/trips/${trip}/participants/${reserved.data.id}/confirm`, {}, coach);

  type Dashboard = {
    summary: { earnings: { grossCents: number; netCents: number }; funnel: Array<{ key: string; count: number }>; seats: { sold: number; offered: number }; weeklyBookings: Array<{ count: number }>; activeTrips: Array<{ id: string; fill: number }> };
    balances: Array<{ requestId: string; name: string; amountDueCents: number; remindedAt?: string }>;
    posts: Array<{ postId: string; views: number; bookings: number }>;
  };
  const dash = await call<Dashboard>('GET', '/coordinator/dashboard?periodo=month', undefined, coach);
  assert.equal(dash.status, 200);
  assert.equal(dash.data.summary.earnings.grossCents, 10000, 'acconto di un quarto della quota');
  assert.deepEqual(dash.data.summary.funnel.map((stage) => [stage.key, stage.count]), [['view', 1], ['save', 0], ['request', 1], ['booking_confirmed', 1]]);
  assert.deepEqual(dash.data.summary.seats, { sold: 1, offered: 4 });
  assert.equal(dash.data.summary.weeklyBookings.at(-1)?.count, 1);
  assert.deepEqual(dash.data.summary.activeTrips.map((item) => [item.id, item.fill]), [[trip, 0.25]]);
  assert.deepEqual(dash.data.balances.map((item) => [item.requestId, item.name, item.amountDueCents]), [[reserved.data.id, 'Lia B.', 30000]]);
  assert.deepEqual(dash.data.posts.map((item) => [item.postId, item.views, item.bookings]), [[post, 1, 1]]);
  assert.equal((await call('GET', '/coordinator/dashboard?periodo=boh', undefined, coach)).status, 400);

  // Sollecita (CP-03): una volta ogni 24 ore; il viaggiatore lo vede in Prossimo viaggio.
  const remind = `/coordinator/trips/${trip}/participants/${reserved.data.id}/remind`;
  assert.equal((await call('POST', remind, {}, traveler)).status, 403);
  assert.equal((await call('POST', remind, {}, coach)).status, 200);
  assert.equal((await call('POST', remind, {}, coach)).status, 422);
  const next = await call<{ balanceRemindedAt?: string }>('GET', '/me/next-trip', undefined, traveler);
  assert.ok(next.data.balanceRemindedAt);
});

test('agenzia: profilo pubblico, team con inviti, licenze a scaglioni che danno il Coordinatore Premium (AG-01, AG-02, AG-05, AG-09, AG-10)', async () => {
  const owner = 'token-agenzia';
  const ownerId = db.addUser(owner, undefined, 'titolare@agenzia.example');
  Object.assign(db.user(ownerId).profile, { firstName: 'Olga', lastName: 'Tour' });
  const coach = 'token-agenzia-coord';
  const coachId = db.addUser(coach, undefined, 'coach@agenzia.example');
  Object.assign(db.user(coachId).profile, { role: 'coordinator', firstName: 'Ciro', lastName: 'Esposito' });
  const operator = 'token-agenzia-operatore';
  db.addUser(operator, undefined, 'operatore@agenzia.example');

  const body = { legalName: 'Viaggi Lenti Srl', displayName: 'Viaggi Lenti', slug: 'viaggi-lenti-api' };
  assert.equal((await call('POST', '/agency', body, owner)).status, 403, 'serve il piano Agenzia');
  db.user(ownerId).plans = ['agency'];
  assert.equal((await call('POST', '/agency', { ...body, slug: 'No Valido' }, owner)).status, 400);
  const created = await call<{ id: string }>('POST', '/agency', body, owner);
  assert.equal(created.status, 201);
  const id = created.data.id;
  const updated = await call<{ city: string }>('PUT', `/agency/${id}`, { description: 'Piccoli gruppi in Italia dal 2012.', city: 'Bologna', website: 'https://viaggilenti.example' }, owner);
  assert.equal(updated.data.city, 'Bologna');
  assert.equal((await call('PUT', `/agency/${id}`, { website: 'ftp://x' }, owner)).status, 400);

  // Inviti (AG-05): l'invitato vede e accetta; un estraneo no.
  assert.equal((await call('POST', `/agency/${id}/team`, { email: 'nessuno@example.com', role: 'coordinator' }, owner)).status, 404);
  assert.equal((await call('POST', `/agency/${id}/team`, { email: 'coach@agenzia.example', role: 'owner' }, owner)).status, 400);
  const coachInvite = (await call<{ id: string }>('POST', `/agency/${id}/team`, { email: 'coach@agenzia.example', role: 'coordinator' }, owner)).data.id;
  const operatorInvite = (await call<{ id: string }>('POST', `/agency/${id}/team`, { email: 'operatore@agenzia.example', role: 'operator' }, owner)).data.id;
  const invites = await call<Array<{ id: string; agencyName: string }>>('GET', '/agency/invites/mine', undefined, coach);
  assert.deepEqual(invites.data.map((item) => [item.id, item.agencyName]), [[coachInvite, 'Viaggi Lenti']]);
  assert.equal((await call('POST', `/agency/invites/${coachInvite}/accept`, {}, operator)).status, 404);
  await call('POST', `/agency/invites/${coachInvite}/accept`, {}, coach);
  await call('POST', `/agency/invites/${operatorInvite}/accept`, {}, operator);

  // Ruoli (AG-02): l'operatore vede il team, non assegna licenze e non ne compra.
  const team = await call<Array<{ role: string; linkType?: string; status: string }>>('GET', `/agency/${id}/team`, undefined, operator);
  assert.deepEqual(team.data.map((member) => [member.role, member.linkType ?? null, member.status]), [['owner', null, 'active'], ['operator', null, 'active'], ['coordinator', 'associated', 'active']]);
  assert.equal((await call('POST', `/agency/members/${coachInvite}/license`, {}, operator)).status, 403);
  assert.equal((await call('PUT', `/agency/${id}/licenses`, { seats: 3 }, operator)).status, 403);
  assert.equal((await call('GET', `/agency/${id}/team`, undefined, coach)).status, 403);

  // Licenze (AG-09, AG-10): scaglione e totale dal server; la licenza dà il Coordinatore Premium.
  assert.equal((await call('POST', `/agency/members/${coachInvite}/license`, {}, owner)).status, 422, 'nessuna licenza libera');
  const seats = await call<{ quote: { perLicenseMonthlyCents: number; totalCents: number; next: { missing: number } } }>('PUT', `/agency/${id}/licenses`, { seats: 3, billingCycle: 'monthly' }, owner);
  assert.deepEqual([seats.data.quote.perLicenseMonthlyCents, seats.data.quote.totalCents, seats.data.quote.next.missing], [4900, 14700, 2]);
  assert.equal((await call('POST', `/agency/members/${coachInvite}/license`, {}, owner)).status, 204);
  const rights = async () => (await call<{ plan: string; entitlements: string[] }>('GET', '/me/entitlements', undefined, coach)).data;
  assert.equal((await rights()).plan, 'coordinator_premium');
  assert.equal((await call('PUT', `/agency/${id}/licenses`, { seats: 0 }, owner)).status, 422);
  assert.equal((await call('DELETE', `/agency/members/${coachInvite}/license`, undefined, owner)).status, 204);
  assert.equal((await rights()).plan, 'coordinator_base', 'la revoca toglie i diritti dal momento successivo');

  // Pagina pubblica (AG-01): dati pubblici e coordinatori attivi, niente licenze né ragione sociale.
  const page = await call<{ displayName: string; coordinators: Array<{ id: string }>; licenseSeats?: number }>('GET', '/agencies/viaggi-lenti-api');
  assert.deepEqual([page.data.displayName, page.data.coordinators.map((item) => item.id), page.data.licenseSeats], ['Viaggi Lenti', [coachId], undefined]);
  assert.equal((await call('GET', '/agencies/non-esiste')).status, 404);
  const mine = await call<{ role: string; quote: { totalCents: number } }>('GET', '/agency', undefined, owner);
  assert.deepEqual([mine.data.role, mine.data.quote.totalCents], ['owner', 14700]);
});

test('catalogo dell’agenzia: partenze, coordinatore assegnato, ombrello e trasparenza per il viaggiatore (AG-03, AG-04, AG-11, AG-12)', async () => {
  const owner = 'token-cat-agenzia';
  const ownerId = db.addUser(owner, undefined, 'titolare@catalogo.example');
  db.user(ownerId).plans = ['agency'];
  const coach = 'token-cat-coord';
  const coachId = db.addUser(coach, undefined, 'coach@catalogo.example');
  Object.assign(db.user(coachId).profile, { role: 'coordinator', firstName: 'Ada', lastName: 'Riva' });
  await call('POST', '/coordinator/guidelines', {}, coach);
  const traveler = 'token-cat-viaggiatore';
  db.addUser(traveler, undefined, 'viaggiatore@catalogo.example');

  const agency = (await call<{ id: string }>('POST', '/agency', { legalName: 'Mare Lento Srl', displayName: 'Mare Lento', slug: 'mare-lento' }, owner)).data.id;
  await call('PUT', `/agency/${agency}`, { saleTerms: 'Acconto rimborsabile fino a 30 giorni dalla partenza.' }, owner);
  const invite = (await call<{ id: string }>('POST', `/agency/${agency}/team`, { email: 'coach@catalogo.example', role: 'coordinator' }, owner)).data.id;
  await call('POST', `/agency/invites/${invite}/accept`, {}, coach);

  // AG-03: lo staff (anche senza essere coordinatore) crea un viaggio del catalogo con l'editor del coordinatore.
  const generated = await call<Itinerary>('POST', '/itineraries/generate', { form: { ...FALLBACK_TRIP_FORM, destination: 'Ponza' } });
  const source = await call<Trip>('POST', '/trips', { itinerary: generated.data }, owner);
  const year = new Date().getFullYear() + 1;
  const created = await call<{ id: string; agencyOwned: boolean; organizer: string; coordinator: { id: string } }>('POST', '/coordinator/trips', {
    sourceTripId: source.data.id, agencyId: agency, title: 'Ponza in barca', price: 650, capacity: 10,
    summary: 'Quattro giorni tra calette, grotte e cene di pesce a Ponza.', startDate: `${year}-06-05`, endDate: `${year}-06-08`,
  }, owner);
  assert.equal(created.status, 201);
  assert.deepEqual([created.data.agencyOwned, created.data.organizer, created.data.coordinator.id], [true, 'agency', '']);
  const trip = created.data.id;
  assert.equal((await call('POST', '/coordinator/trips', { sourceTripId: source.data.id, agencyId: agency, title: 'Abusivo' }, traveler)).status, 403);

  // AG-04: senza coordinatore non si pubblica; si assegna un coordinatore del team.
  const blocked = await call<{ error: string }>('POST', `/coordinator/trips/${trip}/publish`, {}, owner);
  assert.equal(blocked.status, 422);
  assert.match(blocked.data.error, /Assegna un coordinatore/);
  assert.equal((await call('PUT', `/agency/trips/${trip}/coordinator`, { userId: ownerId }, owner)).status, 422);
  assert.equal((await call('PUT', `/agency/trips/${trip}/coordinator`, { userId: coachId }, owner)).status, 204);
  assert.equal((await call('POST', `/coordinator/trips/${trip}/publish`, {}, owner)).status, 200);

  // Seconda partenza dello stesso viaggio, in bozza.
  const departure = await call<{ id: string }>('POST', `/agency/trips/${trip}/departures`, { startDate: `${year}-07-03`, endDate: `${year}-07-06` }, owner);
  assert.equal(departure.status, 201);
  const catalog = await call<{ trips: Array<{ id: string; seriesId?: string; status: string; coordinator: { id: string } }> }>('GET', `/agency/${agency}/catalog`, undefined, owner);
  assert.equal(catalog.data.trips.length, 2);
  assert.equal(new Set(catalog.data.trips.map((item) => item.seriesId)).size, 1, 'stessa serie');
  assert.deepEqual(catalog.data.trips.find((item) => item.id === departure.data.id)?.coordinator.id, '');

  // AG-11: ombrello su un viaggio della coordinatrice, deciso dall'agenzia; poi lo pubblica l'agenzia.
  const ownTrip = (await call<{ id: string }>('POST', '/coordinator/trips', {
    sourceTripId: (await call<Trip>('POST', '/trips', { itinerary: generated.data }, coach)).data.id, title: 'Ventotene slow', price: 480, capacity: 8,
    summary: 'Tre giorni a Ventotene tra snorkeling, storia e tramonti.', startDate: `${year}-05-10`, endDate: `${year}-05-12`,
  }, coach)).data.id;
  assert.equal((await call('PUT', `/agency/${agency}/umbrella/${ownTrip}`, { on: true }, coach)).status, 403);
  assert.equal((await call('PUT', `/agency/${agency}/umbrella/${ownTrip}`, { on: true }, owner)).status, 204);
  const denied = await call<{ error: string }>('POST', `/coordinator/trips/${ownTrip}/publish`, {}, coach);
  assert.equal(denied.status, 403);
  assert.match(denied.data.error, /lo pubblica l’agenzia/);
  assert.equal((await call('POST', `/coordinator/trips/${ownTrip}/publish`, {}, owner)).status, 200);

  // AG-12: il viaggiatore vede chi organizza e le condizioni dell'agenzia.
  const detail = await call<{ organizer: string; organizerAgency?: { name: string; saleTerms: string } }>('GET', `/catalog/trips/${ownTrip}`, undefined, traveler);
  assert.deepEqual([detail.data.organizer, detail.data.organizerAgency?.name, detail.data.organizerAgency?.saleTerms], ['agency', 'Mare Lento', 'Acconto rimborsabile fino a 30 giorni dalla partenza.']);
  const theirs = await call<{ coordinatorTrips: Array<{ id: string; organizer: string }> }>('GET', `/agency/${agency}/catalog`, undefined, owner);
  assert.deepEqual(theirs.data.coordinatorTrips.map((item) => [item.id, item.organizer]), [[ownTrip, 'agency']]);

  // Ombrello predefinito: il prossimo viaggio della coordinatrice nasce coperto.
  assert.equal((await call('PUT', `/agency/members/${invite}/umbrella`, { on: true }, owner)).status, 204);
  const next = await call<{ organizer: string }>('POST', '/coordinator/trips', { sourceTripId: source.data.id, title: 'Palmarola' }, coach);
  assert.equal(next.status, 404, 'il viaggio di partenza è della titolare: la coordinatrice non lo vede');
  const own2 = await call<Trip>('POST', '/trips', { itinerary: generated.data }, coach);
  assert.equal((await call<{ organizer: string }>('POST', '/coordinator/trips', { sourceTripId: own2.data.id, title: 'Palmarola' }, coach)).data.organizer, 'agency');
});

test('dashboard dell’agenzia: fatturato, riempimento, canali e classifica dei coordinatori (AG-07)', async () => {
  const owner = 'token-dash-agenzia';
  const ownerId = db.addUser(owner, undefined, 'titolare@dash.example');
  db.user(ownerId).plans = ['agency'];
  const coach = 'token-dash-agenzia-coord';
  const coachId = db.addUser(coach, undefined, 'coach@dash.example');
  Object.assign(db.user(coachId).profile, { role: 'coordinator', firstName: 'Teo', lastName: 'Vela' });
  await call('POST', '/coordinator/guidelines', {}, coach);
  const first = 'token-dash-v1';
  const second = 'token-dash-v2';
  db.addUser(first, undefined, 'v1@dash.example');
  db.addUser(second, undefined, 'v2@dash.example');

  const agency = (await call<{ id: string }>('POST', '/agency', { legalName: 'Isole Srl', displayName: 'Isole', slug: 'isole-dash' }, owner)).data.id;
  const invite = (await call<{ id: string }>('POST', `/agency/${agency}/team`, { email: 'coach@dash.example', role: 'coordinator' }, owner)).data.id;
  await call('POST', `/agency/invites/${invite}/accept`, {}, coach);
  const generated = await call<Itinerary>('POST', '/itineraries/generate', { form: { ...FALLBACK_TRIP_FORM, destination: 'Eolie' } });
  const source = await call<Trip>('POST', '/trips', { itinerary: generated.data }, owner);
  const year = new Date().getFullYear() + 1;
  const trip = (await call<{ id: string }>('POST', '/coordinator/trips', {
    sourceTripId: source.data.id, agencyId: agency, title: 'Eolie in barca', price: 800, capacity: 8,
    summary: 'Sei giorni tra Lipari, Salina e Stromboli, in barca a vela.', startDate: `${year}-06-10`, endDate: `${year}-06-15`,
  }, owner)).data.id;
  await call('PUT', `/agency/trips/${trip}/coordinator`, { userId: coachId }, owner);
  await call('POST', `/coordinator/trips/${trip}/publish`, {}, owner);

  // Una prenotazione dalla community e una dal link diretto.
  for (const [token, channel] of [[first, undefined], [second, 'direct']] as const) {
    const booking = await call<{ id: string }>('POST', `/bookings/trips/${trip}`, channel ? { channel } : {}, token);
    await call('POST', `/bookings/${booking.data.id}/payments`, { kind: 'deposit', method: 'card', acceptTerms: true }, token);
    await waitFor(() => call<{ status: string }>('GET', `/bookings/${booking.data.id}`, undefined, token), (item) => item.data.status === 'pending');
    await call('POST', `/coordinator/trips/${trip}/participants/${booking.data.id}/confirm`, {}, owner);
  }

  assert.equal((await call('GET', `/agency/${agency}/dashboard`, undefined, coach)).status, 403);
  const dash = await call<{ summary: { revenue: { grossCents: number }; averageFill: number; publishedTrips: number; activeCoordinators: number; channels: { odys: number; direct: number; directShare: number }; leaderboard: Array<{ name: string; revenueCents: number; fill: number }> } }>('GET', `/agency/${agency}/dashboard?periodo=month`, undefined, owner);
  assert.equal(dash.status, 200);
  assert.equal(dash.data.summary.revenue.grossCents, 2 * 20000, 'due acconti da un quarto della quota');
  assert.deepEqual([dash.data.summary.publishedTrips, dash.data.summary.activeCoordinators, dash.data.summary.averageFill], [1, 1, 2 / 8]);
  assert.deepEqual(dash.data.summary.channels, { odys: 1, direct: 1, directShare: 50 });
  assert.deepEqual(dash.data.summary.leaderboard.map((row) => [row.name, row.revenueCents, row.fill]), [['Teo V.', 40000, 0.25]]);
});
