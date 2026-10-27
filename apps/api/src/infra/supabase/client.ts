import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../../config/env';
import { HttpError } from '../../shared/http';

const SERVER_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

/** Client con il token dell'utente: ogni query rispetta le regole RLS (S-01). */
export function userClient(config: AppConfig, accessToken: string): SupabaseClient {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    ...SERVER_OPTIONS,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Client privilegiato (service role): solo lato server e solo se configurato (S-03). */
export function adminClient(config: AppConfig): SupabaseClient | null {
  if (!config.supabase.url || !config.supabase.serviceRoleKey) return null;
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, SERVER_OPTIONS);
}

/** Traduce gli errori di Postgres/PostgREST in errori HTTP leggibili. */
export function dbError(error: { code?: string; message?: string } | null | undefined): HttpError {
  const message = error?.message ?? 'Errore dell’archivio dati.';
  switch (error?.code) {
    case 'P0002':
    case 'PGRST116': return new HttpError(404, 'Elemento non trovato.');
    case '28000': return new HttpError(401, 'Accedi per continuare.');
    case '42501': return new HttpError(403, message.includes('amministratore') ? message : 'Operazione non consentita.');
    case '23505': return new HttpError(409, 'Esiste già una richiesta in corso.');
    case '23514':
    case '22023': return new HttpError(422, message);
    default:
      console.error('[supabase]', error);
      return new HttpError(502, 'Archivio dati non disponibile in questo momento. Riprova.');
  }
}
