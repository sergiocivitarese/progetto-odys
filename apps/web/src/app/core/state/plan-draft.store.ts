import { Injectable, signal } from '@angular/core';
import type { Itinerary } from '@odys/domain';

/**
 * Itinerario appena generato e non ancora salvato. Nel vecchio progetto viaggiava
 * come parametro di navigazione; qui resta in memoria (e in sessionStorage per il refresh).
 */
@Injectable({ providedIn: 'root' })
export class PlanDraftStore {
  private static readonly KEY = 'odys_unsaved_plan_v1';
  readonly plan = signal<Itinerary | null>(this.restore());

  set(plan: Itinerary): void {
    this.plan.set(plan);
    try { sessionStorage.setItem(PlanDraftStore.KEY, JSON.stringify(plan)); } catch { /* storage non disponibile */ }
  }

  clear(): void {
    this.plan.set(null);
    try { sessionStorage.removeItem(PlanDraftStore.KEY); } catch { /* storage non disponibile */ }
  }

  private restore(): Itinerary | null {
    try {
      const raw = sessionStorage.getItem(PlanDraftStore.KEY);
      return raw ? JSON.parse(raw) as Itinerary : null;
    } catch {
      return null;
    }
  }
}
