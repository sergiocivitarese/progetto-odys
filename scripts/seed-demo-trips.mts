/**
 * Pubblica nel catalogo "Viaggi di gruppo" dieci viaggi di esempio per le demo.
 * Gli itinerari sono generati dal motore dell'app (POST /api/itineraries/generate).
 *
 * Uso (con l'app avviata):  npx tsx scripts/seed-demo-trips.mts [--remove] [http://localhost:8080]
 * Rieseguirlo sostituisce gli esempi; `--remove` li elimina.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const root = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(readFileSync(path.join(root, 'apps/api/.env'), 'utf8').split(/\r?\n/)
  .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)).filter((match): match is RegExpExecArray => match !== null)
  .map((match) => [match[1], match[2]]));
const args = process.argv.slice(2);
const remove = args.includes('--remove');
const api = args.find((arg) => arg.startsWith('http')) ?? 'http://localhost:8080';

const url = new URL(env['SUPABASE_DB_URL'] ?? '');
if (env['SUPABASE_DB_PASSWORD']) url.password = encodeURIComponent(env['SUPABASE_DB_PASSWORD']);
const sql = postgres(url.toString(), { max: 1, onnotice: () => undefined, prepare: false });

interface Example {
  title: string; destination: string; start: string; end: string; price: number; capacity: number;
  pace: 'rilassato' | 'equilibrato' | 'intenso'; interests: string[]; transport: string; arrival: string;
  summary: string; included: string[]; excluded: string[];
}

const baseIncluded = ['Coordinatore Odys per tutto il viaggio', 'Pernottamenti in camera condivisa', 'Colazioni'];
const baseExcluded = ['Voli o treni per raggiungere la destinazione', 'Pranzi e cene non indicati', 'Assicurazione di viaggio', 'Spese personali'];

const examples: Example[] = [
  { title: 'Lisbona tra miradouros e azulejos', destination: 'Lisbona, Portogallo', start: '2026-11-12', end: '2026-11-16', price: 590, capacity: 12, pace: 'equilibrato', interests: ['Cibo', 'Arte', 'Storia'], transport: 'trasporto pubblico', arrival: 'aereo',
    summary: 'Cinque giorni a Lisbona tra Alfama, Belém e i quartieri creativi: tram storici, pastéis de nata e tramonti dai belvedere, con tempi comodi per perdersi a piedi.',
    included: [...baseIncluded, 'Tessera trasporti 72 ore', 'Degustazione di pastéis a Belém'], excluded: baseExcluded },
  { title: 'Costiera Amalfitana senza fretta', destination: 'Amalfi, Italia', start: '2027-04-22', end: '2027-04-26', price: 680, capacity: 10, pace: 'rilassato', interests: ['Natura', 'Cibo', 'Benessere'], transport: 'misto', arrival: 'treno',
    summary: 'Amalfi, Ravello e Positano a ritmo lento: Sentiero degli Dei, limoneti, un giorno in barca e cene vista mare. Pensato per chi vuole staccare davvero.',
    included: [...baseIncluded, 'Escursione in barca di mezza giornata', 'Visita a un limoneto con degustazione'], excluded: baseExcluded },
  { title: 'Kyoto tra templi e botteghe', destination: 'Kyoto, Giappone', start: '2027-03-27', end: '2027-04-03', price: 1240, capacity: 8, pace: 'equilibrato', interests: ['Storia', 'Arte', 'Design', 'Cibo'], transport: 'trasporto pubblico', arrival: 'aereo',
    summary: 'Otto giorni a Kyoto nel periodo dei ciliegi: Fushimi Inari all’alba, Arashiyama, cerimonia del tè e botteghe artigiane, con una giornata a Nara.',
    included: [...baseIncluded, 'Cerimonia del tè', 'Biglietti per i templi in programma', 'Treno per Nara'], excluded: baseExcluded },
  { title: 'Islanda: cascate, ghiacciai e sorgenti calde', destination: 'Reykjavík, Islanda', start: '2027-02-13', end: '2027-02-19', price: 1490, capacity: 9, pace: 'intenso', interests: ['Natura', 'Benessere'], transport: 'auto', arrival: 'aereo',
    summary: 'Sette giorni on the road sulla costa sud: Circolo d’Oro, Skógafoss, la spiaggia nera di Vík e la laguna glaciale, con caccia all’aurora e bagni termali.',
    included: [...baseIncluded, 'Auto a noleggio e carburante', 'Ingresso a una laguna termale'], excluded: baseExcluded },
  { title: 'Marrakech e deserto di Agafay', destination: 'Marrakech, Marocco', start: '2026-12-04', end: '2026-12-08', price: 540, capacity: 12, pace: 'equilibrato', interests: ['Cibo', 'Storia', 'Design'], transport: 'a piedi', arrival: 'aereo',
    summary: 'Cinque giorni tra i souk della Medina, i giardini Majorelle e una notte in tenda nel deserto di Agafay, con corso di cucina marocchina.',
    included: [...baseIncluded, 'Notte in campo tendato con cena', 'Corso di cucina', 'Transfer da e per l’aeroporto'], excluded: baseExcluded },
  { title: 'Dolomiti: rifugi e sentieri panoramici', destination: 'Ortisei, Italia', start: '2027-06-19', end: '2027-06-24', price: 720, capacity: 10, pace: 'intenso', interests: ['Natura', 'Benessere', 'Cibo'], transport: 'a piedi', arrival: 'auto',
    summary: 'Sei giorni di trekking in Val Gardena: Seceda, Alpe di Siusi e una notte in rifugio. Livello medio, tappe di 4–6 ore con dislivelli gestibili.',
    included: [...baseIncluded, 'Mezza pensione in rifugio', 'Guida escursionistica', 'Impianti di risalita in programma'], excluded: baseExcluded },
  { title: 'Sicilia orientale: barocco, Etna e mare', destination: 'Catania, Italia', start: '2027-05-08', end: '2027-05-14', price: 790, capacity: 12, pace: 'equilibrato', interests: ['Cibo', 'Storia', 'Natura'], transport: 'auto', arrival: 'aereo',
    summary: 'Sette giorni tra Catania, Siracusa, Noto e Taormina: escursione sull’Etna, mercati del pesce, granite e il barocco della Val di Noto.',
    included: [...baseIncluded, 'Escursione guidata sull’Etna', 'Minivan per gli spostamenti', 'Street food tour a Catania'], excluded: baseExcluded },
  { title: 'Copenaghen: design, bici e hygge', destination: 'Copenaghen, Danimarca', start: '2027-01-21', end: '2027-01-24', price: 460, capacity: 14, pace: 'rilassato', interests: ['Design', 'Arte', 'Cibo'], transport: 'trasporto pubblico', arrival: 'aereo',
    summary: 'Un weekend lungo tra Nyhavn, il Designmuseum e il Louisiana: architettura, caffè di quartiere e pedalate lungo i canali.',
    included: [...baseIncluded, 'Noleggio bici per due giorni', 'Ingresso al Louisiana Museum'], excluded: baseExcluded },
  { title: 'Atene e isole Saroniche', destination: 'Atene, Grecia', start: '2027-05-27', end: '2027-06-01', price: 640, capacity: 12, pace: 'equilibrato', interests: ['Storia', 'Cibo', 'Natura'], transport: 'traghetto', arrival: 'aereo',
    summary: 'Sei giorni tra l’Acropoli, i quartieri di Plaka e Psyrri e due giornate in traghetto a Idra ed Egina, tra bagni e taverne sul porto.',
    included: [...baseIncluded, 'Biglietto Acropoli e museo', 'Traghetti per Idra ed Egina'], excluded: baseExcluded },
  { title: 'Scozia: Edimburgo e Highlands', destination: 'Edimburgo, Regno Unito', start: '2027-07-10', end: '2027-07-17', price: 1090, capacity: 8, pace: 'intenso', interests: ['Natura', 'Storia', 'Cibo'], transport: 'auto', arrival: 'aereo',
    summary: 'Otto giorni tra il castello di Edimburgo, Glencoe, Loch Ness e l’isola di Skye: strade panoramiche, distillerie e camminate tra i glen.',
    included: [...baseIncluded, 'Minivan e carburante', 'Visita a una distilleria', 'Ingresso al castello di Edimburgo'], excluded: baseExcluded },
];

try {
  const [coordinator] = await sql<{ id: string; first_name: string }[]>`
    select id, first_name from public.profiles where role in ('coordinator', 'admin') and status = 'active' order by created_at limit 1`;
  if (!coordinator) throw new Error('Nessun coordinatore attivo: promuovi un account dalla dashboard Supabase.');
  const titles = examples.map((example) => example.title);
  const removed = await sql`delete from public.published_trips where coordinator_id = ${coordinator.id} and title in ${sql(titles)} returning id`;
  if (removed.length) console.log(`Rimossi ${removed.length} esempi precedenti.`);
  if (!remove) {
    for (const example of examples) {
      const form = {
        destination: example.destination, departure: example.start, returnDate: example.end, arrivalTime: '', departureTime: '',
        travelers: String(example.capacity), budget: `${example.price}€`, budgetPerTraveler: `${example.price}€`, pace: example.pace,
        interests: example.interests, customInterests: [], constraints: '', transport: example.transport, arrivalTransport: example.arrival,
        arrivalDayOffset: 0, arrivalDestinationKind: 'first-activity', stops: [], lodging: {},
      };
      const response = await fetch(`${api}/api/itineraries/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ form }) });
      if (!response.ok) throw new Error(`${example.title}: ${response.status} ${await response.text()}`);
      const itinerary = await response.json();
      const [row] = await sql<{ id: string }[]>`
        insert into public.published_trips (coordinator_id, status, title, summary, destination, start_date, end_date, price_cents, capacity, included, excluded, itinerary)
        values (${coordinator.id}, 'published', ${example.title}, ${example.summary}, ${example.destination}, ${example.start}, ${example.end},
                ${example.price * 100}, ${example.capacity}, ${example.included}, ${example.excluded}, ${sql.json(itinerary)})
        returning id`;
      console.log(`✅ ${example.title} · ${itinerary.days.length} giorni → ${api}/gruppi/${row.id}`);
    }
  }
  console.log(`\nCoordinatore: ${coordinator.first_name}`);
} catch (error) {
  console.error('\n❌', (error as Error).message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
