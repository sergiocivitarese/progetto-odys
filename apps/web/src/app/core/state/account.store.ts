import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AccountApi, type Preferences, type Profile } from '../api/account.api';
import { CatalogApi } from '../api/catalog.api';
import { AuthStore } from '../auth/auth.store';
import { ThemeStore } from './theme.store';

/**
 * Dati dell'account collegati alla sessione: profilo, preferenze, idee salvate.
 * Al login applica il tema salvato sul profilo; le modifiche successive al tema
 * vengono salvate anche sul server.
 */
@Injectable({ providedIn: 'root' })
export class AccountStore {
  private readonly api = inject(AccountApi);
  private readonly auth = inject(AuthStore);
  private readonly theme = inject(ThemeStore);
  private readonly catalog = inject(CatalogApi);

  readonly profile = signal<Profile | null>(null);
  readonly preferences = signal<Preferences | null>(null);
  readonly savedIdeas = signal<Set<string>>(new Set());
  /** Viaggi pubblicati salvati (U-08). */
  readonly savedTrips = signal<Set<string>>(new Set());
  readonly isCoordinator = computed(() => ['coordinator', 'admin'].includes(this.profile()?.role ?? ''));
  readonly isAdmin = computed(() => this.profile()?.role === 'admin');

  constructor() {
    effect(() => {
      const userId = this.auth.user()?.id;
      untracked(() => (userId ? void this.load() : this.reset()));
    });
    // Tema scelto dall'utente → salvato sul profilo (se ha effettuato l'accesso).
    effect(() => {
      const theme = this.theme.preference();
      const current = untracked(() => this.preferences());
      if (current && current.theme !== theme) {
        this.preferences.set({ ...current, theme });
        void this.api.updatePreferences({ theme }).catch(() => undefined);
      }
    });
  }

  async load(): Promise<void> {
    try {
      const [{ profile, preferences }, ideas, saved] = await Promise.all([this.api.me(), this.api.savedIdeas(), this.catalog.savedTrips().catch(() => [])]);
      this.profile.set(profile);
      this.preferences.set(preferences);
      this.savedIdeas.set(new Set(ideas));
      this.savedTrips.set(new Set(saved.map((trip) => trip.id)));
      this.theme.set(preferences.theme);
    } catch {
      // Il profilo è un arricchimento: se non risponde l'app resta utilizzabile.
    }
  }

  async toggleIdea(id: string): Promise<void> {
    const ideas = new Set(this.savedIdeas());
    const saved = ideas.has(id);
    if (saved) ideas.delete(id); else ideas.add(id);
    this.savedIdeas.set(ideas);
    try {
      if (saved) await this.api.removeIdea(id); else await this.api.saveIdea(id);
    } catch (error) {
      await this.load();
      throw error;
    }
  }

  async toggleSavedTrip(id: string): Promise<void> {
    const saved = new Set(this.savedTrips());
    const wasSaved = saved.has(id);
    if (wasSaved) saved.delete(id); else saved.add(id);
    this.savedTrips.set(saved);
    try {
      if (wasSaved) await this.catalog.unsaveTrip(id); else await this.catalog.saveTrip(id);
    } catch (error) {
      await this.load();
      throw error;
    }
  }

  completeOnboarding(): void {
    if (this.auth.isAuthenticated()) void this.api.updatePreferences({ onboardingCompleted: true }).catch(() => undefined);
  }

  private reset(): void {
    this.profile.set(null);
    this.preferences.set(null);
    this.savedIdeas.set(new Set());
    this.savedTrips.set(new Set());
  }
}
