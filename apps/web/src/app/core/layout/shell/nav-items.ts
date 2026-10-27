import type { IconName } from '../../../shared/ui';

export interface NavItem {
  label: string;
  path: string;
  icon: IconName;
  exact?: boolean;
}

/** Voci di navigazione principali: aggiungi qui una nuova sezione dell'app. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', path: '/', icon: 'home', exact: true },
  { label: 'I miei viaggi', path: '/viaggi', icon: 'bookmark' },
  { label: 'Pianifica', path: '/pianifica', icon: 'plus' },
  { label: 'Viaggi di gruppo', path: '/gruppi', icon: 'users' },
];
