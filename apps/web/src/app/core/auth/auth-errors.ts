/** Traduce gli errori di Supabase Auth in messaggi chiari per l'utente. */
export function authErrorMessage(error: unknown): string {
  const { code, message, status } = (error ?? {}) as { code?: string; message?: string; status?: number };
  switch (code) {
    case 'invalid_credentials': return 'Email o password non corretti.';
    case 'email_not_confirmed': return 'Devi prima confermare la tua email: apri il link che ti abbiamo inviato.';
    case 'user_already_exists':
    case 'email_exists': return 'Esiste già un account con questa email. Prova ad accedere o a recuperare la password.';
    case 'weak_password': return 'La password è troppo debole: usa almeno 8 caratteri con lettere e numeri.';
    case 'same_password': return 'La nuova password deve essere diversa da quella attuale.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit': return 'Troppi tentativi in poco tempo. Attendi qualche minuto e riprova.';
    case 'email_address_invalid': return 'Indirizzo email non valido.';
    case 'otp_expired': return 'Il link è scaduto o è già stato usato. Richiedine uno nuovo.';
    case 'session_not_found':
    case 'refresh_token_not_found': return 'La sessione è scaduta: accedi di nuovo.';
  }
  if (message?.includes('Database error saving new user')) return 'Registrazione non riuscita: controlla i dati inseriti (devi avere almeno 18 anni).';
  if (status === 0 || message?.includes('Failed to fetch')) return 'Servizio di accesso non raggiungibile. Controlla la connessione e riprova.';
  return message || 'Qualcosa non ha funzionato. Riprova.';
}

/** Regole minime della password (in linea con la configurazione consigliata di Supabase). */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'La password deve avere almeno 8 caratteri.';
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return 'La password deve contenere almeno una lettera e un numero.';
  return null;
}

/** Accetta solo percorsi interni come destinazione dopo il login (evita redirect verso altri siti). */
export function safeReturnUrl(value: string | null | undefined, fallback = '/'): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : fallback;
}
