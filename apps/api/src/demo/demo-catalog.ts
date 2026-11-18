/**
 * Catalogo di esempio di Odys: dieci viaggi di gruppo, quattro coordinatori
 * dimostrativi con il loro viaggio e i loro post, e le illustrazioni dei post
 * (SVG generati qui, nessuna foto scaricata, marcati «Esempio Odys»).
 *
 * Usato dalla modalità demo (seedDemoData) e dagli script che popolano un
 * progetto Supabase (scripts/seed-demo-trips.mts, scripts/seed-demo-creators.mts).
 */

export interface ExampleTrip {
  title: string; destination: string; start: string; end: string; price: number; capacity: number;
  pace: 'rilassato' | 'equilibrato' | 'intenso'; interests: string[]; transport: string; arrival: string;
  summary: string; included: string[]; excluded: string[];
}

const baseIncluded = ['Coordinatore Odys per tutto il viaggio', 'Pernottamenti in camera condivisa', 'Colazioni'];
const baseExcluded = ['Voli o treni per raggiungere la destinazione', 'Pranzi e cene non indicati', 'Assicurazione di viaggio', 'Spese personali'];

export const EXAMPLE_TRIPS: ExampleTrip[] = [
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

/** Modulo del generatore per un viaggio di esempio (stessi campi del planner). */
export function exampleTripForm(example: ExampleTrip, start = example.start, end = example.end) {
  return {
    destination: example.destination, departure: start, returnDate: end, arrivalTime: '', departureTime: '',
    travelers: String(example.capacity), budget: `${example.price}€`, budgetPerTraveler: `${example.price}€`, pace: example.pace,
    interests: example.interests, customInterests: [], constraints: '', transport: example.transport, arrivalTransport: example.arrival,
    arrivalDayOffset: 0, arrivalDestinationKind: 'first-activity', stops: [], lodging: {},
  };
}

// ---------------------------------------------------------------------------
// Illustrazioni dei post: scene semplici per tipo di luogo
// ---------------------------------------------------------------------------
export type Scene = 'sea' | 'mountains' | 'city' | 'desert' | 'aurora' | 'hills' | 'temple';
export interface Art { scene: Scene; sky: [string, string]; accent: string; ground: string; label: string }

export const ART_WIDTH = 1080;
export const ART_HEIGHT = 1350;

export const PALETTES: Record<Scene, Omit<Art, 'scene' | 'label'>> = {
  sea: { sky: ['#ffb36b', '#ff7a7a'], accent: '#fff3b0', ground: '#1f5fbf' },
  mountains: { sky: ['#9fd3ff', '#e9f6ff'], accent: '#fff', ground: '#2f4858' },
  city: { sky: ['#ff9a8b', '#ffcfa3'], accent: '#ffe066', ground: '#3d2c4f' },
  desert: { sky: ['#ff8c42', '#ffd166'], accent: '#fff4d6', ground: '#c46a2b' },
  aurora: { sky: ['#0b1d3a', '#1d3b5f'], accent: '#3ce0a8', ground: '#071426' },
  hills: { sky: ['#bde0fe', '#fef9ef'], accent: '#ffd166', ground: '#3a7d44' },
  temple: { sky: ['#ffd6e0', '#ffeef2'], accent: '#ff5d73', ground: '#7a2e3a' },
};

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

/** Illustrazione 1080×1350 di una scena; le scritte stanno nel quadrato centrale, visibili anche nella miniatura. */
export function artSvg(art: Art, seed: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ART_WIDTH}" height="${ART_HEIGHT}" viewBox="0 0 ${ART_WIDTH} ${ART_HEIGHT}">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${art.sky[0]}"/><stop offset="1" stop-color="${art.sky[1]}"/></linearGradient></defs>
  <rect width="${ART_WIDTH}" height="${ART_HEIGHT}" fill="url(#sky)"/>
  ${layers(art, seed)}
  <text x="64" y="1130" font-family="Arial Black, Arial, sans-serif" font-size="64" fill="#fff">${escapeXml(art.label)}</text>
  <text x="64" y="1178" font-family="Arial, sans-serif" font-size="28" fill="#fff" opacity="0.85">Esempio Odys · illustrazione</text>
</svg>`;
}

/** Illustrazione di una scena per un luogo («Otranto, Puglia» → scritta «Otranto»). */
export function sceneArt(scene: Scene, placeLabel: string): Art {
  return { scene, ...PALETTES[scene], label: placeLabel.split(',')[0] };
}

// ---------------------------------------------------------------------------
// Post e coordinatori dimostrativi
// ---------------------------------------------------------------------------
export interface PostSpec {
  caption: string;
  place: { label: string; latitude: number; longitude: number };
  scenes: Scene[];
  /** Titolo del viaggio pubblicato dell'autore. */
  trip?: string;
  status?: 'published' | 'scheduled' | 'draft';
  daysAgo: number;
}

export interface DemoCoordinator {
  key: string;
  firstName: string;
  lastName: string;
  headline: string;
  bio: string;
  interests: string[];
  trip: { title: string; destination: string; summary: string; start: string; end: string; price: number; capacity: number; included: string[]; excluded: string[] };
  posts: PostSpec[];
}

/** Post del coordinatore che pubblica i dieci viaggi di esempio. */
export const OWNER_POSTS: PostSpec[] = [
  { caption: 'Il tram 28 all’ora d’oro, poi su al Miradouro da Graça. A Lisbona il tramonto si guarda dall’alto: nel viaggio lo facciamo ogni sera da un belvedere diverso.', place: { label: 'Miradouro da Graça, Lisbona', latitude: 38.7166, longitude: -9.1316 }, scenes: ['sea', 'city', 'hills'], trip: 'Lisbona tra miradouros e azulejos', daysAgo: 2 },
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

export const DEMO_COORDINATORS: DemoCoordinator[] = [
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

/** Sposta in avanti di un anno alla volta le date già passate, così gli esempi restano prenotabili. */
export function upcomingDates(start: string, end: string, today = new Date()): { start: string; end: string } {
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  const limit = new Date(today.getTime() + 14 * 86_400_000);
  while (from < limit) {
    from.setUTCFullYear(from.getUTCFullYear() + 1);
    to.setUTCFullYear(to.getUTCFullYear() + 1);
  }
  return { start: from.toISOString().slice(0, 10), end: to.toISOString().slice(0, 10) };
}
