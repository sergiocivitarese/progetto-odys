/**
 * Verifica lo schema Supabase (supabase/migrations) su un Postgres in memoria:
 * registrazione, età minima, storico delle versioni, attività strutturate e RLS.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test, { before } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { FALLBACK_TRIP_FORM, generateItinerary, normalizePlan } from '@odys/domain';

const db = new PGlite();
const migrationsDir = path.resolve(import.meta.dirname, '../../../supabase/migrations');
const itinerary = normalizePlan(generateItinerary({ ...FALLBACK_TRIP_FORM, destination: 'Roma', departure: '2026-10-10', returnDate: '2026-10-12' }));

async function signUp(email: string, meta: Record<string, unknown>): Promise<string> {
  const { rows } = await db.query<{ id: string }>('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, JSON.stringify(meta)]);
  return rows[0].id;
}

/** Esegue `fn` come utente autenticato (ruolo `authenticated`, RLS attivo). */
async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false); select set_config('request.jwt.claim.role', 'authenticated', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);`);
  }
}

const adult = { first_name: 'Giulia', last_name: 'Bianchi', birth_date: '1990-05-01', accepted_terms: true, consent_version: '2026-10' };
let giulia = '';
let marco = '';

before(async () => {
  await db.exec(readFileSync(path.join(import.meta.dirname, 'support/supabase-stub.sql'), 'utf8'));
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  giulia = await signUp('giulia@example.com', adult);
  marco = await signUp('marco@example.com', { ...adult, first_name: 'Marco' });
});

test('la registrazione crea profilo, preferenze e consensi', async () => {
  const profile = await db.query<{ first_name: string; role: string }>('select first_name, role from public.profiles where id = $1', [giulia]);
  assert.deepEqual(profile.rows[0], { first_name: 'Giulia', role: 'traveler' });
  const consents = await db.query('select kind from public.consents where user_id = $1 order by kind', [giulia]);
  assert.deepEqual(consents.rows.map((row: any) => row.kind), ['privacy', 'terms']);
  const prefs = await db.query('select theme from public.user_preferences where user_id = $1', [giulia]);
  assert.equal((prefs.rows[0] as any).theme, 'light');
});

test('un minorenne non può registrarsi', async () => {
  await assert.rejects(signUp('minore@example.com', { ...adult, birth_date: '2015-01-01' }), /18 anni/);
});

test('salvare un viaggio crea la versione 1 e le attività strutturate', async () => {
  const trip = await asUser(giulia, () => db.query<{ id: string; current_version: number }>(
    'select id, current_version from public.save_trip(null, $1, $2, $3)', ['Roma', JSON.stringify(itinerary), 'created']));
  const { id, current_version } = trip.rows[0];
  assert.equal(current_version, 1);
  const versions = await asUser(giulia, () => db.query('select version, change_kind from public.trip_versions where trip_id = $1', [id]));
  assert.deepEqual(versions.rows, [{ version: 1, change_kind: 'created' }]);
  const activities = await asUser(giulia, () => db.query<{ count: number }>('select count(*)::int as count from public.trip_activities where trip_id = $1', [id]));
  const expected = itinerary.days.reduce((total, day) => total + day.activities.length, 0);
  assert.equal(activities.rows[0].count, expected);

  // Una modifica crea la versione 2; un aggiornamento automatico (meteo) no.
  await asUser(giulia, () => db.query('select public.save_trip($1, null, $2, $3)', [id, JSON.stringify({ ...itinerary, pace: 'intenso' }), 'edited']));
  await asUser(giulia, () => db.query('select public.save_trip($1, null, $2, $3, null, null, false)', [id, JSON.stringify(itinerary), 'edited']));
  const after = await asUser(giulia, () => db.query<{ current_version: number }>('select current_version from public.trips where id = $1', [id]));
  assert.equal(after.rows[0].current_version, 2);
});

test('RLS: un utente non vede né modifica i viaggi di un altro', async () => {
  const mine = await asUser(giulia, () => db.query<{ id: string }>('select id from public.trips'));
  assert.ok(mine.rows.length > 0);
  const others = await asUser(marco, () => db.query('select id from public.trips'));
  assert.equal(others.rows.length, 0);
  const versions = await asUser(marco, () => db.query('select id from public.trip_versions'));
  assert.equal(versions.rows.length, 0);
  await assert.rejects(asUser(marco, () => db.query('select public.save_trip($1, null, $2)', [mine.rows[0].id, JSON.stringify(itinerary)])), /non trovato/);
});

test('un utente non può promuoversi amministratore', async () => {
  await assert.rejects(asUser(giulia, () => db.query(`update public.profiles set role = 'admin' where id = $1`, [giulia])), /amministratore/);
  await asUser(giulia, () => db.query(`update public.profiles set bio = 'Amo i viaggi lenti' where id = $1`, [giulia]));
  const profile = await db.query<{ bio: string; role: string }>('select bio, role from public.profiles where id = $1', [giulia]);
  assert.deepEqual(profile.rows[0], { bio: 'Amo i viaggi lenti', role: 'traveler' });
});

test('la cache del geocoding non è accessibile dal client', async () => {
  await assert.rejects(asUser(giulia, () => db.query('select * from public.geocode_cache')), /permission denied/);
});

test('il registro attività mostra solo le proprie azioni', async () => {
  await asUser(giulia, () => db.query(`insert into public.audit_log (action, entity) values ('trip.create', 'trip')`));
  const own = await asUser(giulia, () => db.query('select action from public.audit_log'));
  assert.equal(own.rows.length, 1);
  const foreign = await asUser(marco, () => db.query('select action from public.audit_log'));
  assert.equal(foreign.rows.length, 0);
  await assert.rejects(asUser(marco, () => db.query(`insert into public.audit_log (actor_id, action) values ($1, 'spoof')`, [giulia])), /row-level security/);
});

// ---------------------------------------------------------------------------
// Viaggi pubblicati dai coordinatori (migrazione 0003)
// ---------------------------------------------------------------------------

async function asAnon<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role anon;`);
  try { return await fn(); } finally { await db.exec(`reset role;`); }
}

const nextYear = new Date().getFullYear() + 1;
const publishable = {
  summary: 'Cinque giorni tra mercati, musei e tramonti sul Tevere, in piccolo gruppo.',
  start_date: `${nextYear}-05-10`, end_date: `${nextYear}-05-14`, price_cents: 89000, capacity: 12,
};

test('solo un coordinatore attivo può creare un viaggio pubblicato (C-01)', async () => {
  await assert.rejects(asUser(marco, () => db.query(
    `insert into public.published_trips (title, itinerary) values ('Roma lenta', $1)`, [JSON.stringify(itinerary)])), /row-level security/);
  // Attivazione manuale da parte dell'amministratore del database (C-03).
  await db.query(`update public.profiles set role = 'coordinator' where id = $1`, [giulia]);
  const created = await asUser(giulia, () => db.query<{ status: string }>(
    `insert into public.published_trips (title, itinerary) values ('Roma lenta', $1) returning status`, [JSON.stringify(itinerary)]));
  assert.equal(created.rows[0].status, 'draft');
});

test('la pubblicazione richiede i dati essenziali (C-13) e registra la data (C-12)', async () => {
  const { rows } = await asUser(giulia, () => db.query<{ id: string }>(`select id from public.published_trips limit 1`));
  const id = rows[0].id;
  await assert.rejects(asUser(giulia, () => db.query(`update public.published_trips set status = 'published' where id = $1`, [id])), /descrizione/);
  await asUser(giulia, () => db.query(
    `update public.published_trips set summary = $2, start_date = $3, end_date = $4, price_cents = $5, capacity = $6, status = 'published' where id = $1`,
    [id, publishable.summary, publishable.start_date, publishable.end_date, publishable.price_cents, publishable.capacity]));
  const published = await db.query<{ published_at: string | null; duration_days: number }>('select published_at, duration_days from public.published_trips where id = $1', [id]);
  assert.ok(published.rows[0].published_at);
  assert.equal(published.rows[0].duration_days, 5);
});

test('i visitatori vedono solo i viaggi pubblicati e i profili pubblici dei coordinatori (U-01, U-04)', async () => {
  await asUser(giulia, () => db.query(`insert into public.published_trips (title, itinerary) values ('Bozza segreta', $1)`, [JSON.stringify(itinerary)]));
  const visible = await asAnon(() => db.query<{ title: string }>('select title from public.published_trips order by title'));
  assert.deepEqual(visible.rows.map((row) => row.title), ['Roma lenta']);
  const owner = await asUser(giulia, () => db.query('select title from public.published_trips'));
  assert.equal(owner.rows.length, 2);
  const card = await asAnon(() => db.query<Record<string, unknown>>('select * from public.coordinator_profiles'));
  assert.equal(card.rows.length, 1);
  assert.equal(card.rows[0]['last_initial'], 'B');
  assert.ok(!('birth_date' in card.rows[0]), 'il profilo pubblico non espone la data di nascita');
});

test('un utente salva un viaggio pubblicato e lo usa come base (U-08, U-21)', async () => {
  const { rows } = await asAnon(() => db.query<{ id: string }>('select id from public.published_trips limit 1'));
  const id = rows[0].id;
  await asUser(marco, () => db.query('insert into public.saved_published_trips (published_trip_id) values ($1)', [id]));
  const saved = await asUser(marco, () => db.query('select published_trip_id from public.saved_published_trips'));
  assert.equal(saved.rows.length, 1);
  const copy = await asUser(marco, () => db.query<{ id: string; copied_from: string; owner_id: string }>('select * from public.copy_published_trip($1)', [id]));
  assert.equal(copy.rows[0].copied_from, id);
  assert.equal(copy.rows[0].owner_id, marco);
  const version = await asUser(marco, () => db.query<{ change_kind: string }>('select change_kind from public.trip_versions where trip_id = $1', [copy.rows[0].id]));
  assert.deepEqual(version.rows.map((row) => row.change_kind), ['copied']);
  await assert.rejects(asAnon(() => db.query('select * from public.copy_published_trip($1)', [id])), /permission denied/);
});

test('un coordinatore non modifica i viaggi di un altro', async () => {
  await db.query(`update public.profiles set role = 'coordinator' where id = $1`, [marco]);
  const updated = await asUser(marco, () => db.query(`update public.published_trips set title = 'Rubato' where coordinator_id = $1 returning id`, [giulia]));
  assert.equal(updated.rows.length, 0);
});

// ---------------------------------------------------------------------------
// Richieste di partecipazione e candidature (migrazione 0005)
// ---------------------------------------------------------------------------

let romaLenta = '';
let sara = '';
let luca = '';

/** Prenota e paga l'acconto con il fornitore simulato: la richiesta arriva al coordinatore. */
async function bookWithDeposit(userId: string, tripId: string): Promise<string> {
  const request = (await asUser(userId, () => db.query<{ id: string }>('insert into public.participation_requests (published_trip_id) values ($1) returning id', [tripId]))).rows[0].id;
  const payment = (await asUser(userId, () => db.query<{ id: string }>(`select id from public.start_payment($1, 'deposit', 'card', true)`, [request]))).rows[0].id;
  await asUser(userId, () => db.query('select public.confirm_simulated_payment($1)', [payment]));
  return request;
}

test('prenotazione: il posto si riserva con timer, il coordinatore non prenota il proprio viaggio (TB-08)', async () => {
  sara = await signUp('sara@example.com', { ...adult, first_name: 'Sara', last_name: 'Neri' });
  luca = await signUp('luca@example.com', { ...adult, first_name: 'Luca', last_name: 'Rossi' });
  romaLenta = (await db.query<{ id: string }>(`select id from public.published_trips where title = 'Roma lenta'`)).rows[0].id;
  await db.query('update public.published_trips set capacity = 1, price_cents = 69000, deposit_cents = 20000 where id = $1', [romaLenta]);

  const created = await asUser(sara, () => db.query<{ status: string; user_id: string; seat_number: number; deposit_cents: number; minutes: number }>(
    `insert into public.participation_requests (published_trip_id, message, status) values ($1, 'Ci sono!', 'confirmed')
     returning status, user_id, seat_number, deposit_cents, round(extract(epoch from reserved_until - now()) / 60)::int as minutes`, [romaLenta]));
  assert.deepEqual(created.rows[0], { status: 'reserved', user_id: sara, seat_number: 1, deposit_cents: 20000, minutes: 15 }, 'la prenotazione nasce come posto riservato per 15 minuti');
  await assert.rejects(asUser(giulia, () => db.query('insert into public.participation_requests (published_trip_id) values ($1)', [romaLenta])), /che coordini/);
  await assert.rejects(asUser(sara, () => db.query('insert into public.participation_requests (published_trip_id) values ($1)', [romaLenta])), /già una prenotazione/);
  const draft = (await db.query<{ id: string }>(`select id from public.published_trips where title = 'Bozza segreta'`)).rows[0].id;
  await assert.rejects(asUser(sara, () => db.query('insert into public.participation_requests (published_trip_id) values ($1)', [draft])), /non trovato/);
  // Il posto riservato conta: con un solo posto, Luca non può riservare.
  await assert.rejects(asUser(luca, () => db.query('insert into public.participation_requests (published_trip_id) values ($1)', [romaLenta])), /esauriti/);
});

test('acconto: importo deciso dal server, condizioni obbligatorie, avanzamento solo con la conferma del pagamento (TB-09)', async () => {
  const request = (await asUser(sara, () => db.query<{ id: string }>('select id from public.participation_requests where published_trip_id = $1', [romaLenta]))).rows[0].id;
  // Nessun client scrive i pagamenti o fa avanzare la prenotazione da solo.
  await assert.rejects(asUser(sara, () => db.query(`insert into public.payments (request_id, user_id, kind, amount_cents, currency) values ($1, $2, 'deposit', 1, 'EUR')`, [request, sara])), /permission denied/);
  await assert.rejects(asUser(sara, () => db.query(`update public.participation_requests set status = 'pending' where id = $1`, [request])), /conferma del pagamento/);
  await assert.rejects(asUser(sara, () => db.query(`select public.start_payment($1, 'deposit', 'card', false)`, [request])), /condizioni/);
  await assert.rejects(asUser(luca, () => db.query(`select public.start_payment($1, 'deposit', 'card', true)`, [request])), /non trovata/);
  await assert.rejects(asUser(sara, () => db.query(`select public.confirm_payment(gen_random_uuid())`)), /permission denied/);

  const payment = (await asUser(sara, () => db.query<{ id: string; amount_cents: number; status: string }>(`select id, amount_cents, status from public.start_payment($1, 'deposit', 'card', true)`, [request]))).rows[0];
  assert.deepEqual([payment.amount_cents, payment.status], [20000, 'processing']);
  const again = (await asUser(sara, () => db.query<{ id: string }>(`select id from public.start_payment($1, 'deposit', 'card', true)`, [request]))).rows[0];
  assert.equal(again.id, payment.id, 'un pagamento in corso si riprende, non si duplica');
  await assert.rejects(asUser(luca, () => db.query('select public.confirm_simulated_payment($1)', [payment.id])), /non trovato/);

  await asUser(sara, () => db.query('select public.confirm_simulated_payment($1)', [payment.id]));
  await asUser(sara, () => db.query('select public.confirm_simulated_payment($1)', [payment.id])); // seconda notifica: nessun effetto
  const after = await asUser(sara, () => db.query<{ status: string; reserved_until: string | null; terms: boolean }>('select status, reserved_until, terms_accepted_at is not null as terms from public.participation_requests where id = $1', [request]));
  assert.deepEqual(after.rows[0], { status: 'pending', reserved_until: null, terms: true });
  const events = await db.query<{ kind: string }>(`select kind from public.trip_events where published_trip_id = $1 and kind in ('request', 'payment_confirmed') order by kind`, [romaLenta]);
  assert.deepEqual(events.rows.map((row) => row.kind), ['request', 'payment_confirmed']);
  // Il saldo si paga solo dopo la conferma del coordinatore.
  await assert.rejects(asUser(sara, () => db.query(`select public.start_payment($1, 'balance')`, [request])), /dopo la conferma/);
});

test('RLS: prenotazioni e pagamenti visibili a chi li ha fatti e al coordinatore del viaggio (S-01, CB-08)', async () => {
  assert.equal((await asUser(sara, () => db.query('select id from public.participation_requests'))).rows.length, 1);
  assert.equal((await asUser(luca, () => db.query('select id from public.participation_requests'))).rows.length, 0);
  assert.equal((await asUser(luca, () => db.query('select id from public.payments'))).rows.length, 0);
  assert.equal((await asUser(giulia, () => db.query('select id from public.payments'))).rows.length, 1);
  const participants = await asUser(giulia, () => db.query<{ first_name: string; email: string | null; deposit_cents: number }>('select first_name, email, deposit_cents from public.trip_participants($1)', [romaLenta]));
  assert.deepEqual(participants.rows, [{ first_name: 'Sara', email: null, deposit_cents: 20000 }], 'prima della conferma il contatto non è esposto');
  await assert.rejects(asUser(luca, () => db.query('select * from public.trip_participants($1)', [romaLenta])), /non consentita/);
  const initials = await asAnon(() => db.query<{ list: string[] }>('select public.published_trip_participant_initials($1) as list', [romaLenta]));
  assert.deepEqual(initials.rows[0].list, ['SN']);
});

test('il coordinatore conferma nel limite dei posti, poi il saldo chiude la prenotazione (TB-10, CB-08)', async () => {
  await assert.rejects(asUser(sara, () => db.query(`update public.participation_requests set status = 'confirmed' where published_trip_id = $1`, [romaLenta])), /non consentita/);
  const foreign = await asUser(luca, () => db.query(`update public.participation_requests set status = 'confirmed' where published_trip_id = $1 returning id`, [romaLenta]));
  assert.equal(foreign.rows.length, 0);

  await asUser(giulia, () => db.query(`update public.participation_requests set status = 'confirmed' where published_trip_id = $1 and user_id = $2`, [romaLenta, sara]));
  const confirmed = await asUser(giulia, () => db.query<{ email: string; decided_at: string }>('select email, decided_at from public.trip_participants($1)', [romaLenta]));
  assert.equal(confirmed.rows[0].email, 'sara@example.com');
  assert.ok(confirmed.rows[0].decided_at);
  const count = await asAnon(() => db.query<{ count: number }>('select public.published_trip_confirmed_count($1) as count', [romaLenta]));
  assert.equal(count.rows[0].count, 1);

  const request = (await asUser(sara, () => db.query<{ id: string }>('select id from public.participation_requests where published_trip_id = $1', [romaLenta]))).rows[0].id;
  const balance = (await asUser(sara, () => db.query<{ id: string; amount_cents: number }>(`select id, amount_cents from public.start_payment($1, 'balance')`, [request]))).rows[0];
  assert.equal(balance.amount_cents, 49000, 'saldo = quota meno acconto');
  await asUser(sara, () => db.query('select public.confirm_simulated_payment($1)', [balance.id]));
  assert.equal((await db.query<{ status: string }>('select status from public.participation_requests where id = $1', [request])).rows[0].status, 'balance_paid');
  await assert.rejects(asUser(sara, () => db.query(`update public.participation_requests set status = 'withdrawn' where id = $1`, [request])), /non consentita/, 'una prenotazione saldata non si annulla da sola');

  // Liberato il posto (dalla dashboard), Luca prenota e paga; il coordinatore lo conferma.
  await db.query(`update public.participation_requests set status = 'withdrawn' where id = $1`, [request]);
  const lucaRequest = await bookWithDeposit(luca, romaLenta);
  await asUser(giulia, () => db.query(`update public.participation_requests set status = 'confirmed' where id = $1`, [lucaRequest]));
  // Sara riprova: il posto ora è di Luca.
  await assert.rejects(asUser(sara, () => db.query(`update public.participation_requests set status = 'reserved' where id = $1`, [request])), /esauriti/);
});

test('una riserva scaduta libera il posto e non si può più pagare', async () => {
  const marta = await signUp('marta@example.com', { ...adult, first_name: 'Marta', last_name: 'Gialli' });
  await db.query('update public.published_trips set capacity = 3 where id = $1', [romaLenta]);
  const request = (await asUser(marta, () => db.query<{ id: string }>('insert into public.participation_requests (published_trip_id) values ($1) returning id', [romaLenta]))).rows[0].id;
  await db.query(`update public.participation_requests set reserved_until = now() - interval '1 minute' where id = $1`, [request]);
  await assert.rejects(asUser(marta, () => db.query(`select public.start_payment($1, 'deposit', 'card', true)`, [request])), /scaduto/);
  assert.equal((await asAnon(() => db.query<{ count: number }>('select public.published_trip_confirmed_count($1) as count', [romaLenta]))).rows[0].count, 1, 'conta solo Luca');
  // Riprova: una nuova riserva sulla stessa prenotazione riparte da 15 minuti.
  const renewed = await asUser(marta, () => db.query<{ status: string; minutes: number }>(`update public.participation_requests set status = 'reserved' where id = $1 returning status, round(extract(epoch from reserved_until - now()) / 60)::int as minutes`, [request]));
  assert.deepEqual(renewed.rows[0], { status: 'reserved', minutes: 15 });
});

const application = { motivation: 'Organizzo da anni viaggi lenti per piccoli gruppi e vorrei farlo con Odys.', experience: 'Dieci viaggi di gruppo tra Italia e Portogallo.' };

test('la candidatura richiede un profilo completo e un account viaggiatore (C-01, C-02)', async () => {
  const insert = (userId: string) => asUser(userId, () => db.query<{ id: string; status: string }>(
    `insert into public.coordinator_applications (motivation, experience, trips_led, guidelines_version) values ($1, $2, 10, 'linee-guida-2026-10') returning id, status`,
    [application.motivation, application.experience]));
  await assert.rejects(insert(sara), /Completa il profilo/);
  await assert.rejects(insert(giulia), /ruolo professionale/);
  await asUser(sara, () => db.query(`update public.profiles set bio = 'Viaggio da sempre con lo zaino e amo far scoprire i luoghi con calma.' where id = $1`, [sara]));
  const created = await insert(sara);
  assert.equal(created.rows[0].status, 'pending');
  await assert.rejects(insert(sara), /duplicate key/, 'una sola candidatura in attesa');
  // La candidatura non attiva il ruolo e il candidato non può approvarsi né leggere la nota interna.
  const role = await db.query<{ role: string }>('select role from public.profiles where id = $1', [sara]);
  assert.equal(role.rows[0].role, 'traveler');
  await assert.rejects(asUser(sara, () => db.query(`update public.coordinator_applications set status = 'approved'`)), /permission denied/);
  await assert.rejects(asUser(sara, () => db.query('select admin_note from public.coordinator_applications')), /permission denied/);
  await assert.rejects(asUser(sara, () => db.query('select public.admin_decide_coordinator_application($1, true)', [created.rows[0].id])), /amministratore/);
  const others = await asUser(luca, () => db.query('select id from public.coordinator_applications'));
  assert.equal(others.rows.length, 0);
});

test('l’amministratore valuta la candidatura: l’approvazione attiva il ruolo ed è tracciata (G-01, S-06)', async () => {
  const admin = await signUp('admin@example.com', { ...adult, first_name: 'Ada', last_name: 'Admin' });
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  await assert.rejects(asUser(luca, () => db.query('select * from public.admin_coordinator_applications()')), /amministratore/);
  const pending = await asUser(admin, () => db.query<{ id: string; first_name: string; email: string }>(`select id, first_name, email from public.admin_coordinator_applications('pending')`));
  assert.deepEqual(pending.rows.map((row) => [row.first_name, row.email]), [['Sara', 'sara@example.com']]);
  const id = pending.rows[0].id;

  await asUser(admin, () => db.query(`select public.admin_decide_coordinator_application($1, true, 'Referenze verificate al telefono', 'Benvenuta in Odys!')`, [id]));
  const profile = await db.query<{ role: string }>('select role from public.profiles where id = $1', [sara]);
  assert.equal(profile.rows[0].role, 'coordinator');
  const mine = await asUser(sara, () => db.query<{ status: string; reviewer_message: string }>('select status, reviewer_message from public.coordinator_applications'));
  assert.deepEqual(mine.rows, [{ status: 'approved', reviewer_message: 'Benvenuta in Odys!' }]);
  const audit = await asUser(admin, () => db.query(`select action from public.audit_log where action = 'coordinator_application.approve' and entity_id = $1`, [id]));
  assert.equal(audit.rows.length, 1);
  // Profilo pubblico (CB-09): badge verificato dopo la candidatura approvata; chi non è passato dalla candidatura non lo ha.
  const card = (who: string) => asAnon(() => db.query<{ verified: boolean; languages: string[] }>('select verified, languages from public.coordinator_profiles where id = $1', [who]));
  assert.equal((await card(sara)).rows[0].verified, true);
  assert.equal((await card(giulia)).rows[0].verified, false);
  await assert.rejects(asUser(admin, () => db.query('select public.admin_decide_coordinator_application($1, false)', [id])), /già stata valutata/);
});

// ---------------------------------------------------------------------------
// Creator Studio (migrazione 0006)
// ---------------------------------------------------------------------------

test('Creator Studio: bozze private, pubblicazione validata, like solo su post visibili (C-20…C-23, S-02, U-20)', async () => {
  // Giulia è coordinatrice (test precedenti); Luca è un viaggiatore.
  await assert.rejects(asUser(luca, () => db.query(`insert into public.creator_posts (caption) values ('ciao')`)), /row-level security/);
  const { rows } = await asUser(giulia, () => db.query<{ id: string }>(`insert into public.creator_posts (caption) values ('Alba a Trastevere') returning id`));
  const post = rows[0].id;
  assert.equal((await asAnon(() => db.query('select id from public.creator_posts where id = $1', [post]))).rows.length, 0, 'la bozza non è pubblica');

  await assert.rejects(asUser(giulia, () => db.query(`update public.creator_posts set status = 'published' where id = $1`, [post])), /almeno una foto/);
  const key = `${giulia}/${post}/m1/original.jpg`;
  await assert.rejects(asUser(giulia, () => db.query(`insert into public.creator_post_media (post_id, kind, mime_type, original_key) values ($1, 'image', 'image/jpeg', $2)`, [post, `${luca}/${post}/x.jpg`])), /Percorso/);
  await asUser(giulia, () => db.query(`insert into public.creator_post_media (post_id, kind, mime_type, original_key) values ($1, 'image', 'image/jpeg', $2)`, [post, key]));
  await assert.rejects(asUser(giulia, () => db.query(`update public.creator_posts set status = 'published' where id = $1`, [post])), /caricamento/);
  await asUser(giulia, () => db.query(`update public.creator_post_media set status = 'ready' where post_id = $1`, [post]));
  await assert.rejects(asUser(giulia, () => db.query(`update public.creator_posts set status = 'published' where id = $1`, [post])), /diritti/);
  await asUser(giulia, () => db.query(`update public.creator_posts set rights_confirmed_at = now() where id = $1`, [post]));
  await assert.rejects(asUser(luca, () => db.query(`insert into public.creator_post_likes (post_id) values ($1)`, [post])), /row-level security/, 'niente like sulle bozze');

  await asUser(giulia, () => db.query(`update public.creator_posts set status = 'scheduled', scheduled_for = now() + interval '1 hour' where id = $1`, [post]));
  assert.equal((await asAnon(() => db.query('select id from public.creator_posts where id = $1', [post]))).rows.length, 0, 'programmato: privato fino all’ora');
  await asUser(giulia, () => db.query(`update public.creator_posts set status = 'published' where id = $1`, [post]));
  const visible = await asAnon(() => db.query<{ published_at: string }>('select published_at from public.creator_posts where id = $1', [post]));
  assert.ok(visible.rows[0].published_at);
  assert.equal((await asAnon(() => db.query('select id from public.creator_post_media where post_id = $1', [post]))).rows.length, 1);

  await asUser(luca, () => db.query(`insert into public.creator_post_likes (post_id) values ($1)`, [post]));
  const counts = await asAnon(() => db.query<{ likes: number }>('select likes from public.creator_post_like_counts($1)', [[post]]));
  assert.equal(counts.rows[0].likes, 1);
  assert.equal((await asUser(sara, () => db.query('select * from public.creator_post_likes'))).rows.length, 0, 'i like altrui non sono leggibili');

  // Un altro coordinatore non modifica il post; nessuno lo collega a un viaggio altrui.
  const foreign = await asUser(marco, () => db.query(`update public.creator_posts set caption = 'x' where id = $1 returning id`, [post]));
  assert.equal(foreign.rows.length, 0);
  const marcoTrip = (await db.query<{ id: string }>(`insert into public.published_trips (coordinator_id, title, itinerary) values ($1, 'Di Marco', '{"days":[]}') returning id`, [marco])).rows[0].id;
  await assert.rejects(asUser(giulia, () => db.query(`update public.creator_posts set published_trip_id = $2 where id = $1`, [post, marcoTrip])), /tuoi viaggi/);
});

test('archivio dei media: si scrive solo nella propria cartella, si leggono solo i file dei post visibili (M-06)', async () => {
  const own = `${giulia}/${crypto.randomUUID()}/m/original.jpg`;
  await asUser(giulia, () => db.query(`insert into storage.objects (bucket_id, name) values ('creator-media', $1)`, [own]));
  await assert.rejects(asUser(giulia, () => db.query(`insert into storage.objects (bucket_id, name) values ('creator-media', $1)`, [`${luca}/x/y.jpg`])), /row-level security/);
  assert.equal((await asAnon(() => db.query('select name from storage.objects where name = $1', [own]))).rows.length, 0, 'file di una bozza: non leggibile dal pubblico');
  const published = (await db.query<{ original_key: string }>(`select m.original_key from public.creator_post_media m join public.creator_posts p on p.id = m.post_id where p.status = 'published' limit 1`)).rows[0].original_key;
  await db.query(`insert into storage.objects (bucket_id, name) values ('creator-media', $1)`, [published]);
  assert.equal((await asAnon(() => db.query('select name from storage.objects where name = $1', [published]))).rows.length, 1);
});

test('moderazione: segnalazioni solo su contenuti visibili, decisioni solo dell’amministratore e tracciate (S-07, G-02…G-04)', async () => {
  const post = (await db.query<{ id: string }>(`select id from public.creator_posts where status = 'published' limit 1`)).rows[0].id;
  const draft = (await asUser(giulia, () => db.query<{ id: string }>(`insert into public.creator_posts (caption) values ('privata') returning id`))).rows[0].id;
  await assert.rejects(asUser(luca, () => db.query(`insert into public.content_reports (target_kind, target_id, reason) values ('post', $1, 'spam')`, [draft])), /non trovato/);
  await assert.rejects(asUser(luca, () => db.query(`insert into public.content_reports (target_kind, target_id, reason, status) values ('post', $1, 'spam', 'resolved')`, [post])), /permission denied/, 'chi segnala non decide l’esito');
  const report = (await asUser(luca, () => db.query<{ id: string; status: string }>(`insert into public.content_reports (target_kind, target_id, reason) values ('post', $1, 'spam') returning id, status`, [post]))).rows[0];
  assert.equal(report.status, 'open', 'la segnalazione nasce sempre aperta');
  await assert.rejects(asUser(luca, () => db.query('select resolution_note from public.content_reports')), /permission denied/);
  await assert.rejects(asUser(luca, () => db.query('select * from public.admin_content_reports()')), /amministratore/);

  const admin = (await db.query<{ id: string }>(`select id from public.profiles where role = 'admin' limit 1`)).rows[0].id;
  const queue = await asUser(admin, () => db.query<{ target_title: string; target_owner_id: string }>(`select target_title, target_owner_id from public.admin_content_reports('open')`));
  assert.deepEqual(queue.rows[0], { target_title: 'Alba a Trastevere', target_owner_id: giulia });
  await asUser(admin, () => db.query(`select public.admin_resolve_report($1, 'hidden', 'Verificato')`, [report.id]));
  assert.equal((await asAnon(() => db.query('select id from public.creator_posts where id = $1', [post]))).rows.length, 0, 'il contenuto rimosso non è più pubblico');
  assert.equal((await asUser(admin, () => db.query(`select id from public.audit_log where action = 'report.hidden'`))).rows.length, 1);

  await assert.rejects(asUser(luca, () => db.query(`select public.admin_update_account($1, null, 'suspended')`, [giulia])), /amministratore/);
  await asUser(admin, () => db.query(`select public.admin_update_account($1, null, 'suspended', 'Test')`, [marco]));
  assert.equal((await db.query<{ status: string }>('select status from public.profiles where id = $1', [marco])).rows[0].status, 'suspended');
  await assert.rejects(asUser(admin, () => db.query(`select public.admin_update_account($1, 'traveler')`, [admin])), /tuo account/);
});

test('piani e diritti: la tabella SQL coincide con il dominio, il piano lo assegna solo l’amministratore (TP-10)', async () => {
  const { PLAN_ENTITLEMENTS, describeEntitlements } = await import('@odys/domain');
  const table = await db.query<{ plan: keyof typeof PLAN_ENTITLEMENTS; entitlement: string }>('select plan, entitlement from public.plan_entitlements');
  for (const plan of Object.keys(PLAN_ENTITLEMENTS) as Array<keyof typeof PLAN_ENTITLEMENTS>) {
    assert.deepEqual(table.rows.filter((row) => row.plan === plan).map((row) => row.entitlement).sort(), [...PLAN_ENTITLEMENTS[plan]].sort(), plan);
  }

  const sara = await signUp('sara.piani@example.com', { ...adult, first_name: 'Sara' });
  const mine = () => asUser(sara, () => db.query<{ plan: string; entitlements: string[] }>('select plan, entitlements from public.my_entitlements()'));
  assert.deepEqual((await mine()).rows[0], { plan: 'traveller_base', entitlements: ['trips.book'] });

  // L'utente non si assegna un piano da solo, né scrivendo la tabella né con la funzione.
  await assert.rejects(asUser(sara, () => db.query(`insert into public.subscriptions (user_id, plan) values ($1, 'traveller_premium')`, [sara])), /permission denied/);
  await assert.rejects(asUser(sara, () => db.query(`select public.admin_set_plan($1, 'traveller_premium')`, [sara])), /amministratore/);

  const admin = (await db.query<{ id: string }>(`select id from public.profiles where role = 'admin' limit 1`)).rows[0].id;
  await asUser(admin, () => db.query(`select public.admin_set_plan($1, 'traveller_premium', 'Demo')`, [sara]));
  assert.deepEqual((await mine()).rows[0].entitlements, [...describeEntitlements('traveler', ['traveller_premium']).entitlements].sort());
  assert.equal((await asUser(admin, () => db.query(`select id from public.audit_log where action = 'account.plan'`))).rows.length, 1);
  assert.equal((await asUser(admin, () => db.query<{ plan: string }>(`select plan from public.admin_accounts('sara.piani')`))).rows[0].plan, 'traveller_premium');

  // Coordinatore con licenza: Premium finché è attiva; alla revoca torna Base dal momento successivo (AG-09).
  await db.query(`update public.profiles set role = 'coordinator' where id = $1`, [sara]);
  await asUser(admin, () => db.query(`select public.admin_set_plan($1, 'coordinator_premium')`, [sara]));
  assert.equal((await mine()).rows[0].plan, 'coordinator_premium');
  assert.ok((await mine()).rows[0].entitlements.includes('analytics.coordinator'));
  await asUser(admin, () => db.query(`select public.admin_set_plan($1, null)`, [sara]));
  assert.equal((await mine()).rows[0].plan, 'coordinator_base');
  assert.ok((await asUser(sara, () => db.query<{ ok: boolean }>(`select public.has_entitlement('trips.sell') as ok`))).rows[0].ok);

  // Un account sospeso non ha diritti.
  await db.query(`update public.profiles set status = 'suspended' where id = $1`, [sara]);
  assert.equal((await mine()).rows.length, 0);
});

test('un viaggio ha al massimo 12 posti, coordinatore escluso', async () => {
  await assert.rejects(db.query(`insert into public.published_trips (coordinator_id, title, itinerary, capacity) values ($1, 'Troppi posti', '{"days":[]}', 13)`, [giulia]), /massimo 12 partecipanti/);
});

test('catalogo: acconto e saldo validati, visibilità «Solo follower», eventi scritti solo dal server (CB-04, CB-05, CP-05)', async () => {
  const anna = await signUp('anna.catalogo@example.com', { ...adult, first_name: 'Anna' });
  const piero = await signUp('piero.catalogo@example.com', { ...adult, first_name: 'Piero' });
  await db.query(`update public.profiles set role = 'coordinator' where id = $1`, [anna]);
  const draft = (await asUser(anna, () => db.query<{ id: string }>(
    `insert into public.published_trips (title, summary, itinerary, start_date, end_date, capacity, price_cents, interests, visibility)
     values ('Baja per chi mi segue', 'Balene, deserto e spiagge della Baja California.', $1, current_date + 90, current_date + 97, 12, 195000, '{Mare,Natura}', 'followers') returning id`,
    [JSON.stringify(itinerary)]))).rows[0].id;

  await assert.rejects(asUser(anna, () => db.query(`update public.published_trips set deposit_cents = 200000 where id = $1`, [draft])), /acconto non può superare/);
  await assert.rejects(asUser(anna, () => db.query(`update public.published_trips set balance_due_date = current_date + 120 where id = $1`, [draft])), /entro la data di partenza/);
  const published = (await asUser(anna, () => db.query<{ deposit_cents: number; due: boolean }>(
    `update public.published_trips set status = 'published' where id = $1 returning deposit_cents, balance_due_date = start_date - 30 as due`, [draft]))).rows[0];
  assert.deepEqual(published, { deposit_cents: 49000, due: true }, 'valori provvisori: un quarto della quota, saldo 30 giorni prima');

  const visible = (who: string | null) => (who ? asUser(who, () => db.query('select id from public.published_trips where id = $1', [draft])) : asAnon(() => db.query('select id from public.published_trips where id = $1', [draft])));
  assert.equal((await visible(null)).rows.length, 0);
  assert.equal((await visible(piero)).rows.length, 0, 'chi non segue il coordinatore non vede il viaggio');
  await assert.rejects(asUser(piero, () => db.query(`insert into public.coordinator_follows (follower_id, coordinator_id) values ($1, $2)`, [anna, anna])), /row-level security|check/);
  await asUser(piero, () => db.query(`insert into public.coordinator_follows (coordinator_id) values ($1)`, [anna]));
  assert.equal((await visible(piero)).rows.length, 1);
  assert.equal((await asAnon(() => db.query<{ n: number }>('select public.coordinator_followers_count($1) as n', [anna]))).rows[0].n, 1);

  // Eventi: visualizzazione una volta al giorno, salvataggio dal trigger; la tabella non è leggibile né scrivibile dai client.
  await asUser(piero, () => db.query('select public.record_trip_view($1)', [draft]));
  await asUser(piero, () => db.query('select public.record_trip_view($1)', [draft]));
  await asUser(anna, () => db.query('select public.record_trip_view($1)', [draft]));
  await asUser(piero, () => db.query('insert into public.saved_published_trips (published_trip_id) values ($1)', [draft]));
  const events = await db.query<{ kind: string }>('select kind from public.trip_events where published_trip_id = $1 order by kind', [draft]);
  assert.deepEqual(events.rows.map((row) => row.kind), ['view', 'save']);
  await assert.rejects(asUser(piero, () => db.query('select * from public.trip_events')), /permission denied/);
  await assert.rejects(asUser(piero, () => db.query(`insert into public.trip_events (published_trip_id, kind) values ($1, 'view')`, [draft])), /permission denied/);
});

test('recensioni: solo chi ha partecipato e solo al rientro; il profilo mostra voto, recensioni e follower (TB-11, TB-12)', async () => {
  // Luca ha il posto confermato su Roma lenta (test precedenti). Prima del rientro non può recensire.
  await assert.rejects(asUser(luca, () => db.query(`insert into public.trip_reviews (published_trip_id, coordinator_rating, trip_rating, body) values ($1, 5, 4, 'Bellissimo')`, [romaLenta])), /al rientro/);
  // Viaggio concluso (date spostate dalla dashboard).
  await db.query(`update public.published_trips set start_date = current_date - 10, end_date = current_date - 5, balance_due_date = current_date - 40 where id = $1`, [romaLenta]);
  await assert.rejects(asUser(sara, () => db.query(`insert into public.trip_reviews (published_trip_id, coordinator_rating, trip_rating) values ($1, 1, 1)`, [romaLenta])), /solo chi vi ha partecipato/);
  await asUser(luca, () => db.query(`insert into public.trip_reviews (published_trip_id, coordinator_rating, trip_rating, body) values ($1, 5, 4, '  Gruppo perfetto.  ')`, [romaLenta]));
  await assert.rejects(asUser(luca, () => db.query(`insert into public.trip_reviews (published_trip_id, coordinator_rating, trip_rating) values ($1, 3, 3)`, [romaLenta])), /duplicate key/);
  await assert.rejects(asUser(luca, () => db.query(`insert into public.trip_reviews (published_trip_id, coordinator_rating, trip_rating) values ($1, 6, 3)`, [romaLenta])), /check/);

  const reviews = await asAnon(() => db.query<{ author_name: string; body: string; coordinator_rating: number }>('select author_name, body, coordinator_rating from public.coordinator_reviews($1)', [giulia]));
  assert.deepEqual(reviews.rows, [{ author_name: 'Luca R.', body: 'Gruppo perfetto.', coordinator_rating: 5 }]);
  await asUser(sara, () => db.query(`insert into public.coordinator_follows (coordinator_id) values ($1)`, [giulia]));
  const profile = await asAnon(() => db.query<{ rating: string; reviews_count: number; followers: number; trips_completed: number }>('select rating, reviews_count, followers, trips_completed from public.coordinator_profiles where id = $1', [giulia]));
  assert.deepEqual(profile.rows[0], { rating: '5.0', reviews_count: 1, followers: 1, trips_completed: 1 });
  await assert.rejects(asAnon(() => db.query('select author_id from public.trip_reviews')), /permission denied/, 'chi ha scritto la recensione non è esposto ai visitatori');
});

test('Split: solo i membri del gruppo con il diritto scrivono; le quote devono tornare (TP-09)', async () => {
  // Gruppo di Roma lenta: Giulia (coordinatrice) e Luca (confermato). Luca diventa Premium.
  const admin = (await db.query<{ id: string }>(`select id from public.profiles where role = 'admin' limit 1`)).rows[0].id;
  await asUser(admin, () => db.query(`select public.admin_set_plan($1, 'traveller_premium')`, [luca]));
  const shares = (amounts: Array<[string, number]>) => JSON.stringify(amounts.map(([userId, amountCents]) => ({ userId, amountCents })));
  const add = (who: string, amount: number, list: string) => asUser(who, () => db.query<{ id: string }>(`select id from public.add_split_expense($1, 'Cena', 'food', $2, $3, $4::jsonb)`, [romaLenta, amount, who, list]));

  await assert.rejects(add(sara, 1000, shares([[sara, 1000]])), /Non fai parte/);
  await assert.rejects(add(luca, 1000, shares([[luca, 500], [giulia, 400]])), /non corrispondono/);
  await assert.rejects(add(luca, 1000, shares([[luca, 500], [sara, 500]])), /chi fa parte del gruppo/);
  const expense = (await add(luca, 1000, shares([[luca, 500], [giulia, 500]]))).rows[0].id;
  await assert.rejects(asUser(luca, () => db.query(`insert into public.split_expenses (published_trip_id, paid_by, description, category, amount_cents) values ($1, $2, 'x', 'food', 1)`, [romaLenta, luca])), /permission denied/);

  assert.equal((await asUser(giulia, () => db.query('select id from public.split_expenses'))).rows.length, 1);
  assert.equal((await asUser(sara, () => db.query('select id from public.split_expenses'))).rows.length, 0);
  assert.equal((await asUser(giulia, () => db.query('select amount_cents from public.split_shares'))).rows.length, 2);
  await assert.rejects(asUser(giulia, () => db.query('select public.delete_split_expense($1)', [expense])), /solo le spese che hai inserito/);
  await asUser(luca, () => db.query('select public.delete_split_expense($1)', [expense]));
  assert.equal((await asUser(giulia, () => db.query('select id from public.split_expenses'))).rows.length, 0);
});

test('storia dei luoghi: la colonna non è leggibile dai client, il testo esce solo con il diritto (TP-08, TP-10)', async () => {
  const story = JSON.stringify([{ id: 's1', day: 1, title: 'Colosseo', intro: '', body: 'Inaugurato nell’80 d.C. sotto Tito.', milestones: [], source: 'coordinator' }]);
  const trip = (await asUser(giulia, () => db.query<{ id: string }>(
    `insert into public.published_trips (title, summary, itinerary, start_date, end_date, capacity, price_cents, status, place_stories)
     values ('Roma antica', 'Tre giorni tra Fori, Colosseo e Appia Antica.', $1, current_date + 60, current_date + 62, 12, 40000, 'published', $2::jsonb) returning id`,
    [JSON.stringify(itinerary), story]))).rows[0].id;

  // Nessun ruolo dell'app legge la colonna, nemmeno con select *; le altre colonne restano leggibili.
  await assert.rejects(asAnon(() => db.query('select place_stories from public.published_trips where id = $1', [trip])), /permission denied/);
  await assert.rejects(asUser(sara, () => db.query('select * from public.published_trips where id = $1', [trip])), /permission denied/);
  assert.equal((await asAnon(() => db.query('select title from public.published_trips where id = $1', [trip]))).rows.length, 1);
  assert.equal((await asAnon(() => db.query<{ n: number }>('select public.published_trip_place_stories_count($1) as n', [trip]))).rows[0].n, 1);

  const read = (who: string) => asUser(who, () => db.query<{ stories: Array<{ title: string }> | null }>('select public.published_trip_place_stories($1) as stories', [trip]));
  const marta = (await db.query<{ id: string }>(`select id from auth.users where email = 'marta@example.com'`)).rows[0].id;
  assert.equal((await read(marta)).rows[0].stories, null, 'un Traveller Base non riceve il testo');
  assert.equal((await read(luca)).rows[0].stories?.[0].title, 'Colosseo', 'Luca è Premium');
  assert.equal((await read(giulia)).rows[0].stories?.length, 1, 'chi coordina il viaggio lo legge sempre');
  // «Usa come base» funziona ancora senza leggere la colonna riservata.
  assert.equal((await asUser(marta, () => db.query<{ title: string }>('select title from public.copy_published_trip($1)', [trip]))).rows[0].title, 'Roma antica');
});

test('composizione del prezzo: solo chi coordina il viaggio la legge e la scrive (CB-04)', async () => {
  const trip = (await asUser(giulia, () => db.query<{ id: string }>(
    `insert into public.published_trips (title, summary, itinerary, start_date, end_date, capacity, price_cents, status)
     values ('Roma con i conti', 'Tre giorni tra Fori, Colosseo e Appia Antica.', $1, current_date + 60, current_date + 62, 12, 40000, 'published') returning id`,
    [JSON.stringify(itinerary)]))).rows[0].id;
  const costs = JSON.stringify([{ id: 'c1', label: 'Hotel', category: 'alloggi', basis: 'per_person', amountCents: 20000 }]);

  await asUser(giulia, () => db.query('insert into public.published_trip_pricing (published_trip_id, cost_items, target_earnings_cents) values ($1, $2::jsonb, 90000)', [trip, costs]));
  await asUser(giulia, () => db.query('update public.published_trip_pricing set target_earnings_cents = 100000 where published_trip_id = $1', [trip]));
  assert.equal((await asUser(giulia, () => db.query<{ t: number }>('select target_earnings_cents as t from public.published_trip_pricing where published_trip_id = $1', [trip]))).rows[0].t, 100000);

  // Il viaggio è pubblico, ma i suoi conti no: né per gli altri utenti né per gli anonimi.
  assert.equal((await asUser(sara, () => db.query('select * from public.published_trip_pricing'))).rows.length, 0);
  await assert.rejects(asAnon(() => db.query('select * from public.published_trip_pricing')), /permission denied/);
  await assert.rejects(asUser(marco, () => db.query('insert into public.published_trip_pricing (published_trip_id) values ($1)', [trip])), /row-level security|duplicate key/);
  const updated = await asUser(marco, () => db.query('update public.published_trip_pricing set target_earnings_cents = 0 where published_trip_id = $1', [trip]));
  assert.equal(updated.rowCount, 0);
  await assert.rejects(asUser(giulia, () => db.query(`update public.published_trip_pricing set cost_items = '{}'::jsonb where published_trip_id = $1`, [trip])), /check constraint/);
});

test('dashboard del coordinatore: eventi dal server, sollecito del saldo, post che vendono (CP-01…CP-06)', async () => {
  const trip = (await asUser(giulia, () => db.query<{ id: string }>(
    `insert into public.published_trips (title, summary, itinerary, start_date, end_date, capacity, price_cents, status)
     values ('Roma dei numeri', 'Tre giorni tra Fori, Colosseo e Appia Antica.', $1, current_date + 70, current_date + 72, 12, 50000, 'published') returning id`,
    [JSON.stringify(itinerary)]))).rows[0].id;
  // Post pubblicato di Giulia collegato al viaggio (inserito dal sistema: qui interessa la statistica).
  await db.query('set session_replication_role = replica'); // senza i controlli di pubblicazione (media), non oggetto del test
  const post = (await db.query<{ id: string }>(
    `insert into public.creator_posts (author_id, status, caption, published_trip_id, published_at, rights_confirmed_at)
     values ($1, 'published', 'Il Colosseo all’alba', $2, now(), now()) returning id`, [giulia, trip])).rows[0].id;
  await db.query('set session_replication_role = origin');
  const marta = (await db.query<{ id: string }>(`select id from auth.users where email = 'marta@example.com'`)).rows[0].id;

  await asUser(marta, () => db.query('select public.record_post_view($1)', [post]));
  await asUser(marta, () => db.query('select public.record_post_view($1)', [post])); // stesso giorno: non conta
  await asUser(giulia, () => db.query('select public.record_post_view($1)', [post])); // l'autore non conta
  await assert.rejects(asUser(marta, () => db.query('select * from public.creator_post_views')), /permission denied/);

  const request = await bookWithDeposit(marta, trip);
  await asUser(giulia, () => db.query(`update public.participation_requests set status = 'confirmed' where id = $1`, [request]));

  // Senza il diritto la dashboard non si apre.
  await assert.rejects(asUser(giulia, () => db.query(`select public.coordinator_analytics(now() - interval '30 days')`)), /piano superiore/);
  const admin = (await db.query<{ id: string }>(`select id from public.profiles where role = 'admin' limit 1`)).rows[0].id;
  await asUser(admin, () => db.query(`select public.admin_set_plan($1, 'coordinator_premium')`, [giulia]));
  const data = (await asUser(giulia, () => db.query<{ a: { events: Array<{ tripId: string; kind: string }>; payments: Array<{ tripId: string; kind: string; amountCents: number }>; posts: Array<{ postId: string; views: number; bookings: number }> } }>(
    `select public.coordinator_analytics(now() - interval '30 days') as a`))).rows[0].a;
  const kinds = data.events.filter((event) => event.tripId === trip).map((event) => event.kind);
  assert.deepEqual(kinds, ['request', 'payment_confirmed', 'booking_confirmed']);
  assert.deepEqual(data.payments.filter((payment) => payment.tripId === trip).map((payment) => payment.kind), ['deposit']);
  const stats = data.posts.find((item) => item.postId === post);
  assert.deepEqual([stats?.views, stats?.bookings], [1, 1], 'una visualizzazione e una prenotazione attribuita');
  // Nessun dato personale dei viaggiatori nella risposta.
  assert.ok(!JSON.stringify(data).includes(marta));

  // Sollecito del saldo: solo chi coordina, solo ai confermati, al massimo uno ogni 24 ore.
  await assert.rejects(asUser(sara, () => db.query('select public.remind_balance($1)', [request])), /non trovata/);
  await asUser(giulia, () => db.query('select public.remind_balance($1)', [request]));
  await assert.rejects(asUser(giulia, () => db.query('select public.remind_balance($1)', [request])), /ultime 24 ore/);
  const seen = await asUser(marta, () => db.query<{ balance_reminded_at: string | null }>('select balance_reminded_at from public.participation_requests where id = $1', [request]));
  assert.ok(seen.rows[0].balance_reminded_at, 'il viaggiatore vede il sollecito');
});

test('agenzia: profilo, ruoli interni, inviti e licenze che danno il Coordinatore Premium (AG-01, AG-02, AG-05, AG-09)', async () => {
  const owner = await signUp('agenzia@example.com', { ...adult, first_name: 'Olga', last_name: 'Tour' });
  const create = (who: string, slug = 'viaggi-lenti') => asUser(who, () => db.query<{ id: string }>(`select id from public.create_agency('Viaggi Lenti Srl', 'Viaggi Lenti', $1)`, [slug]));
  await assert.rejects(create(owner), /piano Agenzia/);
  const admin = (await db.query<{ id: string }>(`select id from public.profiles where role = 'admin' limit 1`)).rows[0].id;
  await asUser(admin, () => db.query(`select public.admin_set_plan($1, 'agency')`, [owner]));
  const agency = (await create(owner)).rows[0].id;
  await assert.rejects(create(owner, 'altra'), /già un’agenzia/);

  // Profilo (AG-01): lo modifica chi ha il ruolo giusto, le licenze no.
  await asUser(owner, () => db.query(`update public.agencies set description = 'Viaggi lenti in piccoli gruppi dal 2012.', city = 'Bologna' where id = $1`, [agency]));
  await assert.rejects(asUser(owner, () => db.query('update public.agencies set license_seats = 99 where id = $1', [agency])), /permission denied/);
  const invite = (who: string, email: string, role: string) => asUser(who, () => db.query<{ id: string }>(`select public.invite_agency_member($1, $2, $3::public.agency_role) as id`, [agency, email, role]));
  await assert.rejects(invite(owner, 'nessuno@example.com', 'coordinator'), /Nessun account Odys/);
  await assert.rejects(invite(sara, 'luca@example.com', 'operator'), /non consentita/);
  const saraMember = (await invite(owner, 'SARA@example.com', 'coordinator')).rows[0].id;
  const lucaMember = (await invite(owner, 'luca@example.com', 'operator')).rows[0].id;
  await assert.rejects(invite(owner, 'sara@example.com', 'coordinator'), /già parte del team/);

  // L'invitata vede solo il proprio invito e lo accetta.
  assert.equal((await asUser(sara, () => db.query('select id from public.agency_members'))).rows.length, 1);
  await asUser(sara, () => db.query('select public.respond_agency_invite($1, true)', [saraMember]));
  await asUser(luca, () => db.query('select public.respond_agency_invite($1, true)', [lucaMember]));

  // Ruoli interni (AG-02): l'operatore legge il team ma non assegna né invita.
  const team = await asUser(luca, () => db.query<{ first_name: string; role: string; link_type: string | null; verified: boolean }>('select first_name, role, link_type, verified from public.agency_team($1)', [agency]));
  assert.deepEqual(team.rows.map((row) => [row.first_name, row.role, row.link_type]), [['Olga', 'owner', null], ['Luca', 'operator', null], ['Sara', 'coordinator', 'associated']]);
  assert.equal(team.rows[2].verified, true, 'Sara ha la candidatura approvata');
  await assert.rejects(asUser(sara, () => db.query('select * from public.agency_team($1)', [agency])), /non consentita/);
  await assert.rejects(asUser(luca, () => db.query('select public.assign_agency_license($1)', [saraMember])), /non consentita/);

  // Licenze (AG-09): servono licenze libere; assegnare dà subito il Coordinatore Premium, revocare lo toglie.
  const rights = async () => (await asUser(sara, () => db.query<{ plan: string; entitlements: string[] }>('select plan, entitlements from public.my_entitlements()'))).rows[0];
  const before = await rights();
  await assert.rejects(asUser(owner, () => db.query('select public.assign_agency_license($1)', [saraMember])), /licenze libere/);
  await assert.rejects(asUser(luca, () => db.query(`select public.set_agency_license_seats($1, 2, 'monthly')`, [agency])), /Solo il proprietario/);
  await asUser(owner, () => db.query(`select public.set_agency_license_seats($1, 1, 'annual')`, [agency]));
  await asUser(owner, () => db.query('select public.assign_agency_license($1)', [saraMember]));
  assert.ok((await rights()).entitlements.includes('analytics.coordinator'));
  await assert.rejects(asUser(owner, () => db.query(`select public.set_agency_license_seats($1, 0, 'monthly')`, [agency])), /licenze assegnate/);
  await asUser(owner, () => db.query('select public.revoke_agency_license($1)', [saraMember]));
  assert.deepEqual(await rights(), before, 'dopo la revoca tornano i diritti di prima');

  // Pagina pubblica (AG-01) e storico (licenze e inviti nel registro).
  const profile = await asAnon(() => db.query<{ display_name: string; coordinator_ids: string[] }>('select display_name, coordinator_ids from public.agency_profiles where slug = $1', ['viaggi-lenti']));
  assert.deepEqual([profile.rows[0].display_name, profile.rows[0].coordinator_ids], ['Viaggi Lenti', [sara]]);
  const log = await asUser(owner, () => db.query<{ action: string }>(`select action from public.audit_log where action like 'agency.%' order by id`));
  assert.ok(['agency.create', 'agency.invite', 'agency.license_seats', 'agency.license_assign', 'agency.license_revoke'].every((action) => log.rows.some((row) => row.action === action)));
  await assert.rejects(asUser(owner, () => db.query('select public.remove_agency_member(m.id) from public.agency_members m where m.user_id = $1 and m.agency_id = $2', [owner, agency])), /proprietario/);
});

test('catalogo dell’agenzia: partenze con coordinatore del team, ombrello deciso dall’agenzia (AG-03, AG-04, AG-11)', async () => {
  const owner = (await db.query<{ id: string }>(`select id from auth.users where email = 'agenzia@example.com'`)).rows[0].id;
  const agency = (await db.query<{ id: string }>('select id from public.agencies where owner_id = $1', [owner])).rows[0].id;
  const saraMember = (await db.query<{ id: string }>('select id from public.agency_members where agency_id = $1 and user_id = $2', [agency, sara])).rows[0].id;
  const trip = (await asUser(owner, () => db.query<{ id: string; organizer: string }>(
    `insert into public.published_trips (coordinator_id, agency_id, agency_owned, title, summary, itinerary, start_date, end_date, capacity, price_cents)
     values (null, $1, true, 'Cilento a piedi', 'Cinque giorni di cammini tra mare e borghi del Cilento.', $2, current_date + 90, current_date + 94, 12, 79000) returning id, organizer`,
    [agency, JSON.stringify(itinerary)]))).rows[0];
  assert.equal(trip.organizer, 'agency');
  await assert.rejects(asUser(marco, () => db.query(`insert into public.published_trips (coordinator_id, agency_id, agency_owned, title, itinerary) values (null, $1, true, 'Intruso', $2)`, [agency, JSON.stringify(itinerary)])), /non consentita|row-level/);

  // AG-04: senza coordinatore la partenza non si pubblica; il coordinatore lo sceglie lo staff tra quelli del team.
  await assert.rejects(asUser(owner, () => db.query(`update public.published_trips set status = 'published' where id = $1`, [trip.id])), /Assegna un coordinatore/);
  await assert.rejects(asUser(owner, () => db.query('select public.assign_departure_coordinator($1, $2)', [trip.id, luca])), /del team/);
  await assert.rejects(asUser(owner, () => db.query(`update public.published_trips set coordinator_id = $2 where id = $1`, [trip.id, sara])), /area agenzia/);
  await asUser(owner, () => db.query('select public.assign_departure_coordinator($1, $2)', [trip.id, sara]));
  await asUser(owner, () => db.query(`update public.published_trips set status = 'published' where id = $1`, [trip.id]));

  // AG-03: seconda partenza dello stesso viaggio, in bozza e senza coordinatore.
  const second = (await asUser(owner, () => db.query<{ id: string }>(`select public.add_agency_departure($1, current_date + 120, current_date + 124) as id`, [trip.id]))).rows[0].id;
  const series = await asUser(owner, () => db.query<{ id: string; series_id: string; coordinator_id: string | null; status: string }>('select id, series_id, coordinator_id, status from public.published_trips where agency_id = $1 order by start_date', [agency]));
  assert.equal(series.rows.length, 2);
  assert.equal(series.rows[0].series_id, series.rows[1].series_id);
  assert.deepEqual([series.rows[1].id, series.rows[1].coordinator_id, series.rows[1].status], [second, null, 'draft']);
  // La coordinatrice assegnata vede e gestisce la sua partenza; un estraneo non vede le bozze dell'agenzia.
  assert.equal((await asUser(sara, () => db.query('select id from public.published_trips where id = $1', [trip.id]))).rows.length, 1);
  assert.equal((await asUser(marco, () => db.query('select id from public.published_trips where id = $1', [second]))).rows.length, 0);

  // AG-11: ombrello su un viaggio della coordinatrice. Lei non può cambiarlo, l'agenzia sì; dopo, lo pubblica l'agenzia.
  const own = (await asUser(sara, () => db.query<{ id: string }>(
    `insert into public.published_trips (title, summary, itinerary, start_date, end_date, capacity, price_cents)
     values ('Sila d’autunno', 'Quattro giorni tra boschi, laghi e funghi della Sila.', $1, current_date + 60, current_date + 63, 10, 52000) returning id`,
    [JSON.stringify(itinerary)]))).rows[0].id;
  await assert.rejects(asUser(sara, () => db.query(`update public.published_trips set organizer = 'agency', agency_id = $2 where id = $1`, [own, agency])), /area agenzia/);
  await assert.rejects(asUser(luca, () => db.query('select public.set_trip_umbrella($1, $2, true)', [own, agency])), /non consentita/);
  await asUser(owner, () => db.query('select public.set_trip_umbrella($1, $2, true)', [own, agency]));
  await assert.rejects(asUser(sara, () => db.query(`update public.published_trips set status = 'published' where id = $1`, [own])), /lo pubblica l’agenzia/);
  await asUser(owner, () => db.query(`update public.published_trips set status = 'published' where id = $1`, [own]));
  const covered = await asAnon(() => db.query<{ organizer: string; agency_id: string }>('select organizer, agency_id from public.published_trips where id = $1', [own]));
  assert.deepEqual([covered.rows[0].organizer, covered.rows[0].agency_id], ['agency', agency], 'il viaggiatore vede chi organizza (AG-12)');
  // Lo staff vede i partecipanti del viaggio in ombrello.
  await asUser(owner, () => db.query('select * from public.trip_participants($1)', [own]));

  // Ombrello predefinito: i viaggi nuovi della coordinatrice nascono coperti.
  await asUser(owner, () => db.query('select public.set_member_umbrella_default($1, true)', [saraMember]));
  const next = (await asUser(sara, () => db.query<{ organizer: string }>(`insert into public.published_trips (title, itinerary) values ('Aspromonte', $1) returning organizer`, [JSON.stringify(itinerary)]))).rows[0];
  assert.equal(next.organizer, 'agency');
  const log = await asUser(owner, () => db.query<{ action: string }>(`select action from public.audit_log where action in ('agency.umbrella_on', 'agency.departure_add', 'agency.departure_coordinator', 'agency.umbrella_default')`));
  assert.equal(new Set(log.rows.map((row) => row.action)).size, 4, 'ogni cambio di copertura e assegnazione è registrato');
});

test('dashboard dell’agenzia: canale della prenotazione, dati solo a proprietario e amministratori (AG-07)', async () => {
  const owner = (await db.query<{ id: string }>(`select id from auth.users where email = 'agenzia@example.com'`)).rows[0].id;
  const agency = (await db.query<{ id: string }>('select id from public.agencies where owner_id = $1', [owner])).rows[0].id;
  const trip = (await db.query<{ id: string }>(`select id from public.published_trips where agency_id = $1 and agency_owned and status = 'published' limit 1`, [agency])).rows[0].id;
  const marta = (await db.query<{ id: string }>(`select id from auth.users where email = 'marta@example.com'`)).rows[0].id;

  // Chi arriva dal link condiviso prenota dal canale diretto.
  const request = (await asUser(marta, () => db.query<{ id: string; channel: string }>(`insert into public.participation_requests (published_trip_id, channel) values ($1, 'direct') returning id, channel`, [trip]))).rows[0];
  assert.equal(request.channel, 'direct');
  const payment = (await asUser(marta, () => db.query<{ id: string }>(`select id from public.start_payment($1, 'deposit', 'card', true)`, [request.id]))).rows[0].id;
  await asUser(marta, () => db.query('select public.confirm_simulated_payment($1)', [payment]));

  await assert.rejects(asUser(luca, () => db.query(`select public.agency_dashboard_data($1, now() - interval '30 days')`, [agency])), /proprietario e amministratori/);
  await assert.rejects(asUser(marta, () => db.query(`select public.agency_dashboard_data($1, now() - interval '30 days')`, [agency])), /proprietario e amministratori/);
  const data = (await asUser(owner, () => db.query<{ d: { trips: Array<{ id: string }>; payments: Array<{ tripId: string }>; bookings: Array<{ tripId: string; channel: string }>; coordinators: Array<{ name: string }> } }>(
    `select public.agency_dashboard_data($1, now() - interval '30 days') as d`, [agency]))).rows[0].d;
  assert.ok(data.trips.some((item) => item.id === trip));
  assert.deepEqual(data.bookings.filter((item) => item.tripId === trip).map((item) => item.channel), ['direct']);
  assert.ok(data.payments.some((item) => item.tripId === trip));
  assert.deepEqual(data.coordinators.map((item) => item.name), ['Sara N.']);
  assert.ok(!JSON.stringify(data).includes(marta), 'nessun dato personale dei viaggiatori');

  // Il trigger rende «diretta» ogni prenotazione di un viaggio «Su invito»: si proverà quando esisteranno gli inviti ai viaggi.
});

test('proposte all’agenzia: il coordinatore propone, l’agenzia approva pubblicando o rifiuta con una nota (AG-05, AG-11)', async () => {
  const owner = (await db.query<{ id: string }>(`select id from auth.users where email = 'agenzia@example.com'`)).rows[0].id;
  const agency = (await db.query<{ id: string }>('select id from public.agencies where owner_id = $1', [owner])).rows[0].id;
  // Sara ha l'ombrello predefinito (test precedente): il viaggio nuovo nasce coperto.
  const trip = (await asUser(sara, () => db.query<{ id: string; organizer: string }>(
    `insert into public.published_trips (title, summary, itinerary, start_date, end_date, capacity, price_cents)
     values ('Pollino selvaggio', 'Quattro giorni di trekking tra pini loricati e gole del Raganello.', $1, current_date + 80, current_date + 83, 10, 61000) returning id, organizer`,
    [JSON.stringify(itinerary)]))).rows[0];
  assert.equal(trip.organizer, 'agency');

  await assert.rejects(asUser(sara, () => db.query(`update public.published_trips set approval_status = 'approved' where id = $1`, [trip.id])), /apposita azione/);
  await assert.rejects(asUser(luca, () => db.query('select public.request_agency_approval($1)', [trip.id])), /non trovato/);
  await asUser(sara, () => db.query('select public.request_agency_approval($1)', [trip.id]));
  await assert.rejects(asUser(sara, () => db.query('select public.request_agency_approval($1)', [trip.id])), /già all’agenzia/);

  // Rifiuto: serve una nota; l'operatore non decide.
  await assert.rejects(asUser(luca, () => db.query('select public.decide_agency_proposal($1, false, $2)', [trip.id, 'Prezzo troppo alto'])), /non trovata/);
  await assert.rejects(asUser(owner, () => db.query('select public.decide_agency_proposal($1, false, $2)', [trip.id, ''])), /perché la proposta non va/);
  await asUser(owner, () => db.query('select public.decide_agency_proposal($1, false, $2)', [trip.id, 'Alza la quota: con questi costi il pareggio è a 9 posti.']));
  const rejected = await asUser(sara, () => db.query<{ approval_status: string; approval_note: string; status: string }>('select approval_status, approval_note, status from public.published_trips where id = $1', [trip.id]));
  assert.deepEqual([rejected.rows[0].approval_status, rejected.rows[0].status], ['rejected', 'draft']);
  assert.match(rejected.rows[0].approval_note, /pareggio/);

  // Riproposta, modifica che la ritira, nuova proposta e approvazione che pubblica.
  await asUser(sara, () => db.query('select public.request_agency_approval($1)', [trip.id]));
  await asUser(sara, () => db.query('update public.published_trips set price_cents = 69000 where id = $1', [trip.id]));
  assert.equal((await asUser(sara, () => db.query<{ approval_status: string | null }>('select approval_status from public.published_trips where id = $1', [trip.id]))).rows[0].approval_status, null);
  await asUser(sara, () => db.query('select public.request_agency_approval($1)', [trip.id]));
  const status = (await asUser(owner, () => db.query<{ s: string }>('select public.decide_agency_proposal($1, true) as s', [trip.id]))).rows[0].s;
  assert.equal(status, 'published');
  assert.equal((await asAnon(() => db.query('select id from public.published_trips where id = $1', [trip.id]))).rows.length, 1, 'ora è nel catalogo pubblico');
  void agency;
});

test('AI dell’agenzia per i coordinatori: interruttore, storico scritto dal server, revisione dello staff (AG-06)', async () => {
  const owner = (await db.query<{ id: string }>(`select id from auth.users where email = 'agenzia@example.com'`)).rows[0].id;
  const agency = (await db.query<{ id: string }>('select id from public.agencies where owner_id = $1', [owner])).rows[0].id;
  const trip = (await asUser(sara, () => db.query<{ id: string }>(`insert into public.published_trips (title, itinerary) values ('Aspromonte con l’AI', $1) returning id`, [JSON.stringify(itinerary)]))).rows[0].id;
  const record = (who: string) => asUser(who, () => db.query<{ id: string }>(`select public.record_agency_ai_generation($1, $2, 'Aspromonte', 'Aspromonte in 4 giorni', 4, 52000, 60000) as id`, [agency, trip]));

  await assert.rejects(record(sara), /non è attiva/);
  await asUser(owner, () => db.query(`update public.agencies set ai_enabled = true, ai_min_margin_percent = 30, ai_suppliers = '{Masseria Lupo,Bus Sila}' where id = $1`, [agency]));
  // Una coordinatrice del team non cambia le impostazioni: la regola d'accesso esclude la riga.
  assert.equal((await asUser(sara, () => db.query('update public.agencies set ai_enabled = false where id = $1', [agency]))).affectedRows ?? 0, 0);
  await assert.rejects(record(marco), /non è attiva/);
  const generation = (await record(sara)).rows[0].id;
  await assert.rejects(asUser(sara, () => db.query('update public.published_trips set ai_generation_id = null where id = $1', [trip])), /solo dal generatore/);
  await assert.rejects(asUser(sara, () => db.query(`insert into public.agency_ai_generations (agency_id, coordinator_id, destination, title, days) values ($1, $2, 'x', 'x', 1)`, [agency, sara])), /permission denied/);

  const seen = await asUser(owner, () => db.query<{ status: string; suppliers: string[]; published_trip_id: string }>('select status, suppliers, published_trip_id from public.agency_ai_generations where id = $1', [generation]));
  assert.deepEqual([seen.rows[0].status, seen.rows[0].suppliers, seen.rows[0].published_trip_id], ['to_review', ['Masseria Lupo', 'Bus Sila'], trip]);
  const marta = (await db.query<{ id: string }>(`select id from auth.users where email = 'marta@example.com'`)).rows[0].id;
  assert.equal((await asUser(marta, () => db.query('select id from public.agency_ai_generations'))).rows.length, 0);
  await assert.rejects(asUser(sara, () => db.query('select public.review_agency_ai_generation($1)', [generation])), /non trovata/);
  await asUser(owner, () => db.query('select public.review_agency_ai_generation($1)', [generation]));
  assert.equal((await asUser(sara, () => db.query<{ status: string }>('select status from public.agency_ai_generations where id = $1', [generation]))).rows[0].status, 'approved');

});
