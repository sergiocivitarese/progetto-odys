/**
 * Contenuti di esempio per provare il Creator Studio e il feed Esplora.
 *
 *   - 8 post del primo coordinatore (il tuo account), collegati ai suoi viaggi,
 *     con un post programmato e una bozza per provare la bacheca privata;
 *   - 4 coordinatori dimostrativi (email @odys-demo.example, non reali), ognuno con
 *     un viaggio pubblicato e 3 post; like incrociati tra gli account dimostrativi.
 *
 * Le immagini sono illustrazioni generate qui (nessuna foto scaricata), marcate
 * "Esempio Odys". Serve l'API in esecuzione (per generare gli itinerari) e la
 * chiave service_role in apps/api/.env: lo script gira solo in locale.
 *
 * Uso (dalla radice):  npx tsx scripts/seed-demo-creators.mts [--remove] [http://localhost:3000]
 * Rieseguirlo sostituisce gli esempi; `--remove` li elimina.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(readFileSync(path.join(root, 'apps/api/.env'), 'utf8').split(/\r?\n/)
  .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)).filter((match): match is RegExpExecArray => match !== null)
  .map((match) => [match[1], match[2]]));
const args = process.argv.slice(2);
const remove = args.includes('--remove');
const api = args.find((arg) => arg.startsWith('http')) ?? 'http://localhost:3000';
const DEMO_DOMAIN = 'odys-demo.example';
const BUCKET = 'creator-media';
const manifestFile = path.join(root, 'apps/api/data/demo-creator-posts.json');

if (!env['SUPABASE_URL'] || !env['SUPABASE_SERVICE_ROLE_KEY']) {
  console.error('Servono SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY in apps/api/.env.');
  process.exit(1);
}
const db: SupabaseClient = createClient(env['SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY'], { auth: { persistSession: false, autoRefreshToken: false } });

// ---------------------------------------------------------------------------
// Illustrazioni (SVG → JPEG/WebP): scene semplici per tipo di luogo
// ---------------------------------------------------------------------------
type Scene = 'sea' | 'mountains' | 'city' | 'desert' | 'aurora' | 'hills' | 'temple';
interface Art { scene: Scene; sky: [string, string]; accent: string; ground: string; label: string }

const W = 1080;
const H = 1350;

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}

function layers(art: Art, seed: number): string {
  const r = (n: number) => ((Math.sin(seed * 97 + n * 13.7) + 1) / 2);
  switch (art.scene) {
    case 'sea':
      return `<circle cx="${700 + r(1) * 200}" cy="${420 + r(2) * 120}" r="120" fill="${art.accent}"/>
        <path d="M0 860 Q270 800 540 860 T1080 860 V1350 H0Z" fill="${art.ground}" opacity="0.85"/>
        <path d="M0 960 Q270 900 540 960 T1080 960 V1350 H0Z" fill="${art.ground}"/>
        <path d="M0 1080 Q270 1030 540 1080 T1080 1080 V1350 H0Z" fill="#0b1b3a" opacity="0.55"/>`;
    case 'mountains':
      return `<circle cx="${260 + r(1) * 300}" cy="330" r="90" fill="${art.accent}"/>
        <path d="M-40 1000 L260 520 L460 820 L640 460 L1120 1000Z" fill="${art.ground}" opacity="0.7"/>
        <path d="M640 460 L700 560 L660 560 L620 520Z" fill="#fff" opacity="0.9"/>
        <path d="M-40 1350 L-40 1040 L320 780 L600 1000 L860 760 L1120 980 L1120 1350Z" fill="${art.ground}"/>`;
    case 'city':
      return `<circle cx="${760 + r(1) * 120}" cy="380" r="110" fill="${art.accent}"/>
        ${Array.from({ length: 9 }, (_, i) => { const h = 260 + r(i + 3) * 380; const x = i * 125 - 20; return `<rect x="${x}" y="${1050 - h}" width="${100 + r(i) * 40}" height="${h + 300}" fill="${art.ground}" opacity="${0.75 + r(i + 9) * 0.25}"/>`; }).join('')}
        <rect x="0" y="1050" width="1080" height="300" fill="#111"/>`;
    case 'desert':
      return `<circle cx="540" cy="${460 + r(1) * 80}" r="150" fill="${art.accent}"/>
        <path d="M0 900 Q300 760 620 900 T1080 860 V1350 H0Z" fill="${art.ground}" opacity="0.75"/>
        <path d="M0 1040 Q360 900 760 1040 T1080 1000 V1350 H0Z" fill="${art.ground}"/>`;
    case 'aurora':
      return `<path d="M-50 420 C200 260 420 520 640 360 S1000 300 1130 420 L1130 520 C900 420 760 600 520 480 S120 440 -50 560Z" fill="${art.accent}" opacity="0.55"/>
        <path d="M-50 560 C260 420 480 640 760 500 S1040 480 1130 560 L1130 610 C880 560 700 700 460 600 S100 600 -50 660Z" fill="${art.accent}" opacity="0.3"/>
        <path d="M-40 1350 L-40 980 L220 760 L420 940 L700 700 L1120 1000 L1120 1350Z" fill="${art.ground}"/>`;
    case 'hills':
      return `<circle cx="${300 + r(1) * 400}" cy="360" r="100" fill="${art.accent}"/>
        <path d="M0 880 Q260 760 540 860 T1080 820 V1350 H0Z" fill="${art.ground}" opacity="0.6"/>
        <path d="M0 980 Q320 860 620 980 T1080 960 V1350 H0Z" fill="${art.ground}" opacity="0.85"/>
        <path d="M0 1100 Q300 1020 600 1100 T1080 1080 V1350 H0Z" fill="${art.ground}"/>`;
    case 'temple':
      return `<circle cx="760" cy="400" r="130" fill="${art.accent}"/>
        <rect x="300" y="700" width="480" height="40" fill="${art.ground}"/>
        <path d="M260 700 L540 600 L820 700Z" fill="${art.ground}"/>
        <rect x="360" y="740" width="40" height="320" fill="${art.ground}"/><rect x="680" y="740" width="40" height="320" fill="${art.ground}"/>
        <rect x="320" y="760" width="440" height="30" fill="${art.ground}"/>
        <rect x="0" y="1060" width="1080" height="290" fill="${art.ground}" opacity="0.9"/>`;
  }
}

function svg(art: Art, seed: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- Scritte dentro il quadrato centrale: restano visibili anche nella miniatura ritagliata. -->
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${art.sky[0]}"/><stop offset="1" stop-color="${art.sky[1]}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${layers(art, seed)}
  <text x="64" y="1130" font-family="Arial Black, Arial, sans-serif" font-size="64" fill="#fff">${escapeXml(art.label)}</text>
  <text x="64" y="1178" font-family="Arial, sans-serif" font-size="28" fill="#fff" opacity="0.85">Esempio Odys · illustrazione</text>
</svg>`;
}

async function renderImages(art: Art, seed: number) {
  const base = sharp(Buffer.from(svg(art, seed)));
  const original = await base.clone().jpeg({ quality: 86 }).toBuffer();
  const display = await base.clone().webp({ quality: 84 }).toBuffer();
  const thumbnail = await base.clone().resize(480, 480, { fit: 'cover', position: 'centre' }).webp({ quality: 80 }).toBuffer();
  return { original, display, thumbnail };
}

// ---------------------------------------------------------------------------
// Dati di esempio
// ---------------------------------------------------------------------------
const PALETTES: Record<Scene, Omit<Art, 'scene' | 'label'>> = {
  sea: { sky: ['#ffb36b', '#ff7a7a'], accent: '#fff3b0', ground: '#1f5fbf' },
  mountains: { sky: ['#9fd3ff', '#e9f6ff'], accent: '#fff', ground: '#2f4858' },
  city: { sky: ['#ff9a8b', '#ffcfa3'], accent: '#ffe066', ground: '#3d2c4f' },
  desert: { sky: ['#ff8c42', '#ffd166'], accent: '#fff4d6', ground: '#c46a2b' },
  aurora: { sky: ['#0b1d3a', '#1d3b5f'], accent: '#3ce0a8', ground: '#071426' },
  hills: { sky: ['#bde0fe', '#fef9ef'], accent: '#ffd166', ground: '#3a7d44' },
  temple: { sky: ['#ffd6e0', '#ffeef2'], accent: '#ff5d73', ground: '#7a2e3a' },
};

interface PostSpec {
  caption: string;
  place: { label: string; latitude: number; longitude: number };
  scenes: Scene[];
  trip?: string; // titolo del viaggio pubblicato dell'autore
  status?: 'published' | 'scheduled' | 'draft';
  daysAgo: number;
}

interface DemoCoordinator {
  key: string;
  firstName: string;
  lastName: string;
  headline: string;
  bio: string;
  interests: string[];
  trip: { title: string; destination: string; summary: string; start: string; end: string; price: number; capacity: number; included: string[]; excluded: string[] };
  posts: PostSpec[];
}

const OWNER_POSTS: PostSpec[] = [
  { caption: 'Il tram 28 all’ora d’oro, poi su al Miradouro da Graça. A Lisbona il tramonto si guarda dall’alto: nel viaggio di novembre lo facciamo ogni sera da un belvedere diverso.', place: { label: 'Miradouro da Graça, Lisbona', latitude: 38.7166, longitude: -9.1316 }, scenes: ['sea', 'city', 'hills'], trip: 'Lisbona tra miradouros e azulejos', daysAgo: 2 },
  { caption: 'Prima notte nel deserto di Agafay: cena berbera, silenzio e un cielo pieno di stelle. A soli 40 minuti da Marrakech.', place: { label: 'Deserto di Agafay, Marocco', latitude: 31.4667, longitude: -8.1833 }, scenes: ['desert', 'desert'], trip: 'Marrakech e deserto di Agafay', daysAgo: 4 },
  { caption: 'Copenaghen in bici è un’altra città: piste ovunque, soste nei caffè di Nørrebro e il porto al tramonto.', place: { label: 'Nyhavn, Copenaghen', latitude: 55.6798, longitude: 12.5911 }, scenes: ['city'], trip: 'Copenaghen: design, bici e hygge', daysAgo: 6 },
  { caption: 'Skógafoss, laguna glaciale e, se il cielo collabora, l’aurora. Sette giorni sulla costa sud dell’Islanda in piccolo gruppo.', place: { label: 'Jökulsárlón, Islanda', latitude: 64.0784, longitude: -16.2306 }, scenes: ['aurora', 'mountains', 'sea'], trip: 'Islanda: cascate, ghiacciai e sorgenti calde', daysAgo: 9 },
  { caption: 'Fushimi Inari all’alba, prima della folla: diecimila torii e solo il rumore dei passi. Si parte a fine marzo, con i ciliegi.', place: { label: 'Fushimi Inari, Kyoto', latitude: 34.9671, longitude: 135.7727 }, scenes: ['temple', 'hills'], trip: 'Kyoto tra templi e botteghe', daysAgo: 12 },
  { caption: 'Il Sentiero degli Dei da Bomerano a Nocelle: tre ore sospesi sopra il mare, con Positano che compare all’ultima curva.', place: { label: 'Sentiero degli Dei, Agerola', latitude: 40.6326, longitude: 14.5214 }, scenes: ['sea'], trip: 'Costiera Amalfitana senza fretta', daysAgo: 15 },
  { caption: 'Granita al pistacchio e brioche a Catania, poi su fino ai crateri dell’Etna. Il programma completo è nel viaggio collegato.', place: { label: 'Etna, Sicilia', latitude: 37.751, longitude: 14.9934 }, scenes: ['mountains', 'sea'], trip: 'Sicilia orientale: barocco, Etna e mare', status: 'scheduled', daysAgo: 0 },
  { caption: 'Bozza: foto del sopralluogo in Val Gardena, da completare con il percorso definitivo.', place: { label: 'Seceda, Val Gardena', latitude: 46.6006, longitude: 11.7232 }, scenes: ['mountains'], trip: 'Dolomiti: rifugi e sentieri panoramici', status: 'draft', daysAgo: 0 },
];

const COMMON_INCLUDED = ['Coordinatore per tutto il viaggio', 'Pernottamenti in camera condivisa', 'Colazioni'];
const COMMON_EXCLUDED = ['Viaggio per raggiungere la partenza', 'Pasti non indicati', 'Assicurazione di viaggio'];

const DEMO_COORDINATORS: DemoCoordinator[] = [
  {
    key: 'chiara', firstName: 'Chiara', lastName: 'Esposito', headline: 'Mare, bici e cucina del Sud',
    bio: 'Account di esempio creato per provare Odys. Organizzo viaggi lenti in Puglia e Campania, tra spiagge poco note e masserie.',
    interests: ['Mare', 'Cibo', 'Bici'],
    trip: { title: 'Salento in bici tra masserie e mare', destination: 'Lecce, Italia', summary: 'Sei giorni in bici elettrica tra Lecce, Otranto e Santa Maria di Leuca, con soste in masseria e bagni nelle calette.', start: '2027-05-15', end: '2027-05-20', price: 760, capacity: 10, included: [...COMMON_INCLUDED, 'Bici elettrica e assistenza'], excluded: COMMON_EXCLUDED },
    posts: [
      { caption: 'La costa tra Otranto e Leuca vista dalla bici: 30 km di saliscendi e almeno tre bagni lungo la strada.', place: { label: 'Otranto, Puglia', latitude: 40.1439, longitude: 18.4911 }, scenes: ['sea', 'hills'], trip: 'Salento in bici tra masserie e mare', daysAgo: 1 },
      { caption: 'Pranzo in masseria: orecchiette, pomodori del giardino e olio nuovo. Il motivo per cui si torna.', place: { label: 'Masseria nei dintorni di Lecce', latitude: 40.3515, longitude: 18.175 }, scenes: ['hills'], daysAgo: 7 },
      { caption: 'Procida all’alba, prima dei traghetti delle 9. Piccola, colorata, perfetta per un fine settimana.', place: { label: 'Marina Corricella, Procida', latitude: 40.7609, longitude: 14.0281 }, scenes: ['sea', 'city'], daysAgo: 20 },
    ],
  },
  {
    key: 'luca', firstName: 'Luca', lastName: 'Ferri', headline: 'Trekking e rifugi sulle Alpi',
    bio: 'Account di esempio creato per provare Odys. Accompagnatore di media montagna: giri ad anello, rifugi e tappe alla portata di tutti.',
    interests: ['Natura', 'Trekking', 'Montagna'],
    trip: { title: 'Tour del Monte Rosa in cinque tappe', destination: 'Gressoney, Italia', summary: 'Cinque giorni da rifugio a rifugio tra Valle d’Aosta e Vallese, con il Monte Rosa sempre davanti agli occhi.', start: '2027-07-12', end: '2027-07-16', price: 690, capacity: 8, included: [...COMMON_INCLUDED, 'Mezza pensione in rifugio', 'Accompagnatore di media montagna'], excluded: COMMON_EXCLUDED },
    posts: [
      { caption: 'Terza tappa del giro: il Col d’Olen alle 7 del mattino, il Monte Rosa che si accende piano piano.', place: { label: 'Col d’Olen, Valle d’Aosta', latitude: 45.8676, longitude: 7.8742 }, scenes: ['mountains', 'mountains'], trip: 'Tour del Monte Rosa in cinque tappe', daysAgo: 3 },
      { caption: 'Cosa mettere nello zaino per cinque giorni di rifugi: la lista che mando a chi parte con me.', place: { label: 'Rifugio Quintino Sella, Gressoney', latitude: 45.8854, longitude: 7.7944 }, scenes: ['mountains'], daysAgo: 10 },
      { caption: 'Le Tre Cime di Lavaredo da Forcella Lavaredo, un classico che non stanca mai. Giro ad anello di quattro ore.', place: { label: 'Tre Cime di Lavaredo', latitude: 46.6187, longitude: 12.3022 }, scenes: ['mountains', 'hills'], daysAgo: 18 },
    ],
  },
  {
    key: 'matteo', firstName: 'Matteo', lastName: 'Conti', headline: 'Capitali europee in treno',
    bio: 'Account di esempio creato per provare Odys. Viaggi in treno tra le città d’Europa: musei, quartieri e mercati.',
    interests: ['Arte', 'Storia', 'Treni'],
    trip: { title: 'Berlino e Praga in treno', destination: 'Berlino, Germania', summary: 'Sette giorni tra Berlino e Praga viaggiando in treno: musei, quartieri alternativi, birrerie storiche e il ponte Carlo all’alba.', start: '2027-04-08', end: '2027-04-14', price: 820, capacity: 12, included: [...COMMON_INCLUDED, 'Biglietti del treno Berlino–Praga'], excluded: COMMON_EXCLUDED },
    posts: [
      { caption: 'East Side Gallery di mattina presto: un chilometro e mezzo di murales senza gruppi davanti.', place: { label: 'East Side Gallery, Berlino', latitude: 52.505, longitude: 13.4397 }, scenes: ['city', 'city'], trip: 'Berlino e Praga in treno', daysAgo: 5 },
      { caption: 'Il ponte Carlo alle 6: luce morbida, statue e nessuno intorno. Vale la sveglia, promesso.', place: { label: 'Ponte Carlo, Praga', latitude: 50.0865, longitude: 14.4114 }, scenes: ['city'], trip: 'Berlino e Praga in treno', daysAgo: 13 },
      { caption: 'Vienna in un weekend: caffè storici, Belvedere e una sera all’opera in piedi a pochi euro.', place: { label: 'Belvedere, Vienna', latitude: 48.1916, longitude: 16.3809 }, scenes: ['temple', 'city'], daysAgo: 25 },
    ],
  },
  {
    key: 'elena', firstName: 'Elena', lastName: 'Marino', headline: 'Nord Europa, fiordi e aurore',
    bio: 'Account di esempio creato per provare Odys. Porto piccoli gruppi in Norvegia e Lapponia, d’estate e d’inverno.',
    interests: ['Natura', 'Fotografia', 'Nord'],
    trip: { title: 'Lofoten slow: villaggi di pescatori e aurore', destination: 'Svolvær, Norvegia', summary: 'Sei giorni alle Lofoten in rorbu sul mare: escursioni brevi, villaggi di pescatori e caccia all’aurora boreale.', start: '2027-02-20', end: '2027-02-25', price: 1380, capacity: 8, included: [...COMMON_INCLUDED, 'Minivan e carburante', 'Uscita fotografica notturna'], excluded: COMMON_EXCLUDED },
    posts: [
      { caption: 'Reine alle 16 di febbraio: la luce dura poco, ma che luce. E la sera, se il cielo si apre, l’aurora.', place: { label: 'Reine, Lofoten', latitude: 67.9325, longitude: 13.0889 }, scenes: ['aurora', 'mountains', 'sea'], trip: 'Lofoten slow: villaggi di pescatori e aurore', daysAgo: 2 },
      { caption: 'Tre consigli per fotografare l’aurora con il telefono: treppiede, modalità notte e tanta pazienza.', place: { label: 'Tromsø, Norvegia', latitude: 69.6492, longitude: 18.9553 }, scenes: ['aurora'], daysAgo: 8 },
      { caption: 'Geirangerfjord dal belvedere di Flydalsjuvet: il fiordo più fotografato della Norvegia, a ragione.', place: { label: 'Geirangerfjord, Norvegia', latitude: 62.1008, longitude: 7.206 }, scenes: ['mountains', 'sea'], daysAgo: 16 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Operazioni
// ---------------------------------------------------------------------------
interface Manifest { ownerPostIds: string[] }

function readManifest(): Manifest {
  try { return JSON.parse(readFileSync(manifestFile, 'utf8')) as Manifest; } catch { return { ownerPostIds: [] }; }
}

async function check<T>(label: string, result: { data: T; error: { message: string } | null }): Promise<T> {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

/** Caricamento con qualche tentativo: l'archivio a volte risponde con errori temporanei (502). */
async function upload(key: string, body: Buffer, contentType: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const { error } = await db.storage.from(BUCKET).upload(key, body, { contentType, upsert: true });
    if (!error) return;
    if (attempt === 4) throw new Error(`file ${key}: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
  }
}

async function removeFolder(prefix: string): Promise<void> {
  const { data: entries } = await db.storage.from(BUCKET).list(prefix, { limit: 1000 });
  for (const entry of entries ?? []) {
    const full = `${prefix}/${entry.name}`;
    if (entry.id) await db.storage.from(BUCKET).remove([full]);
    else await removeFolder(full);
  }
}

async function removeExamples(): Promise<void> {
  const manifest = readManifest();
  for (const postId of manifest.ownerPostIds) {
    const { data: post } = await db.from('creator_posts').select('author_id').eq('id', postId).maybeSingle();
    if (!post) continue;
    await removeFolder(`${post.author_id}/${postId}`);
    await db.from('creator_posts').delete().eq('id', postId);
  }
  writeFileSync(manifestFile, JSON.stringify({ ownerPostIds: [] }, null, 2));
  const users = await check('elenco utenti', await db.auth.admin.listUsers({ perPage: 1000 }));
  for (const user of users.users.filter((item) => item.email?.endsWith(`@${DEMO_DOMAIN}`))) {
    await removeFolder(user.id);
    await check('eliminazione utente', await db.auth.admin.deleteUser(user.id));
  }
}

async function createDemoCoordinator(spec: DemoCoordinator): Promise<string> {
  const { user } = await check('creazione utente', await db.auth.admin.createUser({
    email: `${spec.key}@${DEMO_DOMAIN}`,
    // Password casuale mai mostrata: gli account dimostrativi non servono per accedere.
    password: randomBytes(24).toString('base64url'),
    email_confirm: true,
    user_metadata: { first_name: spec.firstName, last_name: spec.lastName, birth_date: '1988-04-12', accepted_terms: true, consent_version: '2026-10' },
  }));
  if (!user) throw new Error('Utente non creato.');
  await check('profilo', await db.from('profiles').update({ role: 'coordinator', bio: spec.bio, public_headline: spec.headline, interests: spec.interests }).eq('id', user.id));
  await check('linee guida', await db.from('consents').insert({ user_id: user.id, kind: 'coordinator_guidelines', version: 'linee-guida-2026-10', granted: true }));
  return user.id;
}

async function publishTrip(coordinatorId: string, trip: DemoCoordinator['trip']): Promise<string> {
  const form = {
    destination: trip.destination, departure: trip.start, returnDate: trip.end, arrivalTime: '', departureTime: '', travelers: String(trip.capacity),
    pace: 'equilibrato', interests: ['Natura', 'Cibo'], customInterests: [], transport: 'misto', arrivalTransport: 'treno', arrivalDayOffset: 0,
    arrivalDestinationKind: 'first-activity', stops: [], lodging: {},
  };
  const response = await fetch(`${api}/api/itineraries/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ form }) });
  if (!response.ok) throw new Error(`Generazione itinerario: ${response.status} (l'API è avviata su ${api}?)`);
  const itinerary = await response.json();
  const row = await check('viaggio pubblicato', await db.from('published_trips').insert({
    coordinator_id: coordinatorId, status: 'published', title: trip.title, summary: trip.summary, destination: trip.destination,
    start_date: trip.start, end_date: trip.end, price_cents: trip.price * 100, capacity: trip.capacity, included: trip.included, excluded: trip.excluded, itinerary,
  }).select('id').single());
  return row.id as string;
}

async function createPost(authorId: string, spec: PostSpec, trips: Map<string, string>, seed: number): Promise<string> {
  const tripId = spec.trip ? trips.get(spec.trip) : undefined;
  const post = await check('post', await db.from('creator_posts').insert({
    author_id: authorId, caption: spec.caption, location_label: spec.place.label, location_latitude: spec.place.latitude, location_longitude: spec.place.longitude,
    published_trip_id: tripId ?? null, rights_confirmed_at: new Date().toISOString(),
  }).select('id').single());
  const postId = post.id as string;
  for (const [index, scene] of spec.scenes.entries()) {
    const mediaId = randomUUID();
    const prefix = `${authorId}/${postId}/${mediaId}`;
    const images = await renderImages({ scene, ...PALETTES[scene], label: spec.place.label.split(',')[0] }, seed * 10 + index);
    for (const [name, body, type] of [['original.jpg', images.original, 'image/jpeg'], ['display.webp', images.display, 'image/webp'], ['thumbnail.webp', images.thumbnail, 'image/webp']] as const) {
      await upload(`${prefix}/${name}`, body, type);
    }
    await check('media', await db.from('creator_post_media').insert({
      id: mediaId, post_id: postId, author_id: authorId, kind: 'image', mime_type: 'image/jpeg', width: W, height: H, size_bytes: images.original.length,
      sort_order: index, original_key: `${prefix}/original.jpg`, display_key: `${prefix}/display.webp`, thumbnail_key: `${prefix}/thumbnail.webp`, status: 'ready',
    }));
  }
  const status = spec.status ?? 'published';
  if (status === 'scheduled') {
    await check('programmazione', await db.from('creator_posts').update({ status: 'scheduled', scheduled_for: new Date(Date.now() + 2 * 86_400_000).toISOString() }).eq('id', postId));
  } else if (status === 'published') {
    await check('pubblicazione', await db.from('creator_posts').update({ status: 'published' }).eq('id', postId));
    // Date di pubblicazione distribuite nel tempo, per un feed realistico.
    await check('data', await db.from('creator_posts').update({ published_at: new Date(Date.now() - spec.daysAgo * 86_400_000 - seed * 3_600_000).toISOString() }).eq('id', postId));
  }
  return postId;
}

try {
  await removeExamples();
  if (remove) {
    console.log('✅ Esempi rimossi.');
  } else {
    // Il tuo account: il primo coordinatore registrato (lo stesso di seed-demo-trips).
    const owner = await check('coordinatore', await db.from('profiles').select('id, first_name').eq('role', 'coordinator').eq('status', 'active').order('created_at').limit(1).maybeSingle());
    if (!owner) throw new Error('Nessun coordinatore attivo.');
    const ownerTrips = await check('viaggi', await db.from('published_trips').select('id, title').eq('coordinator_id', owner.id));
    const ownerTripIds = new Map((ownerTrips ?? []).map((trip) => [trip.title as string, trip.id as string]));
    const manifest: Manifest = { ownerPostIds: [] };
    let seed = 1;
    for (const spec of OWNER_POSTS) {
      manifest.ownerPostIds.push(await createPost(owner.id as string, spec, ownerTripIds, seed++));
      process.stdout.write('.');
    }
    if (!existsSync(path.dirname(manifestFile))) mkdirSync(path.dirname(manifestFile), { recursive: true });
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

    const demoIds: string[] = [];
    const publicPosts: string[] = [];
    for (const coordinator of DEMO_COORDINATORS) {
      const id = await createDemoCoordinator(coordinator);
      demoIds.push(id);
      const tripId = await publishTrip(id, coordinator.trip);
      for (const spec of coordinator.posts) {
        publicPosts.push(await createPost(id, spec, new Map([[coordinator.trip.title, tripId]]), seed++));
        process.stdout.write('.');
      }
    }
    // Like incrociati tra gli account dimostrativi (mai a nome tuo).
    const likes = publicPosts.concat(manifest.ownerPostIds.slice(0, 6)).flatMap((postId, index) =>
      demoIds.filter((_, i) => (index + i) % 3 !== 0).map((userId) => ({ user_id: userId, post_id: postId })));
    await check('like', await db.from('creator_post_likes').upsert(likes));
    console.log(`\n✅ ${manifest.ownerPostIds.length} post per ${owner.first_name} (6 pubblicati, 1 programmato, 1 bozza)`);
    console.log(`✅ ${DEMO_COORDINATORS.length} coordinatori dimostrativi, ${DEMO_COORDINATORS.length} viaggi e ${publicPosts.length} post pubblicati, ${likes.length} like`);
  }
} catch (error) {
  console.error('\n❌', (error as Error).message);
  process.exitCode = 1;
}
