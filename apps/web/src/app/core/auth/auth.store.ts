import { computed, inject, Injectable, signal } from '@angular/core';
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { ConfigStore } from '../state/config.store';
import { authErrorMessage } from './auth-errors';

export interface SignUpData {
  firstName: string;
  lastName: string;
  birthDate: string;
  email: string;
  password: string;
  marketingOptIn: boolean;
  returnUrl: string;
}

/** Versione dei testi legali accettati alla registrazione (consensi versionati, C-04). */
export const CONSENT_VERSION = '2026-10';

/**
 * Sessione dell'utente (Supabase Auth). La libreria Supabase viene caricata solo
 * all'avvio della sessione, fuori dal bundle iniziale.
 *
 * - `status`: 'loading' finché la sessione salvata non è stata letta;
 * - `user`: utente autenticato o null;
 * - `available`: false se il server non ha Supabase configurato.
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly config = inject(ConfigStore);
  private client: SupabaseClient | null = null;
  private starting: Promise<void> | null = null;

  readonly status = signal<'loading' | 'ready'>('loading');
  /** Errore riportato da un link email (es. link scaduto), letto dall'URL all'avvio. */
  readonly linkError = signal<string | null>(null);
  readonly available = signal(false);
  readonly session = signal<Session | null>(null);
  readonly lastEvent = signal<AuthChangeEvent | null>(null);
  readonly user = computed(() => this.session()?.user ?? null);
  readonly isAuthenticated = computed(() => this.user() !== null);
  readonly displayName = computed(() => {
    const meta = this.user()?.user_metadata as { first_name?: string; last_name?: string } | undefined;
    const name = [meta?.first_name, meta?.last_name].filter(Boolean).join(' ');
    return name || this.user()?.email || '';
  });
  readonly initials = computed(() => {
    const meta = this.user()?.user_metadata as { first_name?: string; last_name?: string } | undefined;
    const letters = `${meta?.first_name?.[0] ?? ''}${meta?.last_name?.[0] ?? ''}` || this.user()?.email?.[0] || '?';
    return letters.toUpperCase();
  });

  /** Avvia (una sola volta) il client e legge la sessione salvata o arrivata da un link email. */
  start(): Promise<void> {
    this.starting ??= this.init();
    return this.starting;
  }

  private async init(): Promise<void> {
    try {
      await this.config.ensureLoaded();
      const auth = this.config.config()?.auth;
      if (!auth) return;
      this.linkError.set(readLinkError());
      const { createClient } = await import('@supabase/supabase-js');
      // Flusso "implicit": i link di conferma e recupero funzionano anche se aperti
      // in un altro browser o dispositivo (es. dall'app email del telefono).
      this.client = createClient(auth.url, auth.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'odys-auth' },
      });
      this.available.set(true);
      this.client.auth.onAuthStateChange((event, session) => {
        this.lastEvent.set(event);
        this.session.set(session);
      });
      const { data } = await this.client.auth.getSession();
      this.session.set(data.session);
    } catch (error) {
      console.error('[auth] avvio non riuscito', error);
    } finally {
      this.status.set('ready');
    }
  }

  /** Token da inviare al backend; aggiornato automaticamente se in scadenza. */
  async accessToken(): Promise<string | null> {
    await this.start();
    if (!this.client) return null;
    const { data } = await this.client.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.requireClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(authErrorMessage(error));
  }

  /** Registra l'account. Restituisce `needsConfirmation` se Supabase richiede la verifica email (U-13). */
  async signUp(data: SignUpData): Promise<{ needsConfirmation: boolean }> {
    const { data: result, error } = await this.requireClient().auth.signUp({
      email: data.email.trim(),
      password: data.password,
      options: {
        emailRedirectTo: `${location.origin}/accedi/conferma?ritorno=${encodeURIComponent(data.returnUrl)}`,
        data: {
          first_name: data.firstName.trim(),
          last_name: data.lastName.trim(),
          birth_date: data.birthDate,
          accepted_terms: true,
          consent_version: CONSENT_VERSION,
          marketing_opt_in: data.marketingOptIn,
        },
      },
    });
    if (error) throw new Error(authErrorMessage(error));
    // Supabase non segnala gli indirizzi già registrati: un utente senza identità è un duplicato.
    if (result.user && result.user.identities?.length === 0) throw new Error(authErrorMessage({ code: 'user_already_exists' }));
    return { needsConfirmation: !result.session };
  }

  async resendConfirmation(email: string): Promise<void> {
    const { error } = await this.requireClient().auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: `${location.origin}/accedi/conferma` } });
    if (error) throw new Error(authErrorMessage(error));
  }

  async sendPasswordReset(email: string): Promise<void> {
    const { error } = await this.requireClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/accedi/nuova-password` });
    if (error) throw new Error(authErrorMessage(error));
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.requireClient().auth.updateUser({ password });
    if (error) throw new Error(authErrorMessage(error));
  }

  async signOut(): Promise<void> {
    await this.client?.auth.signOut();
    this.session.set(null);
  }

  /** Dopo l'eliminazione dell'account: pulisce la sessione locale senza chiamare il server. */
  async clearLocalSession(): Promise<void> {
    await this.client?.auth.signOut({ scope: 'local' });
    this.session.set(null);
  }

  /** Carica un file nell'archivio dei media (Supabase Storage) con i permessi dell'utente (M-06). */
  async uploadMedia(path: string, file: Blob, contentType: string): Promise<void> {
    await this.start();
    const { error } = await this.requireClient().storage.from('creator-media').upload(path, file, { contentType, upsert: true, cacheControl: '31536000' });
    if (error) throw new Error(error.message);
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw new Error('Accesso non disponibile: il server non ha ancora Supabase configurato.');
    return this.client;
  }
}

/** Legge l'eventuale errore che Supabase aggiunge all'URL quando un link email non è valido. */
function readLinkError(): string | null {
  const params = new URLSearchParams([location.search.slice(1), location.hash.slice(1)].filter(Boolean).join('&'));
  const code = params.get('error_code');
  if (!code && !params.get('error')) return null;
  return code === 'otp_expired'
    ? 'Il link è scaduto o è già stato usato.'
    : params.get('error_description')?.replace(/\+/g, ' ') ?? 'Il link non è valido.';
}
