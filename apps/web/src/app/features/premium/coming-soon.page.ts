import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonComponent, EmptyStateComponent } from '../../shared/ui';

const SECTIONS: Record<string, { title: string; text: string }> = {
  dati: { title: 'I tuoi dati', text: 'Guadagni, funnel e post che vendono. Arrivano con il blocco Coordinatore Premium.' },
  messaggi: { title: 'Messaggi', text: 'La chat con i partecipanti arriva in una fase successiva.' },
  'dati-agenzia': { title: 'Dashboard di agenzia', text: 'Fatturato, riempimento e classifica dei coordinatori. Arriva con il blocco Agenzia.' },
  'ai-agenzia': { title: 'AI per i coordinatori', text: 'Regole e storico delle generazioni del team. Arriva con il blocco Agenzia.' },
  team: { title: 'Il tuo equipaggio', text: 'Inviti, licenze e proposte dei coordinatori. Arriva con il blocco Agenzia.' },
};

/** Sezioni già previste dalla navigazione per ruolo ma non ancora sviluppate. */
@Component({
  selector: 'odys-coming-soon-page',
  imports: [RouterLink, ButtonComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <odys-empty-state icon="clock" [title]="section().title" [description]="section().text">
        <a odysButton variant="primary" routerLink="/">Torna a Esplora</a>
      </odys-empty-state>
    </div>
  `,
})
export default class ComingSoonPage {
  private readonly params = toSignal(inject(ActivatedRoute).paramMap);
  protected readonly section = computed(() => SECTIONS[this.params()?.get('sezione') ?? ''] ?? { title: 'In arrivo', text: 'Questa sezione non è ancora disponibile.' });
}
