/*
 * Agenzia (AG-01, AG-02, AG-05, AG-09, AG-10): ruoli interni, permessi e
 * prezzo delle licenze a scaglioni. Le stesse regole le applicano le funzioni
 * SQL (migrazione 0020) e l'archivio in memoria dell'API.
 */

export const AGENCY_ROLES = ['owner', 'admin', 'operator', 'coordinator'] as const;
export type AgencyRole = (typeof AGENCY_ROLES)[number];

export const AGENCY_ROLE_LABELS: Record<AgencyRole, string> = {
  owner: 'Proprietario',
  admin: 'Amministratore',
  operator: 'Operatore',
  coordinator: 'Coordinatore',
};

/** Legame di un coordinatore con l'agenzia: indipendente o abilitato con licenza. */
export type AgencyLinkType = 'associated' | 'licensed';
export const AGENCY_LINK_LABELS: Record<AgencyLinkType, string> = { associated: 'Associato', licensed: 'Con licenza' };

export type AgencyMemberStatus = 'invited' | 'active' | 'declined' | 'removed';

export type AgencyAction =
  | 'profile.edit'
  | 'team.view'
  | 'team.invite'
  | 'team.remove'
  | 'licenses.assign'
  | 'licenses.seats';

/** Chi può fare cosa (AG-02). Il proprietario può tutto; solo lui compra licenze. */
const PERMISSIONS: Record<AgencyAction, readonly AgencyRole[]> = {
  'profile.edit': ['owner', 'admin'],
  'team.view': ['owner', 'admin', 'operator'],
  'team.invite': ['owner', 'admin'],
  'team.remove': ['owner', 'admin'],
  'licenses.assign': ['owner', 'admin'],
  'licenses.seats': ['owner'],
};

export function agencyCan(role: AgencyRole | null | undefined, action: AgencyAction): boolean {
  return Boolean(role && PERMISSIONS[action].includes(role));
}

/** Ruoli che un invito può assegnare: il proprietario è uno solo e non si invita. */
export const INVITABLE_ROLES: readonly AgencyRole[] = ['admin', 'operator', 'coordinator'];

// ---------------------------------------------------------------------------
// Licenze a scaglioni (AG-10)
// ---------------------------------------------------------------------------

export type BillingCycle = 'monthly' | 'annual';

export interface LicenseTier {
  from: number;
  /** Incluso; null = senza limite. */
  to: number | null;
  /** Prezzo per licenza al mese, in centesimi. */
  monthlyCents: number;
}

/**
 * Struttura degli scaglioni del documento del cliente (pagina 10). I prezzi
 * sono un punto aperto: questi sono valori d'esempio, da sostituire.
 */
export const LICENSE_TIERS: readonly LicenseTier[] = [
  { from: 1, to: 4, monthlyCents: 4900 },
  { from: 5, to: 14, monthlyCents: 3900 },
  { from: 15, to: 39, monthlyCents: 2900 },
  { from: 40, to: null, monthlyCents: 2400 },
];
export const LICENSE_PRICES_ARE_EXAMPLES = true;
/** Con la fatturazione annuale si pagano 10 mesi su 12 (valore d'esempio). */
export const ANNUAL_MONTHS_CHARGED = 10;
export const MAX_LICENSE_SEATS = 500;

export interface LicenseQuote {
  seats: number;
  cycle: BillingCycle;
  tier: LicenseTier | null;
  /** Prezzo per licenza al mese nello scaglione attuale. */
  perLicenseMonthlyCents: number;
  /** Totale per periodo di fatturazione (mese o anno). */
  totalCents: number;
  next: { tier: LicenseTier; missing: number } | null;
}

export function tierFor(seats: number): LicenseTier | null {
  if (seats < 1) return null;
  return LICENSE_TIERS.find((tier) => seats >= tier.from && (tier.to === null || seats <= tier.to)) ?? null;
}

/** Prezzo delle licenze: il prezzo per licenza scende al crescere delle licenze, applicato a tutte. */
export function licenseQuote(seats: number, cycle: BillingCycle = 'monthly'): LicenseQuote {
  const count = Math.max(0, Math.floor(seats));
  const tier = tierFor(count);
  const perLicense = tier?.monthlyCents ?? 0;
  const months = cycle === 'annual' ? ANNUAL_MONTHS_CHARGED : 1;
  const index = tier ? LICENSE_TIERS.indexOf(tier) : -1;
  const nextTier = LICENSE_TIERS[index + 1] ?? (count < 1 ? LICENSE_TIERS[0] : undefined);
  return {
    seats: count,
    cycle,
    tier,
    perLicenseMonthlyCents: perLicense,
    totalCents: perLicense * count * months,
    next: nextTier ? { tier: nextTier, missing: nextTier.from - count } : null,
  };
}

/** Indirizzo pubblico dell'agenzia, es. «Viaggi Lenti Srl» → «viaggi-lenti-srl». */
export function agencySlug(value: string): string {
  return value.toLocaleLowerCase('it').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

export function isValidAgencySlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(value);
}

// ---------------------------------------------------------------------------
// Moduli a piano (AG-08): cosa sblocca ciascun livello del piano Agenzia
// ---------------------------------------------------------------------------

export const AGENCY_TIERS = ['start', 'pro', 'business'] as const;
export type AgencyTier = (typeof AGENCY_TIERS)[number];

export interface AgencyTierModules {
  label: string;
  /** Membri del team oltre al proprietario (inviti in attesa compresi); null = senza limite. */
  maxMembers: number | null;
  /** Canali di prenotazione e classifica dei coordinatori nella dashboard (AG-07). */
  advancedAnalytics: boolean;
  /** Regole automatiche all'ingresso dei coordinatori (ombrello, licenza). */
  automations: boolean;
}

/** Valori provvisori: limiti e prezzi dei piani agenzia sono un punto aperto del cliente. Stessi valori in `agency_tier_*` (migrazione 0025). */
export const AGENCY_TIER_MODULES: Record<AgencyTier, AgencyTierModules> = {
  start: { label: 'Start', maxMembers: 5, advancedAnalytics: false, automations: false },
  pro: { label: 'Pro', maxMembers: 20, advancedAnalytics: true, automations: false },
  business: { label: 'Business', maxMembers: null, advancedAnalytics: true, automations: true },
};

export function isAgencyTier(value: unknown): value is AgencyTier {
  return typeof value === 'string' && (AGENCY_TIERS as readonly string[]).includes(value);
}

/** Il livello più basso che sblocca un modulo, per l'invito all'upgrade. */
export function tierForModule(module: 'advancedAnalytics' | 'automations'): AgencyTier {
  return AGENCY_TIERS.find((tier) => AGENCY_TIER_MODULES[tier][module])!;
}

/** Si può aggiungere un membro? `members` = membri attivi e invitati, proprietario escluso. */
export function canAddMember(tier: AgencyTier, members: number): boolean {
  const max = AGENCY_TIER_MODULES[tier].maxMembers;
  return max === null || members < max;
}
