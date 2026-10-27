import type { ActivitySetting, Interest, PlaceMetadata } from '@/types/travel';

const source = 'Contenuto demo originale Travel Companion';
const updatedAt = '2026-08-25';

export const demoPlaces: PlaceMetadata[] = [
  {
    id: 'torre-balat',
    title: 'Torre di Balat',
    address: 'Balat, Istanbul',
    city: 'Istanbul',
    zone: 'Balat',
    latitude: 41.029,
    longitude: 28.949,
    placeId: 'demo-bal-001',
    visitDuration: '60–90 min',
    openingHours: 'Orari da verificare',
    setting: 'outdoor',
    source,
    updatedAt,
    geoStatus: 'DEMO',
    category: 'Storia',
    whyRecommended: 'Un punto panoramico e culturale per comprendere il carattere storico del quartiere.',
  },
  {
    id: 'moschea-blu',
    title: 'Moschea Blu',
    address: 'Sultanahmet, Istanbul',
    city: 'Istanbul',
    zone: 'Sultanahmet',
    latitude: 41.0054,
    longitude: 28.9768,
    placeId: 'demo-ist-002',
    visitDuration: '60 min',
    openingHours: 'Fasce di visita da verificare',
    setting: 'indoor',
    source,
    updatedAt,
    geoStatus: 'DEMO',
    category: 'Arte',
    whyRecommended: 'Un interno raccolto per osservare luce, proporzioni e rapporto con la piazza.',
  },
  {
    id: 'mercato-locale',
    title: 'Mercato locale',
    city: 'Destinazione',
    zone: 'Centro',
    visitDuration: '60–90 min',
    openingHours: 'Orari da verificare',
    setting: 'outdoor',
    source,
    updatedAt,
    geoStatus: 'MISSING',
    category: 'Cibo',
    whyRecommended: 'Un modo semplice per iniziare dalla cucina e dalle abitudini quotidiane del luogo.',
  },
  {
    id: 'passeggiata-panoramica',
    title: 'Passeggiata panoramica',
    city: 'Destinazione',
    zone: 'Belvedere',
    visitDuration: '90 min',
    openingHours: 'Sempre accessibile, da verificare',
    setting: 'outdoor',
    source,
    updatedAt,
    geoStatus: 'MISSING',
    category: 'Natura',
    whyRecommended: 'Una pausa all’aperto che lascia spazio al ritmo del viaggio e all’osservazione.',
  },
];

export function slugForPlace(title: string, destination: string): string {
  const normalized = `${title}-${destination}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
}

export function placeForActivity(title: string, destination: string, category: Interest, setting: ActivitySetting): PlaceMetadata {
  const known = demoPlaces.find((place) => title.toLowerCase().includes(place.title.toLowerCase()));
  if (known) return { ...known, city: destination, address: known.address?.replace('Istanbul', destination) ?? known.address };
  return {
    id: slugForPlace(title, destination),
    title,
    address: 'Indirizzo da verificare',
    city: destination,
    zone: 'Zona da definire',
    visitDuration: '60–90 min',
    openingHours: 'Orari da verificare',
    setting,
    source,
    updatedAt,
    geoStatus: 'DEMO',
    category,
    whyRecommended: `Una proposta selezionata per il tuo interesse “${category}”, da verificare prima della partenza.`,
  };
}

export function findPlace(id: string, title?: string, destination?: string): PlaceMetadata {
  const found = demoPlaces.find((place) => place.id === id);
  if (found) return found;
  return placeForActivity(title ?? 'Luogo consigliato', destination ?? 'Destinazione', 'Storia', 'outdoor');
}