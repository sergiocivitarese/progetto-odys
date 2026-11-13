import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { GUEST_ENTITLEMENTS, type AccountEntitlements, type Entitlement } from '@odys/domain';
import { AccountApi } from '../api/account.api';
import { AuthStore } from '../auth/auth.store';

/**
 * Piano e diritti dell'utente, chiesti al server (TP-10).
 * Le schermate controllano un diritto per funzione con `has('ai.generate')`,
 * mai il nome del piano: un piano nuovo non richiede modifiche qui.
 */
@Injectable({ providedIn: 'root' })
export class EntitlementsStore {
  private readonly api = inject(AccountApi);
  private readonly auth = inject(AuthStore);
  private readonly account = signal<AccountEntitlements>(GUEST_ENTITLEMENTS);
  private pending: Promise<void> | null = null;

  readonly plan = computed(() => this.account().plan);
  readonly planLabel = computed(() => this.account().planLabel);
  readonly entitlements = computed(() => this.account().entitlements);

  constructor() {
    effect(() => {
      const userId = this.auth.user()?.id;
      untracked(() => {
        if (userId) void this.refresh();
        else this.account.set(GUEST_ENTITLEMENTS);
      });
    });
  }

  has(entitlement: Entitlement): boolean {
    return this.account().entitlements.includes(entitlement);
  }

  /** Rilegge i diritti dal server (dopo l'accesso o un cambio di piano). */
  refresh(): Promise<void> {
    this.pending ??= this.api.entitlements()
      .then((account) => this.account.set(account))
      // Se il server non risponde restano i diritti minimi: nessuna funzione a pagamento si apre per errore.
      .catch(() => this.account.set(GUEST_ENTITLEMENTS))
      .finally(() => { this.pending = null; });
    return this.pending;
  }
}
