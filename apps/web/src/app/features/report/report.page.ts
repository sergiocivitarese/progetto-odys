import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-client';
import { ModerationApi, REPORT_REASONS, REPORT_TARGET_LABELS, type ReportReason, type ReportTarget } from '../../core/api/moderation.api';
import { ButtonComponent, ChipComponent, IconComponent, NoticeComponent } from '../../shared/ui';

const TARGETS: Record<string, ReportTarget> = { post: 'post', viaggio: 'published_trip', profilo: 'profile' };
const BACK: Record<ReportTarget, (id: string) => string[]> = {
  post: (id) => ['/esplora', id],
  published_trip: (id) => ['/gruppi', id],
  profile: (id) => ['/coordinatori', id],
};

/** Segnalazione di un post, viaggio o profilo (S-07): motivo, dettagli e conferma. */
@Component({
  selector: 'odys-report-page',
  imports: [FormsModule, RouterLink, ButtonComponent, ChipComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page narrow">
      @if (target(); as t) {
        <a [routerLink]="back()" class="back"><odys-icon name="arrow-left" [size]="16" /> Torna al contenuto</a>
        <p class="eyebrow">Segnala · {{ targetLabel() }}</p>
        <h1>Cosa non va?</h1>
        <p class="muted">La segnalazione arriva al team Odys, che la valuta e può rimuovere il contenuto o sospendere l’account. Chi l’ha pubblicato non saprà chi l’ha segnalato.</p>

        @if (sent()) {
          <odys-notice tone="success" title="Segnalazione inviata">Grazie: la valuteremo il prima possibile. Puoi tornare al contenuto.</odys-notice>
        } @else {
          <form (submit)="$event.preventDefault(); send()">
            <fieldset>
              <legend>Motivo</legend>
              <div class="chips">
                @for (option of reasons; track option.value) {
                  <button type="button" odysChip [selected]="reason() === option.value" (click)="reason.set(option.value)">{{ option.label }}</button>
                }
              </div>
            </fieldset>
            <label for="details">Dettagli <span class="muted">{{ reason() === 'other' ? '(obbligatori)' : '(facoltativi)' }}</span></label>
            <textarea id="details" rows="4" maxlength="1000" [ngModel]="details()" (ngModelChange)="details.set($event)" name="details" placeholder="Cosa hai notato? Più è preciso, più è facile intervenire."></textarea>
            @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
            <button odysButton variant="accent" type="submit" icon="alert-triangle" [loading]="sending()" [disabled]="!reason()">Invia la segnalazione</button>
          </form>
        }
      } @else {
        <odys-notice tone="danger">Contenuto da segnalare non indicato.</odys-notice>
      }
    </div>
  `,
  styles: `
    .narrow { max-width: 720px; }
    .back { display: inline-flex; align-items: center; gap: var(--space-1); margin-bottom: var(--space-4); color: var(--color-text-muted); text-decoration: none; }
    .eyebrow { margin-bottom: var(--space-2); } h1 { font-size: var(--text-3xl); margin-bottom: var(--space-2); }
    form { display: flex; flex-direction: column; gap: var(--space-4); margin-top: var(--space-5); }
    fieldset { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
    legend, label { font-weight: 600; font-size: var(--text-sm); margin-bottom: var(--space-2); }
    .chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    textarea { width: 100%; padding: var(--space-3); border-radius: var(--radius-md); border: var(--border-width) solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); font: inherit; resize: vertical; }
    button[type='submit'] { align-self: flex-start; }
    odys-notice { margin-top: var(--space-4); }
  `,
})
export default class ReportPage {
  private readonly api = inject(ModerationApi);
  readonly tipo = input<string>();
  readonly id = input<string>();

  protected readonly reasons = REPORT_REASONS;
  protected readonly reason = signal<ReportReason | null>(null);
  protected readonly details = signal('');
  protected readonly sending = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal('');
  protected readonly target = computed(() => {
    const kind = TARGETS[this.tipo() ?? ''];
    const id = this.id();
    return kind && id ? { kind, id } : null;
  });
  protected readonly targetLabel = computed(() => this.target() ? REPORT_TARGET_LABELS[this.target()!.kind] : '');
  protected readonly back = computed(() => this.target() ? BACK[this.target()!.kind](this.target()!.id) : ['/']);

  protected async send(): Promise<void> {
    const target = this.target();
    const reason = this.reason();
    if (!target || !reason) return;
    this.sending.set(true);
    this.error.set('');
    try {
      await this.api.report(target.kind, target.id, reason, this.details().trim());
      this.sent.set(true);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile inviare la segnalazione.'));
    } finally {
      this.sending.set(false);
    }
  }
}
