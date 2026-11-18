import type { Payment } from './community';

/**
 * Fornitore dei pagamenti. Oggi è simulato; quello reale (da decidere con il
 * cliente) implementerà la stessa interfaccia: `charge` avvia l'incasso e la
 * conferma arriva dal webhook del fornitore, mai dalla risposta del client.
 */
export interface PaymentProvider {
  readonly name: string;
  /**
   * Avvia l'incasso di un pagamento già registrato come «in corso».
   * `confirm` va chiamata quando il fornitore conferma l'incasso.
   */
  charge(payment: Payment, confirm: () => Promise<unknown>): void;
}

/**
 * Fornitore simulato: nessun denaro si muove. Conferma dopo un breve ritardo,
 * così il client vede lo stato «in conferma» come con un fornitore vero.
 */
export function simulatedPaymentProvider(delayMs: number | (() => number) = 1200): PaymentProvider {
  return {
    name: 'simulated',
    charge(payment, confirm) {
      setTimeout(() => {
        confirm().catch((error) => console.error(`[pagamenti] conferma simulata non riuscita per ${payment.id}:`, error));
      }, typeof delayMs === 'function' ? delayMs() : delayMs).unref?.();
    },
  };
}
