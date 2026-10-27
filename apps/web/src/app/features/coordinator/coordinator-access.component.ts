import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, type CoordinatorApplication } from '../../core/api/catalog.api';
import { ButtonComponent, IconComponent, NoticeComponent, TextFieldComponent } from '../../shared/ui';

/**
 * Accesso all'area coordinatore. Il ruolo non è automatico: chi non lo ha invia la
 * candidatura (C-01, C-02) e un amministratore la valuta (G-01); gli ambassador possono
 * essere attivati a mano (C-03). Le linee guida sono un consenso versionato (C-04).
 */
@Component({
  selector: 'odys-coordinator-access',
  imports: [DatePipe, FormsModule, RouterLink, ButtonComponent, IconComponent, NoticeComponent, TextFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state() === 'not-coordinator') {
      <section class="panel">
        <span class="icon"><odys-icon name="shield" [size]="24" /></span>
        <h2>Diventa coordinatore Odys</h2>
        <p class="muted">Per pubblicare viaggi di gruppo serve il ruolo di coordinatore. Non è automatico: invii la candidatura, il team Odys verifica profilo ed esperienza e ti risponde qui.</p>

        @if (application(); as sent) {
          @if (sent.status === 'pending') {
            <odys-notice tone="info" title="Candidatura in valutazione">Inviata il {{ sent.createdAt | date: 'd MMMM y' }}. Riceverai l’esito in questa pagina: non serve fare altro.</odys-notice>
          } @else if (sent.status === 'rejected') {
            <odys-notice tone="warning" title="Candidatura non accettata">
              {{ sent.reviewerMessage || 'Per ora non possiamo attivare il ruolo di coordinatore sul tuo account.' }} Puoi aggiornare il profilo e inviarne una nuova.
            </odys-notice>
          }
        }

        @if (application()?.status !== 'pending') {
          <form class="form" (submit)="$event.preventDefault(); apply()">
            <odys-text-field label="Perché vuoi coordinare viaggi con Odys?" [multiline]="true" [required]="true" [(value)]="motivation" hint="Almeno 40 caratteri: che tipo di viaggi proponi e a chi." />
            <odys-text-field label="La tua esperienza" [multiline]="true" [required]="true" [(value)]="experience" hint="Viaggi organizzati o guidati, destinazioni che conosci bene, eventuali qualifiche." />
            <div class="grid">
              <odys-text-field label="Viaggi di gruppo già organizzati" type="number" inputMode="numeric" [(value)]="tripsLed" />
              <odys-text-field label="Lingue parlate" [(value)]="languages" placeholder="Italiano, Inglese" hint="Separate da virgola." />
            </div>
            <odys-text-field label="Link di riferimento" [(value)]="links" placeholder="https://…" hint="Facoltativo: profilo social o sito, separati da virgola (solo https)." />
            <details>
              <summary>Linee guida del coordinatore</summary>
              <ul>
                @for (item of guidelines; track item) {<li>{{ item }}</li>}
              </ul>
            </details>
            <label class="check"><input type="checkbox" [ngModel]="acceptGuidelines()" (ngModelChange)="acceptGuidelines.set($event)" name="guidelines" /> Ho letto e accetto le linee guida del coordinatore.</label>
            <p class="muted small">Requisiti: profilo completo con nome, cognome e una presentazione di almeno 40 caratteri (<a routerLink="/account" fragment="profilo">completa il profilo</a>). Verifica dell’identità e documenti saranno richiesti dal team Odys prima dell’attivazione.</p>
            @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
            <button odysButton variant="accent" type="submit" icon="check" [loading]="busy()">Invia la candidatura</button>
          </form>
        }
      </section>
    } @else if (state() === 'guidelines') {
      <section class="panel">
        <span class="icon"><odys-icon name="check-circle" [size]="24" /></span>
        <h2>Linee guida del coordinatore</h2>
        <p class="muted">Prima di pubblicare il tuo primo viaggio conferma di aver letto e di rispettare le linee guida. Il testo definitivo sarà fornito da Odys; questi sono gli impegni di base:</p>
        <ul>
          @for (item of guidelines; track item) {<li>{{ item }}</li>}
        </ul>
        @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
        <button odysButton variant="accent" icon="check" [loading]="busy()" (click)="accept()">Ho letto e accetto le linee guida</button>
      </section>
    }
  `,
  styles: `
    .panel { display: flex; flex-direction: column; gap: var(--space-3); max-width: 720px; padding: var(--space-6); border-radius: var(--radius-xl); background: var(--color-surface); border: var(--border-width) solid var(--color-border); }
    .icon { display: grid; place-items: center; width: 52px; height: 52px; border-radius: var(--radius-md); background: var(--color-accent); color: var(--color-on-accent); }
    h2 { font-size: var(--text-xl); }
    ul { margin: 0; padding-left: var(--space-5); display: flex; flex-direction: column; gap: var(--space-2); }
    button { align-self: flex-start; }
    .form { display: flex; flex-direction: column; gap: var(--space-4); margin-top: var(--space-2); }
    .grid { display: grid; gap: var(--space-4); }
    @media (min-width: 720px) { .grid { grid-template-columns: 1fr 1fr; } }
    details summary { cursor: pointer; font-weight: 600; margin-bottom: var(--space-2); }
    .check { display: flex; align-items: flex-start; gap: var(--space-2); font-weight: 500; input { margin-top: 4px; } }
    .small { font-size: var(--text-sm); }
  `,
})
export class CoordinatorAccessComponent {
  private readonly api = inject(CatalogApi);
  readonly accepted = output<void>();
  readonly state = signal<'checking' | 'not-coordinator' | 'guidelines' | 'ready'>('checking');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly application = signal<CoordinatorApplication | null>(null);
  protected readonly motivation = signal('');
  protected readonly experience = signal('');
  protected readonly tripsLed = signal('0');
  protected readonly languages = signal('');
  protected readonly links = signal('');
  protected readonly acceptGuidelines = signal(false);
  protected readonly guidelines = [
    'Descrivo il viaggio in modo completo e veritiero: date, quota, posti, cosa è incluso e cosa no.',
    'Pubblico solo esperienze che posso effettivamente organizzare e guidare.',
    'Indico sempre quando un’informazione è ancora da verificare.',
    'Tratto i dati dei partecipanti solo per organizzare il viaggio.',
    'Accetto che Odys possa sospendere viaggi o contenuti non conformi.',
  ];

  async check(): Promise<boolean> {
    try {
      const status = await this.api.coordinatorStatus();
      this.application.set(status.application);
      this.state.set(!status.isCoordinator ? 'not-coordinator' : status.guidelinesAccepted ? 'ready' : 'guidelines');
    } catch {
      this.state.set('not-coordinator');
    }
    return this.state() === 'ready';
  }

  protected async apply(): Promise<void> {
    const split = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
    this.busy.set(true);
    this.error.set('');
    try {
      this.application.set(await this.api.applyAsCoordinator({
        motivation: this.motivation().trim(),
        experience: this.experience().trim(),
        tripsLed: Number.parseInt(this.tripsLed(), 10) || 0,
        languages: split(this.languages()),
        links: split(this.links()),
        acceptGuidelines: this.acceptGuidelines(),
      }));
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile inviare la candidatura.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async accept(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.acceptGuidelines();
      this.state.set('ready');
      this.accepted.emit();
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
