import { inject, Injectable, signal } from '@angular/core';
import { ServicesApi, type PublicConfig } from '../api/services.api';

/** Configurazione pubblica del backend (quali provider sono attivi). Caricata una volta. */
@Injectable({ providedIn: 'root' })
export class ConfigStore {
  private readonly api = inject(ServicesApi);
  private loading: Promise<void> | null = null;
  readonly config = signal<PublicConfig | null>(null);

  ensureLoaded(): Promise<void> {
    this.loading ??= this.api.config().then((config) => this.config.set(config)).catch(() => undefined);
    return this.loading;
  }
}
