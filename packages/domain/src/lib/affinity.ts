/*
 * Affinità «X% per te» (TB-04) e interessi condivisi tra profilo e viaggi.
 *
 * L'algoritmo definitivo è un punto aperto del cliente (quali segnali, quali
 * pesi). Questa versione usa solo gli interessi: è una funzione pura, facile
 * da sostituire senza toccare le schermate.
 */

/** Interessi proposti a viaggiatori e coordinatori: lo stesso elenco su profilo, viaggio e filtri. */
export const TRIP_INTERESTS = [
  'Mare', 'Cibo', 'Storia', 'Rovine', 'Trekking', 'Avventura', 'Natura', 'Città', 'Arte', 'Surf', 'Nightlife', 'Relax',
] as const;

export interface Affinity {
  /** Da 0 a 100. */
  percent: number;
  /** Interessi del viaggio che l'utente condivide, come li ha scritti il coordinatore. */
  shared: string[];
  /** Spiegazione per il dettaglio, es. «Rovine e mare: i tuoi interessi». */
  explanation: string;
}

function key(value: string): string {
  return value.trim().toLocaleLowerCase('it').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
}

/**
 * Quota degli interessi del viaggio che l'utente condivide.
 * Restituisce null quando manca uno dei due elenchi: senza dati non si mostra alcun badge.
 */
export function affinity(userInterests: readonly string[], tripInterests: readonly string[]): Affinity | null {
  const mine = new Set(userInterests.map(key).filter(Boolean));
  const theirs = tripInterests.filter((item) => key(item));
  if (!mine.size || !theirs.length) return null;
  const shared = theirs.filter((item) => mine.has(key(item)));
  const percent = Math.round((shared.length / theirs.length) * 100);
  const names = shared.map((item, index) => (index === 0 ? item : item.toLocaleLowerCase('it')));
  return {
    percent,
    shared,
    explanation: shared.length ? `${joinNames(names)}: ${shared.length === 1 ? 'un tuo interesse' : 'i tuoi interessi'}` : 'Nessun interesse in comune per ora',
  };
}

/** Vero se i due elenchi hanno almeno un interesse in comune (filtri e mete simili). */
export function sharesInterest(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a.map(key));
  return b.some((item) => set.has(key(item)));
}

/** Confronto senza maiuscole né accenti, per ricerca e suggerimenti («messico» trova «Messico»). */
export function searchKey(value: string): string {
  return key(value);
}
