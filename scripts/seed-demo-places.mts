/**
 * Luoghi reali per un viaggio di esempio, per provare il giorno per ore, la
 * mappa del giorno e gli spostamenti (TP-05…TP-07).
 *
 * Sostituisce le attività segnaposto del viaggio pubblicato «Lisbona tra
 * miradouros e azulejos» con un programma vero: orari, durate e coordinate.
 * Serve la chiave service_role in apps/api/.env: lo script gira solo in locale.
 *
 * Uso (dalla radice):  npx tsx scripts/seed-demo-places.mts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(readFileSync(path.join(root, 'apps/api/.env'), 'utf8').split(/\r?\n/)
  .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)).filter((match): match is RegExpExecArray => match !== null)
  .map((match) => [match[1], match[2]]));
const db = createClient(env['SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY'], { auth: { persistSession: false, autoRefreshToken: false } });

const TRIP_TITLE = 'Lisbona tra miradouros e azulejos';

type Stop = [time: string, title: string, detail: string, category: string, duration: string, latitude: number, longitude: number];

const DAYS: Array<{ label: string; stops: Stop[] }> = [
  { label: 'Arrivo e Baixa', stops: [
    ['15:00', 'Check-in in Baixa', 'Hotel nel quartiere pombalino, a due passi da Rua Augusta.', 'Relax', '45 min', 38.7101, -9.1366],
    ['16:30', 'Praça do Comércio', 'La grande piazza sul Tago e l’Arco da Rua Augusta.', 'Storia', '1 h', 38.7075, -9.1364],
    ['18:00', 'Elevador de Santa Justa', 'Ascensore neogotico con vista sulla Baixa.', 'Storia', '45 min', 38.7121, -9.1394],
    ['20:00', 'Cena al Time Out Market', 'Cucina portoghese di quartiere sotto lo stesso tetto.', 'Cibo', '1 h 30 min', 38.7069, -9.1458],
  ] },
  { label: 'Alfama e Graça', stops: [
    ['09:30', 'Castelo de São Jorge', 'Mura moresche e la vista più ampia sulla città.', 'Storia', '2 h', 38.7139, -9.1335],
    ['12:00', 'Miradouro de Santa Luzia', 'Azulejos e bouganville sopra i tetti di Alfama.', 'Arte', '30 min', 38.7116, -9.1301],
    ['13:00', 'Pranzo in Alfama', 'Sardine e vinho verde in una tasca di quartiere.', 'Cibo', '1 h 30 min', 38.7113, -9.1287],
    ['15:30', 'Panteão Nacional', 'La cupola bianca di Santa Engrácia e la terrazza.', 'Storia', '1 h', 38.7149, -9.1247],
    ['18:00', 'Miradouro da Graça', 'Il tramonto dal belvedere più amato dai lisboeti.', 'Natura', '1 h', 38.7166, -9.1316],
  ] },
  { label: 'Belém', stops: [
    ['09:30', 'Mosteiro dos Jerónimos', 'Il chiostro manuelino, patrimonio UNESCO.', 'Storia', '2 h', 38.6979, -9.2068],
    ['12:00', 'Pastéis de Belém', 'I pastéis de nata della ricetta originale del 1837.', 'Cibo', '45 min', 38.6975, -9.2032],
    ['13:30', 'Torre de Belém', 'La torre sul fiume da cui partivano le caravelle.', 'Storia', '1 h', 38.6916, -9.216],
    ['15:30', 'MAAT', 'Museo di arte, architettura e tecnologia sul lungofiume.', 'Design', '1 h 30 min', 38.6957, -9.1934],
    ['18:00', 'LX Factory', 'Ex fabbrica tessile con librerie, studi e locali.', 'Design', '1 h 30 min', 38.7036, -9.1784],
  ] },
  { label: 'Azulejos e Príncipe Real', stops: [
    ['10:00', 'Museu Nacional do Azulejo', 'Cinque secoli di piastrelle in un convento del Cinquecento.', 'Arte', '2 h', 38.7247, -9.1137],
    ['13:00', 'Pranzo a Príncipe Real', 'Bistrot e botteghe nel quartiere più verde.', 'Cibo', '1 h', 38.7168, -9.149],
    ['14:30', 'Jardim do Príncipe Real', 'Il cedro gigante e il serbatoio ottocentesco sotto il giardino.', 'Natura', '45 min', 38.7166, -9.1487],
    ['15:30', 'Bairro Alto', 'Vicoli in salita, negozi indipendenti e street art.', 'Arte', '1 h 30 min', 38.7131, -9.1447],
    ['18:30', 'Miradouro de São Pedro de Alcântara', 'Il belvedere sul castello alla luce della sera.', 'Natura', '45 min', 38.7155, -9.1446],
  ] },
  { label: 'Tram 28 e partenza', stops: [
    ['09:00', 'Tram 28 da Martim Moniz', 'Il giro classico sul tram giallo, prima della folla.', 'Storia', '1 h', 38.7166, -9.136],
    ['10:30', 'Mercado da Ribeira', 'Ultimi acquisti: conserve, ginjinha e formaggi.', 'Cibo', '1 h', 38.7069, -9.1458],
    ['12:00', 'Check-out', 'Bagagli e saluti al gruppo.', 'Relax', '30 min', 38.7101, -9.1366],
    ['13:00', 'Aeroporto Humberto Delgado', 'Metro rossa o taxi: 25 minuti dal centro.', 'Altro', '45 min', 38.7742, -9.1342],
  ] },
];

const { data: trip, error } = await db.from('published_trips').select('id, itinerary').eq('title', TRIP_TITLE).maybeSingle();
if (error || !trip) {
  console.error('❌ Viaggio non trovato:', error?.message ?? TRIP_TITLE);
  process.exit(1);
}
const itinerary = trip.itinerary as { days: Array<Record<string, unknown>>; [key: string]: unknown };
itinerary.destinationNode = { id: 'osm-relation-5400890', label: 'Lisbona, Portogallo', type: 'final', city: 'Lisbona', country: 'Portogallo', latitude: 38.7077, longitude: -9.1366, osmId: 'relation/5400890', source: 'OpenStreetMap', reliabilityStatus: 'VERIFIED', geoStatus: 'CONFIRMED' };
itinerary.days = itinerary.days.map((day, index) => {
  const plan = DAYS[index];
  if (!plan) return day;
  return {
    ...day,
    label: plan.label,
    // Niente tratte segnaposto: gli spostamenti tra tappe li propone il giorno per ore.
    segments: [],
    activities: plan.stops.map(([time, title, detail, category, duration, latitude, longitude], order) => ({
      time, title, detail, category, duration, order,
      place: { id: `lisbona-${index + 1}-${order + 1}`, title, city: 'Lisbona', country: 'Portogallo', latitude, longitude, source: 'Esempio Odys', geoStatus: 'CONFIRMED' },
    })),
  };
});
const { error: updateError } = await db.from('published_trips').update({ itinerary }).eq('id', trip.id);
if (updateError) {
  console.error('❌', updateError.message);
  process.exit(1);
}
console.log(`✅ ${TRIP_TITLE}: ${DAYS.reduce((sum, day) => sum + day.stops.length, 0)} luoghi reali su ${DAYS.length} giorni (/gruppi/${trip.id}/giorno/1)`);
