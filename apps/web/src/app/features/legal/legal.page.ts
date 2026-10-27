import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CONSENT_VERSION } from '../../core/auth/auth.store';
import { NoticeComponent } from '../../shared/ui';

/**
 * Termini di servizio e Informativa privacy. Il testo legale definitivo va
 * fornito dal cliente con il proprio consulente (analisi funzionale, §12):
 * qui riportiamo solo cosa raccoglie oggi l'app, senza inventare clausole.
 */
@Component({
  selector: 'odys-legal-page',
  imports: [NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="page legal">
      <p class="eyebrow">Versione {{ version }}</p>
      <h1>{{ isPrivacy() ? 'Informativa privacy' : 'Termini di servizio' }}</h1>
      <odys-notice tone="warning" title="Testo in preparazione">Il testo legale definitivo sarà fornito dal titolare del servizio insieme al proprio consulente. Questa pagina descrive solo ciò che l’applicazione fa oggi.</odys-notice>
      @if (isPrivacy()) {
        <h2>Quali dati raccogliamo</h2>
        <ul>
          <li>Dati dell’account: nome, cognome, data di nascita (per verificare la maggiore età) ed email.</li>
          <li>I viaggi che salvi, con lo storico delle modifiche, e le idee di gruppo che salvi.</li>
          <li>Le preferenze dell’interfaccia (per esempio il tema chiaro o scuro).</li>
          <li>Un registro delle azioni importanti sul tuo account, che puoi consultare nella tua area personale.</li>
          <li>I consensi che hai dato, con data e versione del testo accettato.</li>
        </ul>
        <h2>I tuoi diritti</h2>
        <p>Dalla tua area personale puoi correggere i dati del profilo, consultare il registro delle attività ed eliminare definitivamente l’account con tutti i dati collegati.</p>
      } @else {
        <h2>Uso del servizio</h2>
        <p>Odys ti aiuta a pianificare itinerari e a salvarli nel tuo account. Luoghi, orari, tratte e viaggi di gruppo mostrati nella demo sono dati dimostrativi e ogni informazione indica il proprio stato di affidabilità.</p>
        <p>Per creare un account devi avere almeno 18 anni.</p>
      }
    </article>
  `,
  styles: `
    .legal { display: flex; flex-direction: column; gap: var(--space-4); max-width: 760px; }
    h1 { font-size: var(--text-3xl); }
    h2 { font-size: var(--text-xl); margin-top: var(--space-4); }
    ul { margin: 0; padding-left: var(--space-5); display: flex; flex-direction: column; gap: var(--space-2); }
  `,
})
export default class LegalPage {
  /** Impostato dalla rotta: 'privacy' oppure 'termini'. */
  readonly kind = input<'privacy' | 'termini'>('privacy');
  protected readonly isPrivacy = computed(() => this.kind() === 'privacy');
  protected readonly version = CONSENT_VERSION;
}
