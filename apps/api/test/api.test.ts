import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { FALLBACK_TRIP_FORM, type Itinerary } from '@odys/domain';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config/env.ts';
import { MemoryDatabase, memoryAuthProvider, memoryDataStore } from '../src/infra/memory/memory-store.ts';

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
  const app = createApp({ ...loadConfig({}), dataDir }, { auth: memoryAuthProvider(db), store: memoryDataStore(db), fetch: fakeOsm });
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

  // Finché è una bozza il viaggio non accetta richieste; servono comunque accesso e pubblicazione.
  assert.equal((await call('POST', `/catalog/trips/${id}/participation`, {}, first)).status, 404);
  await call('POST', `/coordinator/trips/${id}/publish`, {}, coordinatorToken);
  assert.equal((await call('POST', `/catalog/trips/${id}/participation`, {})).status, 401);
  assert.equal((await call('POST', `/catalog/trips/${id}/participation`, {}, coordinatorToken)).status, 422);

  const request = await call<{ id: string; status: string }>('POST', `/catalog/trips/${id}/participation`, { message: 'Viaggio da solo, va bene?' }, first);
  assert.deepEqual([request.status, request.data.status], [201, 'pending']);
  const again = await call<{ id: string }>('POST', `/catalog/trips/${id}/participation`, {}, first);
  assert.equal(again.data.id, request.data.id, 'una sola richiesta per viaggio');
  const other = await call<{ id: string }>('POST', `/catalog/trips/${id}/participation`, {}, second);

  // L'area personale mostra lo stato con il viaggio collegato (U-12, U-16).
  const mine = await call<Array<{ status: string; trip: { title: string } }>>('GET', '/me/participations', undefined, first);
  assert.deepEqual(mine.data.map((item) => [item.status, item.trip.title]), [['pending', 'Torino a passo lento']]);

  // Il coordinatore vede le richieste; il contatto compare solo dopo la conferma (C-15).
  assert.equal((await call('GET', `/coordinator/trips/${id}/participants`, undefined, first)).status, 403);
  const before = await call<Array<{ firstName: string; message?: string; email?: string }>>('GET', `/coordinator/trips/${id}/participants`, undefined, coordinatorToken);
  assert.deepEqual(before.data.map((item) => [item.firstName, item.message, item.email]), [['Paolo', 'Viaggio da solo, va bene?', undefined], ['Utente', undefined, undefined]]);
  const list = await call<Array<{ id: string; requests: { pending: number; confirmed: number } }>>('GET', '/coordinator/trips', undefined, coordinatorToken);
  assert.deepEqual(list.data.find((trip) => trip.id === id)?.requests, { pending: 2, confirmed: 0 });

  const confirmed = await call<{ status: string }>('POST', `/coordinator/trips/${id}/participants/${request.data.id}/confirm`, {}, coordinatorToken);
  assert.equal(confirmed.data.status, 'confirmed');
  const after = await call<Array<{ email?: string }>>('GET', `/coordinator/trips/${id}/participants`, undefined, coordinatorToken);
  assert.equal(after.data[0].email, 'primo@example.com');
  assert.equal((await call<{ seatsLeft: number }>('GET', `/catalog/trips/${id}`)).data.seatsLeft, 0);

  // Posti esauriti: la seconda richiesta non può essere confermata finché il primo non si ritira.
  const full = await call<{ error: string }>('POST', `/coordinator/trips/${id}/participants/${other.data.id}/confirm`, {}, coordinatorToken);
  assert.equal(full.status, 422);
  assert.match(full.data.error, /esauriti/);
  assert.equal((await call<{ status: string }>('DELETE', `/catalog/trips/${id}/participation`, undefined, first)).data.status, 'withdrawn');
  assert.equal((await call('POST', `/coordinator/trips/${id}/participants/${other.data.id}/confirm`, {}, coordinatorToken)).status, 200);
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
