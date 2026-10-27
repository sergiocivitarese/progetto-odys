import type { OfflineMapArea, OfflineMapStatus } from '@/types/travel';

export const OFFLINE_MAP_ATTRIBUTION = '© MapTiler © OpenStreetMap contributors';
export const OFFLINE_MAP_STORAGE_VERSION = 1;

export const ROME_HISTORIC_CENTRE_AREA = {
  id: 'rome-historic-centre-v1',
  label: 'Centro storico di Roma',
  bounds: [12.470, 41.896, 12.492, 41.908] as [number, number, number, number],
  minZoom: 13,
  maxZoom: 16,
  styleId: 'streets-v2',
  styleVersion: 'v1',
} as const;

export function isApprovedMapTilerStyle(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'api.maptiler.com' && parsed.pathname.startsWith('/maps/');
  } catch {
    return false;
  }
}

export function styleUrlHash(url: string): string {
  const safeUrl = url.replace(/[?&]key=[^&]+/i, '');
  let hash = 2166136261;
  for (let index = 0; index < safeUrl.length; index += 1) {
    hash ^= safeUrl.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function lngToTile(longitude: number, zoom: number): number {
  return ((longitude + 180) / 360) * (2 ** zoom);
}

function latToTile(latitude: number, zoom: number): number {
  const radians = (latitude * Math.PI) / 180;
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * (2 ** zoom);
}

export function estimateOfflineTiles(bounds: [number, number, number, number], minZoom: number, maxZoom: number): number {
  const [west, south, east, north] = bounds;
  let total = 0;
  for (let zoom = minZoom; zoom <= maxZoom; zoom += 1) {
    const width = Math.max(1, Math.ceil(Math.abs(lngToTile(east, zoom) - lngToTile(west, zoom))));
    const height = Math.max(1, Math.ceil(Math.abs(latToTile(south, zoom) - latToTile(north, zoom))));
    total += width * height;
  }
  return total;
}

export function estimateOfflineSizeMb(tileCount: number): number {
  // Stima prudenziale: vector tile, sprite, font e overhead del database locale.
  return Math.max(1, Math.ceil((tileCount * 55_000 * 1.35) / 1_000_000));
}

export function initialOfflineArea(): OfflineMapArea {
  const tileCount = estimateOfflineTiles(ROME_HISTORIC_CENTRE_AREA.bounds, ROME_HISTORIC_CENTRE_AREA.minZoom, ROME_HISTORIC_CENTRE_AREA.maxZoom);
  return {
    ...ROME_HISTORIC_CENTRE_AREA,
    status: 'NOT_DOWNLOADED',
    provider: 'MapTiler',
    estimatedSizeMb: estimateOfflineSizeMb(tileCount),
    progress: 0,
  };
}

export function offlineNote(status: OfflineMapStatus): string {
  switch (status) {
    case 'PREPARING': return 'Preparazione del pacchetto cartografico locale.';
    case 'DOWNLOADING': return 'Download cartografia MapTiler in corso. Puoi annullare senza modificare il viaggio.';
    case 'PREPARED': return 'Cartografia offline disponibile per l’area scaricata.';
    case 'CANCELLED': return 'Download annullato. Nessun pacchetto offline è disponibile.';
    case 'ERROR': return 'Download non completato. Controlla rete e chiave MapTiler, poi riprova.';
    case 'UNAVAILABLE': return 'Cartografia offline non disponibile su questo ambiente.';
    default: return 'Cartografia offline non scaricata. Itinerario, nodi e tratte restano disponibili localmente.';
  }
}