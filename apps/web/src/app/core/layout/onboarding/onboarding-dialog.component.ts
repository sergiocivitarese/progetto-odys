import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { DataState } from '@odys/domain';
import { ButtonComponent, DialogComponent, IconComponent, StatusBadgeComponent } from '../../../shared/ui';

/** Introduzione a Odys: stesso messaggio dell'onboarding Triply, con il nuovo brand. */
@Component({
  selector: 'odys-onboarding-dialog',
  imports: [DialogComponent, ButtonComponent, IconComponent, StatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <odys-dialog [open]="open()" title="Benvenuto in Odys" (closed)="completed.emit('skipped')">
      <p class="lead">Il tuo viaggio, senza il rumore. Odys ti aiuta a costruire un piano chiaro e a ritrovarlo quando serve.</p>
      <ul class="features">
        <li>
          <span class="feature-icon feature-icon--lime"><odys-icon name="bookmark" /></span>
          <div><strong>I tuoi viaggi, sempre a portata</strong><p>Salvi il piano e lo completi con calma: date, alloggio e attività si aggiornano senza perdere il lavoro fatto.</p></div>
        </li>
        <li>
          <span class="feature-icon feature-icon--blue"><odys-icon name="check-circle" /></span>
          <div><strong>Ogni dato dichiara il suo stato</strong><p>Niente viene presentato come certo se non lo è: vedrai sempre se un dato è confermato, simulato, offline o da verificare.</p></div>
        </li>
      </ul>
      <div class="badges">
        @for (state of states; track state) {<odys-status-badge [state]="state" />}
      </div>
      <ul class="features">
        <li>
          <span class="feature-icon feature-icon--coral"><odys-icon name="sliders" /></span>
          <div><strong>I provider sono opzionali</strong><p>Mappa, geocoding, percorsi e meteo aggiungono dati aggiornati, ma il planner funziona anche senza.</p></div>
        </li>
      </ul>
      <p class="hint">Puoi riaprire questa introduzione dall’icona informazioni in alto.</p>
      <div dialog-actions class="actions">
        <button odysButton variant="ghost" (click)="completed.emit('skipped')">Salta introduzione</button>
        <button odysButton variant="primary" trailingIcon="arrow-right" (click)="completed.emit('completed')">Inizia con Odys</button>
      </div>
    </odys-dialog>
  `,
  styles: `
    .lead { color: var(--color-text-muted); margin-bottom: var(--space-4); }
    .features { list-style: none; margin: 0 0 var(--space-3); padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
    li { display: flex; gap: var(--space-3); align-items: flex-start; }
    li p { font-size: var(--text-sm); color: var(--color-text-muted); }
    .feature-icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: var(--radius-md); flex-shrink: 0; }
    .feature-icon--lime { background: var(--color-accent); color: var(--color-on-accent); }
    .feature-icon--blue { background: var(--color-primary); color: var(--color-on-primary); }
    .feature-icon--coral { background: var(--color-danger); color: var(--color-on-danger); }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 var(--space-4) 52px; }
    .hint { font-size: var(--text-xs); color: var(--color-text-muted); }
    .actions { width: 100%; justify-content: flex-end; }
  `,
})
export class OnboardingDialogComponent {
  readonly open = input(false);
  readonly completed = output<'completed' | 'skipped'>();
  protected readonly states: DataState[] = ['confermato', 'simulato', 'offline', 'da-verificare', 'mancante', 'da-definire', 'non-disponibile'];
}
