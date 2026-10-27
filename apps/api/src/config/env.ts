import path from 'node:path';

/** Configurazione del backend letta dalle variabili d'ambiente (vedi `.env.example`). */
export interface AppConfig {
  port: number;
  dataDir: string;
  corsOrigin: string[];
  keys: {
    geoapify: string;
    graphhopper: string;
    maptiler: string;
  };
  /** Suggerimenti OpenStreetMap (Photon): istanza e User-Agent con cui ci si presenta. */
  osm: {
    photonUrl: string;
    osrmUrl: string;
    userAgent: string;
  };
  supabase: {
    url: string;
    /** Chiave pubblica: può arrivare al browser, i permessi li decide RLS. */
    anonKey: string;
    /** Chiave privilegiata: solo lato server (S-03). Facoltativa. */
    serviceRoleKey: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number.parseInt(env.PORT ?? '3000', 10),
    dataDir: path.resolve(env.DATA_DIR ?? './data'),
    corsOrigin: (env.CORS_ORIGIN ?? 'http://localhost:4200').split(',').map((item) => item.trim()).filter(Boolean),
    keys: {
      geoapify: env.GEOAPIFY_KEY?.trim() ?? '',
      graphhopper: env.GRAPHHOPPER_KEY?.trim() ?? '',
      maptiler: env.MAPTILER_KEY?.trim() ?? '',
    },
    osm: {
      photonUrl: env.PHOTON_URL?.trim().replace(/\/+$/, '') || 'https://photon.komoot.io',
      osrmUrl: env.OSRM_URL?.trim().replace(/\/+$/, '') || 'https://routing.openstreetmap.de',
      userAgent: env.OSM_USER_AGENT?.trim() || 'Odys/0.1 (planner di viaggio)',
    },
    supabase: {
      url: env.SUPABASE_URL?.trim().replace(/\/+$/, '') ?? '',
      anonKey: env.SUPABASE_ANON_KEY?.trim() ?? '',
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '',
    },
  };
}

export function supabaseConfigured(config: AppConfig): boolean {
  return Boolean(config.supabase.url && config.supabase.anonKey);
}
