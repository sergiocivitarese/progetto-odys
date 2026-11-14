import type { Entitlement } from '@odys/domain';
import type { IconName } from '../../../shared/ui';

export interface NavItem {
  label: string;
  path: string;
  icon: IconName;
  exact?: boolean;
  /** Pulsante centrale della barra (Crea con AI, Crea viaggio). */
  primary?: boolean;
}

export interface Navigation {
  items: NavItem[];
  /** Barra blu con voce attiva bianca: è quella dell'agenzia. */
  tone: 'default' | 'agency';
}

/**
 * Navigazione per ruolo (specifiche per ruolo, «Navigazione per ruolo»).
 * Dipende dai diritti, non dal nome del piano: una licenza d'agenzia che dà
 * `analytics.coordinator` mostra «Dati» senza altre modifiche.
 */
export function navigationFor(has: (entitlement: Entitlement) => boolean): Navigation {
  if (has('agency.dashboard')) {
    return {
      tone: 'agency',
      items: [
        { label: 'Dati', path: '/in-arrivo/dati-agenzia', icon: 'chart-column' },
        { label: 'Catalogo', path: '/coordinatore', icon: 'box' },
        { label: 'AI', path: '/in-arrivo/ai-agenzia', icon: 'sparkles' },
        { label: 'Team', path: '/in-arrivo/team', icon: 'users' },
        { label: 'Impostazioni', path: '/account', icon: 'settings' },
      ],
    };
  }
  if (has('trips.sell')) {
    const analytics = has('analytics.coordinator');
    return {
      tone: 'default',
      items: [
        analytics ? { label: 'Dati', path: '/dati', icon: 'chart-column' } : { label: 'Esplora', path: '/', icon: 'compass', exact: true },
        { label: 'Viaggi', path: '/coordinatore', icon: 'bag' },
        { label: 'Crea viaggio', path: '/coordinatore/nuovo', icon: 'plus', primary: true },
        { label: 'Feed', path: '/studio', icon: 'grid' },
        { label: 'Profilo', path: '/account', icon: 'user' },
      ],
    };
  }
  if (has('ai.generate')) {
    return {
      tone: 'default',
      items: [
        { label: 'Esplora', path: '/', icon: 'compass', exact: true },
        { label: 'Viaggi', path: '/viaggi', icon: 'bag' },
        { label: 'Crea con AI', path: '/crea', icon: 'sparkles', primary: true },
        { label: 'Split', path: '/split', icon: 'chart-pie' },
        { label: 'Profilo', path: '/account', icon: 'user' },
      ],
    };
  }
  return {
    tone: 'default',
    items: [
      { label: 'Esplora', path: '/', icon: 'compass', exact: true },
      { label: 'Prossimo viaggio', path: '/prossimo-viaggio', icon: 'bag' },
      { label: 'Salvati', path: '/salvati', icon: 'heart' },
      { label: 'Profilo', path: '/account', icon: 'user' },
    ],
  };
}

/** Etichetta corta per la barra in basso. */
export function shortLabel(item: NavItem): string {
  return item.label === 'Prossimo viaggio' ? 'Viaggio' : item.label;
}
