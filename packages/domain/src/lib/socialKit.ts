/*
 * Kit social di un viaggio pubblicato (CB-06): i testi che compaiono nella
 * story 9:16, nel post 4:5 e nel link per la bio. Il disegno delle immagini
 * avviene nel browser; qui solo contenuti e regole di impaginazione, testabili.
 */

export const SOCIAL_FORMATS = {
  story: { width: 1080, height: 1920, label: 'Story 9:16' },
  post: { width: 1080, height: 1350, label: 'Post 4:5' },
} as const;
export type SocialFormat = keyof typeof SOCIAL_FORMATS;

export interface SocialKitTrip {
  title: string;
  destination: string;
  country?: string;
  startDate?: string;
  endDate?: string;
  priceCents?: number;
  currency?: string;
  capacity?: number;
  seatsLeft?: number;
  interests?: readonly string[];
  coordinatorName?: string;
}

export interface SocialKitContent {
  destination: string;
  kicker: string;
  title: string;
  dates: string;
  price: string;
  seats: string;
  tags: string[];
  coordinator: string;
  /** Indirizzo senza protocollo, da stampare sulla grafica. */
  link: string;
  /** Testo pronto da incollare nella bio o nella didascalia. */
  bioText: string;
}

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

function parts(iso: string): { day: number; month: number; year: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) } : null;
}

function dateRange(start?: string, end?: string): string {
  const from = start ? parts(start) : null;
  const to = end ? parts(end) : null;
  if (!from) return 'Date in arrivo';
  const full = (d: { day: number; month: number; year: number }) => `${d.day} ${MONTHS[d.month]} ${d.year}`;
  if (!to) return `dal ${full(from)}`;
  if (from.year !== to.year) return `${full(from)} – ${full(to)}`;
  if (from.month !== to.month) return `${from.day} ${MONTHS[from.month]} – ${full(to)}`;
  return from.day === to.day ? full(from) : `${from.day}–${full(to)}`;
}

function days(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const diff = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  return Number.isFinite(diff) && diff > 0 ? diff : undefined;
}

function money(cents: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100).replace(/ /g, ' ');
}

function seatsText(capacity?: number, seatsLeft?: number): string {
  if (seatsLeft !== undefined && capacity !== undefined && seatsLeft < capacity) {
    if (seatsLeft <= 0) return 'Tutto esaurito';
    if (seatsLeft === 1) return 'Ultimo posto';
    if (seatsLeft < 5) return `Ultimi ${seatsLeft} posti`;
  }
  if (seatsLeft === 0) return 'Tutto esaurito';
  return capacity ? `${capacity} posti · piccolo gruppo` : '';
}

export function socialKitContent(trip: SocialKitTrip, url: string): SocialKitContent {
  const length = days(trip.startDate, trip.endDate);
  const kicker = [trip.country?.trim(), length ? `${length} ${length === 1 ? 'giorno' : 'giorni'}` : ''].filter(Boolean).join(' · ') || 'Viaggio di gruppo';
  const dates = dateRange(trip.startDate, trip.endDate);
  const price = trip.priceCents !== undefined ? `da ${money(trip.priceCents, trip.currency)}` : '';
  const link = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const summary = [trip.title.trim(), trip.startDate ? dates : '', price].filter(Boolean).join(' · ');
  return {
    destination: trip.destination.trim().toLocaleUpperCase('it'),
    kicker,
    title: trip.title.trim(),
    dates,
    price,
    seats: seatsText(trip.capacity, trip.seatsLeft),
    tags: (trip.interests ?? []).slice(0, 3),
    coordinator: trip.coordinatorName ? `con ${trip.coordinatorName}` : '',
    link,
    bioText: `${summary}\nPrenota il tuo posto: ${url}`,
  };
}

/**
 * Divide il testo in righe che stanno nella larghezza data, misurata con
 * `measure` (nel browser: `ctx.measureText`). Oltre `maxLines` l'ultima riga
 * finisce con i puntini.
 */
export function wrapWords(text: string, maxWidth: number, measure: (text: string) => number, maxLines = Infinity): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || measure(candidate) <= maxWidth) current = candidate;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = lines.slice(maxLines - 1).join(' ');
  while (last.includes(' ') && measure(`${last}…`) > maxWidth) last = last.slice(0, last.lastIndexOf(' '));
  kept[maxLines - 1] = `${last}…`;
  return kept;
}
