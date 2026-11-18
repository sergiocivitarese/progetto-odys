/**
 * Dati di prova della modalità demo (API con l'archivio in memoria): un account
 * per ruolo e un mondo già popolato — viaggi in vendita, una prenotazione, un post,
 * l'agenzia «Sud Lento» con catalogo, proposte e AI.
 *
 * Usati da `npm run dev:demo` (scripts/dev-memory.ts) e dallo zip per chi non
 * programma (src/demo-server.ts, `npm run package:demo`).
 */
import { FALLBACK_TRIP_FORM } from '@odys/domain';
import { MemoryDatabase } from '../infra/memory/memory-store';
import { simulatedPaymentProvider, type PaymentProvider } from '../shared/payments';
import { ART_HEIGHT, ART_WIDTH, artSvg, DEMO_COORDINATORS, EXAMPLE_TRIPS, exampleTripForm, OWNER_POSTS, sceneArt, upcomingDates, type PostSpec } from './demo-catalog';
import type { DemoUser } from '../modules/catalog/catalog.routes';

let seeding = false;
/** Pagamenti simulati della demo: immediati mentre si preparano i dati, poi con il ritardo realistico. */
export const demoPayments: PaymentProvider = simulatedPaymentProvider(() => (seeding ? 0 : 1200));

/** Archivio in memoria con gli account di prova (i contenuti li crea `seedDemoData`). */
const GUESTS: Array<[string, string]> = [
  ['Giulia', 'Neri'], ['Marco', 'Villa'], ['Sara', 'Fontana'], ['Davide', 'Greco'], ['Anna', 'Lombardi'],
  ['Federico', 'Rinaldi'], ['Irene', 'Moretti'], ['Tommaso', 'Barbieri'], ['Silvia', 'Costa'], ['Andrea', 'Mancini'],
];

export function createDemoDatabase(): { db: MemoryDatabase; demoUsers: DemoUser[] } {
  const db = new MemoryDatabase();
  const TOKEN = 'demo-coordinatore';
  const userId = db.addUser(TOKEN, 'demo-coordinatore', 'coordinatrice@odys.test');
  Object.assign(db.user(userId).profile, { role: 'coordinator', firstName: 'Nora', lastName: 'Conti' });
  Object.assign(db.user(userId).profile, { bio: 'Accompagno piccoli gruppi nel Sud Italia da dieci anni: ritmo lento, cucina di casa, luoghi fuori dalle guide.', interests: ['Storia', 'Cibo', 'Natura'] });
  // Candidatura approvata: badge «verificato» e lingue nel profilo pubblico (CB-09).
  db.applications.push({
    id: 'demo-candidatura', userId, status: 'approved', createdAt: new Date().toISOString(), decidedAt: new Date().toISOString(),
    motivation: 'Organizzo viaggi lenti in piccoli gruppi.', experience: 'Dieci anni di viaggi di gruppo nel Sud Italia.', tripsLed: 24,
    languages: ['Italiano', 'Inglese', 'Spagnolo'], links: [],
  });

  // Coordinatore Premium: apre la pagina Dati (CP-01…CP-06). Una viaggiatrice di prova prenota.
  db.user(userId).plans = ['coordinator_premium'];
  const TRAVELER = 'demo-viaggiatrice';
  const travelerId = db.addUser(TRAVELER, 'demo-viaggiatrice', 'viaggiatrice@odys.test');
  Object.assign(db.user(travelerId).profile, { firstName: 'Lia', lastName: 'Bassi' });

  // Amministratore di prova: candidature, segnalazioni e ruoli (pagine /admin).
  const ADMIN = 'demo-admin';
  const adminId = db.addUser(ADMIN, 'demo-admin', 'admin@odys.test');
  Object.assign(db.user(adminId).profile, { role: 'admin', firstName: 'Ada', lastName: 'Rossi' });

  // Titolare dell'agenzia di prova (piano Agenzia): l'agenzia la crea `seedDemoData`.
  const agencyOwner = db.addUser('demo-agenzia', 'demo-agenzia', 'titolare@odys.test');
  Object.assign(db.user(agencyOwner).profile, { firstName: 'Olga', lastName: 'Ferri' });
  db.user(agencyOwner).plans = ['agency'];

  // Viaggiatrice Premium: viaggio concluso con recensione, Split, viaggio pianificato.
  const marta = db.addUser('demo-premium', 'demo-premium', 'premium@odys.test');
  Object.assign(db.user(marta).profile, { firstName: 'Marta', lastName: 'Gallo', interests: ['Cibo', 'Arte', 'Natura'] });
  db.user(marta).plans = ['traveller_premium'];
  // Iscritto da poco con una candidatura da coordinatore in attesa (la vede l'amministratrice).
  const paolo = db.addUser('demo-nuovo', 'demo-nuovo', 'nuovo@odys.test');
  Object.assign(db.user(paolo).profile, { firstName: 'Paolo', lastName: 'Riva' });
  db.applications.push({
    id: 'demo-candidatura-paolo', userId: paolo, status: 'pending', createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    motivation: 'Vorrei accompagnare piccoli gruppi a piedi lungo la Via Francigena, con tappe brevi e ospitalità religiosa.',
    experience: 'Guida ambientale escursionistica da sei anni, ho organizzato viaggi per amici e associazioni.', tripsLed: 6,
    languages: ['Italiano', 'Francese'], links: [],
  });
  // Viaggiatori di contorno che riempiono i viaggi (non compaiono nella pagina di accesso).
  for (const [index, [first, last]] of GUESTS.entries()) {
    const id = db.addUser(`demo-ospite-${index + 1}`, `demo-ospite-${index + 1}`, `ospite${index + 1}@odys-demo.example`);
    Object.assign(db.user(id).profile, { firstName: first, lastName: last });
  }

  const demoUsers: DemoUser[] = [
    { token: TRAVELER, email: 'viaggiatrice@odys.test', firstName: 'Lia', lastName: 'Bassi', label: 'Traveller Base · prenotazioni (confermata e in attesa), idee salvate, invito in agenzia' },
    { token: 'demo-premium', email: 'premium@odys.test', firstName: 'Marta', lastName: 'Gallo', label: 'Traveller Premium · generatore AI, Split, viaggio concluso da recensire' },
    { token: 'demo-nuovo', email: 'nuovo@odys.test', firstName: 'Paolo', lastName: 'Riva', label: 'Appena iscritto · nessun viaggio, candidatura da coordinatore in attesa' },
    { token: TOKEN, email: 'coordinatrice@odys.test', firstName: 'Nora', lastName: 'Conti', label: 'Coordinatore Premium · 12 viaggi, uno esaurito e uno concluso, dati, team agenzia' },
    { token: 'demo-chiara', email: 'chiara@odys-demo.example', firstName: 'Chiara', lastName: 'Esposito', label: 'Coordinatore Base · un viaggio in vendita, post, statistiche bloccate' },
    { token: 'demo-agenzia', email: 'titolare@odys.test', firstName: 'Olga', lastName: 'Ferri', label: 'Agenzia · Sud Lento: team, catalogo, proposte, dashboard, AI, piano' },
    { token: ADMIN, email: 'admin@odys.test', firstName: 'Ada', lastName: 'Rossi', label: 'Amministratore · candidatura da approvare, segnalazioni, ruoli e piani' },
  ];
  // Coordinatori dimostrativi del catalogo, ognuno con un viaggio e i suoi post (contenuti in demo-catalog.ts).
  for (const coordinator of DEMO_COORDINATORS) {
    const id = db.addUser(`demo-${coordinator.key}`, `demo-${coordinator.key}`, `${coordinator.key}@odys-demo.example`);
    Object.assign(db.user(id).profile, { role: 'coordinator', firstName: coordinator.firstName, lastName: coordinator.lastName, publicHeadline: coordinator.headline, bio: coordinator.bio, interests: coordinator.interests });
    db.applications.push({
      id: `demo-candidatura-${coordinator.key}`, userId: id, status: 'approved', createdAt: new Date().toISOString(), decidedAt: new Date().toISOString(),
      motivation: 'Account di esempio creato per provare Odys.', experience: coordinator.bio, tripsLed: 12, languages: ['Italiano', 'Inglese'], links: [],
    });
  }
  return { db, demoUsers };
}

/** Popola la demo chiamando l'API come farebbero gli utenti, con le stesse regole. `base` = `http://localhost:<porta>/api`. */
export async function seedDemoData(base: string, db: MemoryDatabase): Promise<void> {
  seeding = true;
  try {
    await seedAll(base, db);
  } finally {
    seeding = false;
  }
}

async function seedAll(base: string, db: MemoryDatabase): Promise<void> {
  const TOKEN = 'demo-coordinatore';
  const TRAVELER = 'demo-viaggiatrice';
  const userId = 'demo-coordinatore';
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    return (response.status === 204 ? undefined : await response.json()) as T;
  };
  const year = new Date().getFullYear() + 1;
  await call('POST', '/coordinator/guidelines', {});
  const itinerary = await call('POST', '/itineraries/generate', { form: { ...FALLBACK_TRIP_FORM, destination: 'Matera' } });
  const own = await call<{ id: string }>('POST', '/trips', { itinerary });
  const onSale = await call<{ id: string }>('POST', '/coordinator/trips', {
    sourceTripId: own.id, title: 'Matera e i Sassi in piccolo gruppo', price: 690, capacity: 12, country: 'Italia', interests: ['Storia', 'Cibo'],
    summary: 'Quattro giorni tra Sassi, chiese rupestri e cucina lucana, con ritmo lento.', startDate: `${year}-04-02`, endDate: `${year}-04-05`,
  });
  await call('POST', `/coordinator/trips/${onSale.id}/publish`, {});
  await call('PUT', `/coordinator/trips/${onSale.id}/pricing`, {
    costs: [
      { label: 'Masseria 3 notti', category: 'alloggi', basis: 'per_person', amountCents: 24000 },
      { label: 'Pulmino con autista', category: 'trasporti', basis: 'group', amountCents: 120000 },
      { label: 'Guida ai Sassi', category: 'attivita', basis: 'group', amountCents: 30000 },
      { label: 'Il mio viaggio', category: 'altro', basis: 'group', amountCents: 25000 },
    ],
    targetEarningsCents: 150000,
  });
  await call('POST', '/coordinator/trips', { sourceTripId: own.id, title: 'Bozza: Basilicata d’autunno', price: 540, capacity: 8 });
  const as = async <T>(token: string, method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    return (response.status === 204 ? undefined : await response.json()) as T;
  };
  // Post collegato al viaggio, visto dalla viaggiatrice prima di prenotare (CP-06).
  const post = await call<{ id: string }>('POST', '/studio/posts', { caption: 'Alba sui Sassi dal belvedere di Murgia Timone', rightsConfirmed: true, publishedTripId: onSale.id });
  const media = await call<{ id: string }>('POST', `/studio/posts/${post.id}/media`, { mimeType: 'image/jpeg', sizeBytes: 1000, extension: 'jpg' });
  await call('PATCH', `/studio/posts/${post.id}/media/${media.id}`, { status: 'ready' });
  db.creator.art.set(media.id, artSvg(sceneArt('hills', 'Sassi di Matera'), 1));
  await call('POST', `/studio/posts/${post.id}/publish`, {});
  await as(TRAVELER, 'GET', `/posts/${post.id}`);
  await as(TRAVELER, 'GET', `/catalog/trips/${onSale.id}`);
  const booking = await as<{ id: string }>(TRAVELER, 'POST', `/bookings/trips/${onSale.id}`, {});
  await as(TRAVELER, 'POST', `/bookings/${booking.id}/payments`, { kind: 'deposit', method: 'card', acceptTerms: true });
  for (let i = 0; i < 30; i += 1) {
    if ((await as<{ status: string }>(TRAVELER, 'GET', `/bookings/${booking.id}`)).status === 'pending') break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await call('POST', `/coordinator/trips/${onSale.id}/participants/${booking.id}/confirm`, {});
  // Agenzia di prova (R5): titolare con piano Agenzia, Nora coordinatrice nel team, la viaggiatrice invitata come operatrice.
  const AGENCY = 'demo-agenzia';
  const agency = await as<{ id: string }>(AGENCY, 'POST', '/agency', { legalName: 'Sud Lento Viaggi Srl', displayName: 'Sud Lento', slug: 'sud-lento' });
  await as(AGENCY, 'PUT', `/agency/${agency.id}`, { description: 'Viaggi in piccoli gruppi tra Puglia, Basilicata e Calabria, con coordinatori del posto.', city: 'Matera', country: 'Italia', website: 'https://sudlento.example', email: 'ciao@sudlento.example' });
  const noraInvite = await as<{ id: string }>(AGENCY, 'POST', `/agency/${agency.id}/team`, { email: 'coordinatrice@odys.test', role: 'coordinator' });
  await call('POST', `/agency/invites/${noraInvite.id}/accept`, {});
  await as(AGENCY, 'POST', `/agency/${agency.id}/team`, { email: 'viaggiatrice@odys.test', role: 'operator' });
  // Catalogo dell'agenzia (AG-03, AG-04) e ombrello (AG-11).
  await as(AGENCY, 'PUT', `/agency/${agency.id}`, { saleTerms: 'Acconto rimborsabile fino a 45 giorni dalla partenza. Organizzatore responsabile: Sud Lento Viaggi Srl, fondo di garanzia e assicurazione inclusi.' });
  const agencySource = await as<{ id: string }>(AGENCY, 'POST', '/trips', { itinerary: await call('POST', '/itineraries/generate', { form: { ...FALLBACK_TRIP_FORM, destination: 'Gargano' } }) });
  const catalogTrip = await as<{ id: string }>(AGENCY, 'POST', '/coordinator/trips', {
    sourceTripId: agencySource.id, agencyId: agency.id, title: 'Gargano tra foreste e trabucchi', price: 720, capacity: 12, country: 'Italia', interests: ['Natura', 'Cibo'],
    summary: 'Cinque giorni tra Foresta Umbra, Vieste e i trabucchi della costa, in piccolo gruppo.', startDate: `${year}-05-20`, endDate: `${year}-05-24`,
  });
  await as(AGENCY, 'PUT', `/agency/trips/${catalogTrip.id}/coordinator`, { userId });
  await as(AGENCY, 'POST', `/coordinator/trips/${catalogTrip.id}/publish`, {});
  await as(AGENCY, 'POST', `/agency/trips/${catalogTrip.id}/departures`, { startDate: `${year}-09-16`, endDate: `${year}-09-20` });
  // Prenotazione dal link diretto del kit social (canale «diretto», AG-07).
  const direct = await as<{ id: string }>(TRAVELER, 'POST', `/bookings/trips/${catalogTrip.id}`, { channel: 'direct' });
  await as(TRAVELER, 'POST', `/bookings/${direct.id}/payments`, { kind: 'deposit', method: 'card', acceptTerms: true });
  for (let i = 0; i < 30; i += 1) {
    if ((await as<{ status: string }>(TRAVELER, 'GET', `/bookings/${direct.id}`)).status === 'pending') break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await as(AGENCY, 'POST', `/coordinator/trips/${catalogTrip.id}/participants/${direct.id}/confirm`, {});
  const draftTrip = (await call<Array<{ id: string; status: string }>>('GET', '/coordinator/trips')).find((trip) => trip.status === 'draft');
  if (draftTrip) {
    await as(AGENCY, 'PUT', `/agency/${agency.id}/umbrella/${draftTrip.id}`, { on: true });
    // Nora completa la bozza coperta e la propone all'agenzia (AG-05).
    await call('PUT', `/coordinator/trips/${draftTrip.id}`, { title: 'Basilicata d’autunno', summary: 'Quattro giorni tra Craco, Aliano e i calanchi, con cene in masseria.', startDate: `${year}-10-08`, endDate: `${year}-10-11`, price: 640, capacity: 8 });
    await call('PUT', `/coordinator/trips/${draftTrip.id}/pricing`, { costs: [
      { label: 'Masserie 3 notti', category: 'alloggi', basis: 'per_person', amountCents: 21000 },
      { label: 'Pulmino', category: 'trasporti', basis: 'group', amountCents: 90000 },
    ] });
    await call('POST', `/coordinator/trips/${draftTrip.id}/submit`, {});
  }
  // AI dell'agenzia (AG-06): attiva, con fornitori convenzionati e margine minimo; Nora genera un viaggio.
  await as(AGENCY, 'PUT', `/agency/${agency.id}/ai`, { enabled: true, minMarginPercent: 30, suppliers: ['Masseria Lupo', 'Bus Sila Express'] });
  await call('POST', '/coordinator/trips', {
    generator: { destination: 'Tropea', surprise: false, dates: { mode: 'precise', departure: `${year}-06-12`, returnDate: `${year}-06-15` }, duration: '3-5', budget: 650, interests: ['Mare', 'Cibo'], seed: 4 },
    agencyAi: agency.id, capacity: 10, price: 590, summary: 'Quattro giorni tra Tropea, Capo Vaticano e Pizzo, con cene di pesce.',
  });
  const noraTrips = await seedExampleCatalog(base, db);
  await seedScenarios(base, db, noraTrips);
}

/**
 * Catalogo di esempio: Nora pubblica i dieci viaggi di gruppo con i suoi post,
 * i quattro coordinatori dimostrativi il proprio viaggio con tre post ciascuno.
 * Le date passate si spostano avanti di un anno; le immagini sono illustrazioni.
 */
async function seedExampleCatalog(base: string, db: MemoryDatabase): Promise<Map<string, string>> {
  const as = async <T>(token: string, method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    return (response.status === 204 ? undefined : await response.json()) as T;
  };
  const publish = async (token: string, trip: { title: string; destination: string; summary: string; start: string; end: string; price: number; capacity: number; included: string[]; excluded: string[]; interests: string[] }, form: object): Promise<string> => {
    const itinerary = await as(token, 'POST', '/itineraries/generate', { form });
    const own = await as<{ id: string }>(token, 'POST', '/trips', { itinerary });
    const [, country] = trip.destination.split(',').map((part) => part.trim());
    const created = await as<{ id: string }>(token, 'POST', '/coordinator/trips', {
      sourceTripId: own.id, title: trip.title, summary: trip.summary, price: trip.price, capacity: Math.min(trip.capacity, 12), country: country ?? '',
      interests: trip.interests, startDate: trip.start, endDate: trip.end, included: trip.included, excluded: trip.excluded,
    });
    await as(token, 'POST', `/coordinator/trips/${created.id}/publish`, {});
    return created.id;
  };
  let seed = 1;
  const post = async (token: string, spec: PostSpec, trips: Map<string, string>): Promise<void> => {
    const created = await as<{ id: string }>(token, 'POST', '/studio/posts', {
      caption: spec.caption, rightsConfirmed: true, location: spec.place, publishedTripId: spec.trip ? trips.get(spec.trip) ?? null : null,
    });
    for (const scene of spec.scenes) {
      const media = await as<{ id: string }>(token, 'POST', `/studio/posts/${created.id}/media`, { mimeType: 'image/jpeg', sizeBytes: 200_000, extension: 'jpg', width: ART_WIDTH, height: ART_HEIGHT });
      await as(token, 'PATCH', `/studio/posts/${created.id}/media/${media.id}`, { status: 'ready' });
      db.creator.art.set(media.id, artSvg(sceneArt(scene, spec.place.label), (seed += 1)));
    }
    if (spec.status === 'draft') return;
    if (spec.status === 'scheduled') {
      await as(token, 'POST', `/studio/posts/${created.id}/schedule`, { scheduledFor: new Date(Date.now() + 3 * 86_400_000).toISOString() });
      return;
    }
    await as(token, 'POST', `/studio/posts/${created.id}/publish`, {});
    const stored = db.creator.posts.get(created.id);
    if (stored) stored.publishedAt = new Date(Date.now() - spec.daysAgo * 86_400_000 - seed * 60_000).toISOString();
  };

  const noraTrips = new Map<string, string>();
  for (const example of EXAMPLE_TRIPS) {
    const dates = upcomingDates(example.start, example.end);
    const trip = { ...example, ...dates };
    noraTrips.set(example.title, await publish('demo-coordinatore', trip, exampleTripForm(example, dates.start, dates.end)));
  }
  for (const spec of OWNER_POSTS) await post('demo-coordinatore', spec, noraTrips);

  for (const coordinator of DEMO_COORDINATORS) {
    const token = `demo-${coordinator.key}`;
    await as(token, 'POST', '/coordinator/guidelines', {});
    const dates = upcomingDates(coordinator.trip.start, coordinator.trip.end);
    const trip = { ...coordinator.trip, ...dates, interests: coordinator.interests };
    const form = exampleTripForm({ ...trip, pace: 'equilibrato', transport: 'misto', arrival: 'treno' }, dates.start, dates.end);
    const trips = new Map([[trip.title, await publish(token, trip, form)]]);
    for (const spec of coordinator.posts) await post(token, spec, trips);
  }
  // Like incrociati tra i coordinatori dimostrativi e la viaggiatrice, per un feed vivo.
  const tokens = ['demo-viaggiatrice', ...DEMO_COORDINATORS.map((item) => `demo-${item.key}`)];
  const published = [...db.creator.posts.values()].filter((item) => item.status === 'published');
  for (const [index, item] of published.entries()) {
    for (const token of tokens.filter((_, i) => (index + i) % 2 === 0)) {
      if (token.endsWith(item.authorId.replace('demo-', ''))) continue;
      await as(token, 'PUT', `/posts/${item.id}/like`, {}).catch(() => undefined);
    }
  }
  return noraTrips;
}

/**
 * Le combinazioni da provare: prenotazioni in ogni stato, un viaggio esaurito,
 * un viaggio concluso con recensioni, follower, idee salvate, viaggi personali,
 * Split, segnalazioni. Ogni scenario è indipendente: se uno non riesce, la demo parte lo stesso.
 */
async function seedScenarios(base: string, db: MemoryDatabase, trips: Map<string, string>): Promise<void> {
  const as = async <T>(token: string, method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    return (response.status === 204 ? undefined : await response.json()) as T;
  };
  const scenario = async (name: string, run: () => Promise<void>) => {
    try { await run(); } catch (error) { console.warn(`  (demo) scenario «${name}» saltato: ${(error as Error).message}`); }
  };
  const NORA = 'demo-coordinatore';
  const guest = (n: number) => `demo-ospite-${n}`;
  const trip = (title: string) => {
    const id = trips.get(title);
    if (!id) throw new Error(`viaggio «${title}» assente`);
    return id;
  };
  /** Prenota con acconto; poi, se richiesto, conferma il coordinatore e si paga il saldo. */
  const book = async (token: string, tripId: string, options: { confirm?: boolean; balance?: boolean; direct?: boolean } = {}) => {
    const booking = await as<{ id: string }>(token, 'POST', `/bookings/trips/${tripId}`, options.direct ? { channel: 'direct' } : {});
    await as(token, 'POST', `/bookings/${booking.id}/payments`, { kind: 'deposit', method: 'card', acceptTerms: true });
    for (let i = 0; i < 30; i += 1) {
      if ((await as<{ status: string }>(token, 'GET', `/bookings/${booking.id}`)).status === 'pending') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (options.confirm) await as(NORA, 'POST', `/coordinator/trips/${tripId}/participants/${booking.id}/confirm`, {});
    if (options.balance) await as(token, 'POST', `/bookings/${booking.id}/payments`, { kind: 'balance', method: 'card', acceptTerms: true });
    return booking.id;
  };

  await scenario('Lisbona quasi piena', async () => {
    const id = trip('Lisbona tra miradouros e azulejos');
    for (const n of [1, 2, 3, 4]) await book(guest(n), id, { confirm: true });
    await book(guest(5), id);
    await book(guest(6), id, { direct: true });
    await book('demo-premium', id, { confirm: true, balance: true });
  });
  await scenario('Kyoto esaurito', async () => {
    const id = trip('Kyoto tra templi e botteghe');
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) await book(guest(n), id, { confirm: true });
  });
  await scenario('Altre prenotazioni', async () => {
    await book('demo-viaggiatrice', trip('Costiera Amalfitana senza fretta'));
    for (const n of [7, 8, 9]) await book(guest(n), trip('Costiera Amalfitana senza fretta'), { confirm: true });
    for (const n of [9, 10]) await book(guest(n), trip('Marrakech e deserto di Agafay'));
    await book(guest(10), trip('Islanda: cascate, ghiacciai e sorgenti calde'), { confirm: true });
  });
  await scenario('Viaggio concluso con recensioni', async () => {
    const id = trip('Copenaghen: design, bici e hygge');
    const travellers = ['demo-premium', guest(1), guest(2), guest(3), guest(4)];
    for (const token of travellers) await book(token, id, { confirm: true, balance: token === 'demo-premium' });
    // Il viaggio si è svolto due mesi fa: le date si spostano all'indietro.
    const published = db.published.get(id);
    if (published) {
      const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
      Object.assign(published, { startDate: day(63), endDate: day(60) });
    }
    const reviews: Array<[string, number, number, string]> = [
      [guest(1), 5, 5, 'Organizzazione perfetta e gruppo affiatato: Nora conosce ogni caffè di Nørrebro.'],
      [guest(2), 5, 4, 'Il Louisiana da solo valeva il viaggio. Ritmo comodo, come promesso.'],
      [guest(3), 4, 4, 'Bello girare in bici con chi sa dove andare. Avrei aggiunto una sera libera.'],
      [guest(4), 5, 5, 'Prima volta in un viaggio di gruppo: mi sono trovata benissimo.'],
    ];
    for (const [token, coordinatorRating, tripRating, body] of reviews) await as(token, 'PUT', `/catalog/trips/${id}/review`, { coordinatorRating, tripRating, body });
    // Marta (Premium) l'ha fatto ma non l'ha ancora recensito: può provarlo lei.
  });
  await scenario('Follower e idee salvate', async () => {
    for (const token of ['demo-viaggiatrice', 'demo-premium', guest(1), guest(2), guest(3), guest(5), guest(7)]) {
      await as(token, 'PUT', '/catalog/coordinators/demo-coordinatore/follow', {});
    }
    for (const [token, coordinator] of [['demo-viaggiatrice', 'demo-chiara'], ['demo-premium', 'demo-elena'], [guest(2), 'demo-luca'], [guest(4), 'demo-matteo']]) {
      await as(token, 'PUT', `/catalog/coordinators/${coordinator}/follow`, {});
    }
    for (const title of ['Kyoto tra templi e botteghe', 'Islanda: cascate, ghiacciai e sorgenti calde', 'Dolomiti: rifugi e sentieri panoramici']) {
      await as('demo-viaggiatrice', 'PUT', `/me/saved-ideas/${trip(title)}`, {});
    }
    await as('demo-premium', 'PUT', `/me/saved-ideas/${trip('Scozia: Edimburgo e Highlands')}`, {});
  });
  await scenario('Viaggi personali pianificati', async () => {
    for (const [token, destination, departure, returnDate] of [['demo-viaggiatrice', 'Parigi, Francia', 30, 33], ['demo-premium', 'Barcellona, Spagna', 45, 49]] as const) {
      const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      const itinerary = await as(token, 'POST', '/itineraries/generate', { form: { ...FALLBACK_TRIP_FORM, destination, departure: day(departure), returnDate: day(returnDate) } });
      await as(token, 'POST', '/trips', { itinerary });
    }
  });
  await scenario('Split di Lisbona', async () => {
    const id = trip('Lisbona tra miradouros e azulejos');
    const view = await as<{ members: Array<{ userId: string }> }>('demo-premium', 'GET', `/split/${id}`);
    const everyone = view.members.map((member) => member.userId);
    await as('demo-premium', 'POST', `/split/${id}/expenses`, { description: 'Cena di benvenuto ad Alfama', category: 'food', amount: 186, among: everyone });
    await as('demo-premium', 'POST', `/split/${id}/expenses`, { description: 'Taxi dall’aeroporto', category: 'transport', amount: 32, among: everyone.slice(0, 3) });
    await as('demo-premium', 'POST', `/split/${id}/expenses`, { description: 'Ingresso al Museo degli Azulejos', category: 'activities', amount: 40, among: everyone.slice(0, 4) });
  });
  await scenario('Segnalazioni da moderare', async () => {
    const posts = [...db.creator.posts.values()].filter((item) => item.status === 'published');
    const matteo = posts.find((item) => item.authorId === 'demo-matteo');
    if (matteo) await as('demo-viaggiatrice', 'POST', '/reports', { targetKind: 'post', targetId: matteo.id, reason: 'misleading', details: 'La foto non sembra del luogo indicato.' });
    const elena = [...db.published.values()].find((item) => item.coordinatorId === 'demo-elena');
    if (elena) await as(guest(6), 'POST', '/reports', { targetKind: 'published_trip', targetId: elena.id, reason: 'other', details: 'Il prezzo nella descrizione non coincide con quello della scheda.' });
  });
}
