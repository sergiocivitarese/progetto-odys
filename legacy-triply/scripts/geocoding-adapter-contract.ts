import { GeocodingClient, type GeoapifyAdapterContract } from '@/lib/geocoding';
import type { LocationNode } from '@/types/travel';

const alternateAdapter: GeoapifyAdapterContract = {
  provider: 'Provider alternativo di test',
  source: 'Provider alternativo di test',
  available: true,
  async search(): Promise<LocationNode[]> {
    return [];
  },
};

// Questa istanziazione viene verificata da `tsc`: il client non dipende dalla
// classe Geoapify e può ricevere un adapter conforme al contratto.
export const alternateAdapterClient = new GeocodingClient(alternateAdapter);