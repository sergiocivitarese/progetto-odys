/**
 * Configurazione runtime del dominio. Il backend la imposta all'avvio in base
 * alle chiavi provider disponibili; il dominio non legge mai variabili d'ambiente.
 */
export const domainConfig = {
  mapProviderAvailable: false,
};

export function configureDomain(patch: Partial<typeof domainConfig>): void {
  Object.assign(domainConfig, patch);
}
