import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable, signal } from '@angular/core';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'odys_theme_v1';
const THEME_COLORS = { light: '#F8F7F3', dark: '#0E0E0E' } as const;

/**
 * Tema dell'app: chiaro, scuro o automatico (segue il sistema operativo).
 * La scelta è salvata nel browser e applicata come `data-theme` su <html>;
 * i colori arrivano dai token in `styles/_tokens.scss`.
 */
@Injectable({ providedIn: 'root' })
export class ThemeStore {
  private readonly document = inject(DOCUMENT);
  private readonly media = this.document.defaultView?.matchMedia('(prefers-color-scheme: dark)');

  readonly preference = signal<ThemePreference>(this.read());

  constructor() {
    effect(() => this.apply(this.preference()));
    this.media?.addEventListener('change', () => this.apply(this.preference()));
  }

  set(preference: ThemePreference): void {
    this.preference.set(preference);
    try { localStorage.setItem(STORAGE_KEY, preference); } catch { /* storage non disponibile */ }
  }

  private apply(preference: ThemePreference): void {
    const root = this.document.documentElement;
    const resolved = preference === 'system' ? (this.media?.matches ? 'dark' : 'light') : preference;
    if (preference === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', preference);
    this.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolved]);
  }

  private read(): ThemePreference {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === 'light' || value === 'dark' || value === 'system' ? value : 'light';
    } catch {
      return 'light';
    }
  }
}
