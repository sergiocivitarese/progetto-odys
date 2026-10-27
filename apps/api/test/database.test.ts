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

test('un viaggiatore chiede di partecipare; il coordinatore non può farlo sul proprio viaggio (U-14)', async () => {
  sara = await signUp('sara@example.com', { ...adult, first_name: 'Sara', last_name: 'Neri' });
  luca = await signUp('luca@example.com', { ...adult, first_name: 'Luca', last_name: 'Rossi' });
  romaLenta = (await db.query<{ id: string }>(`select id from public.published_trips where title = 'Roma lenta'`)).rows[0].id;
  await db.query('update public.published_trips set capacity = 1 where id = $1', [romaLenta]);

  const created = await asUser(sara, () => db.query<{ status: string; user_id: string }>(
    `insert into public.participation_requests (published_trip_id, message, status) values ($1, 'Ci sono!', 'confirmed') returning status, user_id`, [romaLenta]));
  assert.deepEqual(created.rows[0], { status: 'pending', user_id: sara }, 'la richiesta nasce sempre in attesa');
  await assert.rejects(asUser(giulia, () => db.query('insert into public.participation_requests (published_trip_id) values ($1)', [romaLenta])), /che coordini/);
  await assert.rejects(asUser(sara, () => db.query('insert into public.participation_requests (published_trip_id) values ($1)', [romaLenta])), /duplicate key/);
  const draft = (await db.query<{ id: string }>(`select id from public.published_trips where title = 'Bozza segreta'`)).rows[0].id;
  await assert.rejects(asUser(sara, () => db.query('insert into public.participation_requests (published_trip_id) values ($1)', [draft])), /non trovato/);
});

test('RLS: la richiesta è visibile solo a chi l’ha fatta e al coordinatore del viaggio (S-01, C-15)', async () => {
  const own = await asUser(sara, () => db.query('select id from public.participation_requests'));
  assert.equal(own.rows.length, 1);
  const stranger = await asUser(luca, () => db.query('select id from public.participation_requests'));
  assert.equal(stranger.rows.length, 0);
  const participants = await asUser(giulia, () => db.query<{ first_name: string; email: string | null }>('select first_name, email from public.trip_participants($1)', [romaLenta]));
  assert.deepEqual(participants.rows, [{ first_name: 'Sara', email: null }], 'prima della conferma il contatto non è esposto');
  await assert.rejects(asUser(luca, () => db.query('select * from public.trip_participants($1)', [romaLenta])), /non consentita/);
});

test('solo il coordinatore conferma, nel limite dei posti; il viaggiatore può ritirarsi (U-16, C-15)', async () => {
  // Il viaggiatore non può confermarsi da solo, né un altro utente può decidere.
  await assert.rejects(asUser(sara, () => db.query(`update public.participation_requests set status = 'confirmed' where published_trip_id = $1`, [romaLenta])), /non consentita/);
  const foreign = await asUser(luca, () => db.query(`update public.participation_requests set status = 'confirmed' where published_trip_id = $1 returning id`, [romaLenta]));
  assert.equal(foreign.rows.length, 0);

  await asUser(giulia, () => db.query(`update public.participation_requests set status = 'confirmed' where published_trip_id = $1 and user_id = $2`, [romaLenta, sara]));
  const confirmed = await asUser(giulia, () => db.query<{ email: string; decided_at: string }>('select email, decided_at from public.trip_participants($1)', [romaLenta]));
  assert.equal(confirmed.rows[0].email, 'sara@example.com');
  assert.ok(confirmed.rows[0].decided_at);
  const count = await asAnon(() => db.query<{ count: number }>('select public.published_trip_confirmed_count($1) as count', [romaLenta]));
  assert.equal(count.rows[0].count, 1);

  // Posti esauriti: niente nuove richieste.
  await assert.rejects(asUser(luca, () => db.query('insert into public.participation_requests (published_trip_id) values ($1)', [romaLenta])), /esauriti/);

  await asUser(sara, () => db.query(`update public.participation_requests set status = 'withdrawn' where published_trip_id = $1`, [romaLenta]));
  await asUser(luca, () => db.query('insert into public.participation_requests (published_trip_id) values ($1)', [romaLenta]));
  await asUser(giulia, () => db.query(`update public.participation_requests set status = 'confirmed' where published_trip_id = $1 and user_id = $2`, [romaLenta, luca]));
  // Sara riapre la richiesta, ma il posto ora è di Luca.
  await asUser(sara, () => db.query(`update public.participation_requests set status = 'pending' where published_trip_id = $1`, [romaLenta]));
  await assert.rejects(asUser(giulia, () => db.query(`update public.participation_requests set status = 'confirmed' where published_trip_id = $1 and user_id = $2`, [romaLenta, sara])), /esauriti/);
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
