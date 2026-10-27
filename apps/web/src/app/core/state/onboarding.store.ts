import { Injectable, signal } from '@angular/core';

/** Introduzione al primo accesso: la scelta resta salvata nel browser (ex `useOnboarding`). */
@Injectable({ providedIn: 'root' })
export class OnboardingStore {
  private static readonly KEY = 'odys_onboarding_v1';
  readonly visible = signal(this.read() === null);

  complete(choice: 'completed' | 'skipped'): void {
    try { localStorage.setItem(OnboardingStore.KEY, choice); } catch { /* storage non disponibile */ }
    this.visible.set(false);
  }

  reopen(): void {
    this.visible.set(true);
  }

  private read(): string | null {
    try { return localStorage.getItem(OnboardingStore.KEY); } catch { return 'unavailable'; }
  }
}
