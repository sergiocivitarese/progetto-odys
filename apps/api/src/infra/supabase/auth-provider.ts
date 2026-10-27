import type { AppConfig } from '../../config/env';
import { supabaseConfigured } from '../../config/env';
import type { AuthProvider } from '../../shared/auth';
import { HttpError } from '../../shared/http';
import { adminClient, userClient } from './client';

/** Autenticazione con Supabase Auth: il token arriva dal browser e viene verificato qui. */
export function supabaseAuthProvider(config: AppConfig): AuthProvider {
  return {
    configured: supabaseConfigured(config),
    async verify(accessToken) {
      const { data, error } = await userClient(config, accessToken).auth.getUser(accessToken);
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email ?? undefined };
    },
    async deleteUser(userId) {
      const admin = adminClient(config);
      if (!admin) throw new HttpError(503, 'Eliminazione dell’account non disponibile: manca la chiave service_role sul server.');
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw new HttpError(502, 'Non è stato possibile eliminare l’account. Riprova più tardi.');
    },
  };
}
