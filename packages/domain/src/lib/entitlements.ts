/*
 * Piani e diritti (specifiche per ruolo, pagina 2).
 *
 * Il client chiede al server cosa è sbloccato e controlla un diritto per
 * funzione («questo utente ha il diritto X?»), mai il nome del piano: un piano
 * nuovo o una promozione non richiedono modifiche alle schermate.
 *
 * La stessa tabella è nella migrazione `0009_piani_e_diritti.sql`
 * (`plan_entitlements`); un test verifica che coincidano.
 */

/** I cinque profili: quattro livelli cumulativi più l'agenzia. */
export type PlanTier = 'traveller_base' | 'traveller_premium' | 'coordinator_base' | 'coordinator_premium' | 'agency';

/** Piani acquistabili o assegnabili; il Coordinatore Base deriva dalla candidatura approvata. */
export type SubscriptionPlan = 'traveller_premium' | 'coordinator_premium' | 'agency';

export type Entitlement =
  /** Prenotazione con acconto e Prossimo viaggio (TB-08…TB-10). */
  | 'trips.book'
  /** Generatore AI di viaggi (TP-01…TP-03). */
  | 'ai.generate'
  /** Viaggi salvati con meteo, mappe e storia dei luoghi (TP-04…TP-08). */
  | 'trips.insights'
  /** Split delle spese (TP-09). */
  | 'split.use'
  /** Crea, pubblica e vende viaggi (CB-02…CB-07). */
  | 'trips.sell'
  /** Gestione partecipanti (CB-08). */
  | 'participants.manage'
  /** Feed profilo, post, kit social (CB-06, CB-09, CB-10). */
  | 'posts.publish'
  /** Dashboard guadagni, funnel, post che vendono (CP-01…CP-06). */
  | 'analytics.coordinator'
  /** Catalogo multi-partenza e assegnazione coordinatori (AG-03, AG-04). */
  | 'agency.catalog'
  /** Team, ruoli interni, AI per i coordinatori associati (AG-02, AG-05, AG-06). */
  | 'agency.team'
  /** Licenze coordinatore a scaglioni (AG-09, AG-10). */
  | 'agency.licenses'
  /** Modalità ombrello sui viaggi dei coordinatori (AG-11, AG-12). */
  | 'agency.umbrella'
  /** Dashboard di agenzia (AG-07). */
  | 'agency.dashboard'
  /** Area di amministrazione e moderazione (G-01…G-04). */
  | 'admin.moderate';

export const PLAN_ENTITLEMENTS: Record<PlanTier, readonly Entitlement[]> = {
  traveller_base: ['trips.book'],
  traveller_premium: ['trips.book', 'ai.generate', 'trips.insights', 'split.use'],
  coordinator_base: ['trips.book', 'ai.generate', 'trips.insights', 'split.use', 'trips.sell', 'participants.manage', 'posts.publish'],
  coordinator_premium: ['trips.book', 'ai.generate', 'trips.insights', 'split.use', 'trips.sell', 'participants.manage', 'posts.publish', 'analytics.coordinator'],
  agency: ['ai.generate', 'trips.sell', 'participants.manage', 'posts.publish', 'agency.catalog', 'agency.team', 'agency.licenses', 'agency.umbrella', 'agency.dashboard'],
};

export const PLAN_LABELS: Record<PlanTier, string> = {
  traveller_base: 'Traveller Base',
  traveller_premium: 'Traveller Premium',
  coordinator_base: 'Coordinatore Base',
  coordinator_premium: 'Coordinatore Premium',
  agency: 'Agenzia',
};

export type AccountRole = 'traveler' | 'coordinator' | 'agency' | 'admin';

/**
 * Profilo effettivo: dal ruolo dell'account e dai piani attivi.
 * Una licenza d'agenzia attiva vale come un Coordinatore Premium (AG-09).
 */
export function resolvePlan(role: AccountRole, activePlans: readonly SubscriptionPlan[]): PlanTier {
  if (role === 'agency' || activePlans.includes('agency')) return 'agency';
  if (role === 'coordinator' || role === 'admin') {
    return activePlans.includes('coordinator_premium') ? 'coordinator_premium' : 'coordinator_base';
  }
  return activePlans.includes('traveller_premium') || activePlans.includes('coordinator_premium') ? 'traveller_premium' : 'traveller_base';
}

/** Diritti del profilo; l'amministratore aggiunge la moderazione. */
export function entitlementsFor(plan: PlanTier, role: AccountRole): Entitlement[] {
  const rights: Entitlement[] = [...PLAN_ENTITLEMENTS[plan]];
  if (role === 'admin') rights.push('admin.moderate');
  return rights;
}

export interface AccountEntitlements {
  plan: PlanTier;
  planLabel: string;
  entitlements: Entitlement[];
}

/** Diritti di chi non ha fatto l'accesso: può esplorare, non prenotare (il login si chiede al momento). */
export const GUEST_ENTITLEMENTS: AccountEntitlements = { plan: 'traveller_base', planLabel: PLAN_LABELS.traveller_base, entitlements: [] };

export function describeEntitlements(role: AccountRole, activePlans: readonly SubscriptionPlan[]): AccountEntitlements {
  const plan = resolvePlan(role, activePlans);
  return { plan, planLabel: PLAN_LABELS[plan], entitlements: entitlementsFor(plan, role) };
}

/** Limite globale dei partecipanti per viaggio, coordinatore escluso. */
export const MAX_TRIP_PARTICIPANTS = 12;
