import type { GeoCacheStore } from '@odys/domain';
import type { AppConfig } from '../../config/env';
import { adminClient } from './client';

/**
 * Cache del geocoding condivisa fra tutti gli utenti, salvata su Supabase
 * (tabella `geocode_cache`, accessibile solo con la chiave service role).
 * Restituisce null se la chiave non è configurata.
 */
export function supabaseGeoCacheStore(config: AppConfig): GeoCacheStore | null {
  const admin = adminClient(config);
  if (!admin) return null;
  return {
    async read() {
      const { data, error } = await admin.from('geocode_cache').select('query_key, nodes');
      if (error) throw error;
      return JSON.stringify(Object.fromEntries((data ?? []).map((row) => [row.query_key, row.nodes])));
    },
    async write(value) {
      const entries = Object.entries(JSON.parse(value) as Record<string, unknown>);
      if (!entries.length) return;
      const { error } = await admin.from('geocode_cache').upsert(entries.map(([query_key, nodes]) => ({ query_key, nodes, updated_at: new Date().toISOString() })));
      if (error) throw error;
    },
  };
}
