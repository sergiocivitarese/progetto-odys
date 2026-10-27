import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, type ApplicationReview, type ApplicationStatus } from '../../core/api/catalog.api';
import { ButtonComponent, ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';
import { AdminNavComponent } from './admin-nav.component';

const STATUS_LABELS: Record<ApplicationStatus, string> = { pending: 'In attesa', approved: 'Approvata', rejected: 'Rifiutata' };

/**
 * Amministrazione · candidature a coordinatore (G-01): revisione dei requisiti,
 * approvazione o rifiuto con nota interna e messaggio per il candidato.
 */
@Component({
  selector: 'odys-admin-applications-page',
  imports: [DatePipe, FormsModule, AdminNavComponent, ButtonComponent, ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="head">
        <p class="eyebrow">Amministrazione</p>
        <h1>Candidature dei coordinatori</h1>
        <p class="muted">Approva solo profili completi e con esperienza verificabile: l’approvazione attiva subito il ruolo di coordinatore.</p>
      </header>
      <odys-admin-nav />

      <div class="filters" role="group" aria-label="Filtra per stato">
        @for (option of filters; track option.value) {
          <button odysChip [selected]="filter() === option.value" (click)="filter.set(option.value)">{{ option.label }} · {{ count(option.value) }}</button>
        }
      </div>
      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}

      @if (loading()) {
        <p class="muted"><odys-icon name="loader" /> Caricamento delle candidature…</p>
      } @else {
        @for (item of visible(); track item.id) {
          <article class="card">
            <header class="card__head">
              <div>
                <h2>{{ item.firstName }} {{ item.lastName }}</h2>
                <p class="muted small">{{ item.email }} · inviata il {{ item.createdAt | date: 'd MMM y' }}</p>
              </div>
              <span class="status status--{{ item.status }}">{{ label(item.status) }}</span>
            </header>
            <dl>
              <div><dt>Motivazione</dt><dd>{{ item.motivation }}</dd></div>
              <div><dt>Esperienza</dt><dd>{{ item.experience }}</dd></div>
              <div><dt>Viaggi organizzati</dt><dd>{{ item.tripsLed }}</dd></div>
              @if (item.languages.length) {<div><dt>Lingue</dt><dd>{{ item.languages.join(', ') }}</dd></div>}
              @if (item.links.length) {
                <div><dt>Link</dt><dd>@for (link of item.links; track link) {<a [href]="link" target="_blank" rel="noopener noreferrer">{{ link }}</a> }</dd></div>
              }
              <div><dt>Presentazione del profilo</dt><dd>{{ item.bio || '—' }}</dd></div>
              @if (item.interests.length) {<div><dt>Interessi</dt><dd>{{ item.interests.join(', ') }}</dd></div>}
            </dl>

            @if (item.status === 'pending') {
              <div class="decision">
                <label [for]="'note-' + item.id">Nota interna <span class="muted">(non visibile al candidato)</span></label>
                <textarea [id]="'note-' + item.id" rows="2" maxlength="1000" [ngModel]="notes()[item.id] || ''" (ngModelChange)="setNote(item.id, $event)"></textarea>
                <label [for]="'message-' + item.id">Messaggio per il candidato <span class="muted">(facoltativo)</span></label>
                <textarea [id]="'message-' + item.id" rows="2" maxlength="600" [ngModel]="messages()[item.id] || ''" (ngModelChange)="setMessage(item.id, $event)"></textarea>
                <div class="actions">
                  <button odysButton variant="accent" icon="check" [disabled]="busy() === item.id" (click)="decide(item, 'approve')">Approva e attiva il ruolo</button>
                  <button odysButton variant="ghost" icon="x" [disabled]="busy() === item.id" (click)="decide(item, 'reject')">Rifiuta</button>
                </div>
              </div>
            } @else {
              <p class="muted small">Valutata il {{ item.decidedAt | date: 'd MMM y' }}@if (item.adminNote) { · nota interna: {{ item.adminNote }}}@if (item.reviewerMessage) { · messaggio al candidato: {{ item.reviewerMessage }}}</p>
            }
          </article>
        } @empty {
          <odys-empty-state icon="shield" title="Nessuna candidatura in questo stato" description="Le nuove candidature inviate dall’area coordinatore compaiono qui." />
        }
      }
    </div>
  `,
  styles: `
    .head { margin-bottom: var(--space-5); h1 { font-size: var(--text-3xl); } }
    .filters { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-4); }
    .card { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5); margin-bottom: var(--space-3); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); }
    .card__head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--space-3); h2 { font-size: var(--text-xl); } }
    dl { display: grid; gap: var(--space-3); margin: 0; }
    dt { font-size: var(--text-sm); font-weight: 700; color: var(--color-text-muted); }
    dd { margin: 0; overflow-wrap: anywhere; white-space: pre-line; }
    .status { padding: 4px 10px; border-radius: var(--radius-pill); font-size: var(--text-xs); font-weight: 700; background: var(--color-surface-muted); }
    .status--approved { background: var(--color-accent); color: var(--color-on-accent); }
    .status--rejected { background: var(--color-danger-soft); color: var(--color-danger-text); }
    .decision { display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-4); border-top: var(--border-width) solid var(--color-border);
      label { font-weight: 600; font-size: var(--text-sm); }
      textarea { width: 100%; padding: var(--space-3); border-radius: var(--radius-md); border: var(--border-width) solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); font: inherit; resize: vertical; } }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
    .small { font-size: var(--text-sm); }
  `,
})
export default class AdminApplicationsPage implements OnInit {
  private readonly api = inject(CatalogApi);
  protected readonly applications = signal<ApplicationReview[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly busy = signal('');
  protected readonly filter = signal<ApplicationStatus>('pending');
  protected readonly notes = signal<Record<string, string>>({});
  protected readonly messages = signal<Record<string, string>>({});
  protected readonly filters: Array<{ value: ApplicationStatus; label: string }> = [
    { value: 'pending', label: 'In attesa' },
    { value: 'approved', label: 'Approvate' },
    { value: 'rejected', label: 'Rifiutate' },
  ];
  protected readonly visible = computed(() => this.applications().filter((item) => item.status === this.filter()));

  async ngOnInit(): Promise<void> {
    try {
      this.applications.set(await this.api.applications());
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile caricare le candidature.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected count(status: ApplicationStatus): number {
    return this.applications().filter((item) => item.status === status).length;
  }

  protected label(status: ApplicationStatus): string {
    return STATUS_LABELS[status];
  }

  protected setNote(id: string, value: string): void {
    this.notes.update((current) => ({ ...current, [id]: value }));
  }

  protected setMessage(id: string, value: string): void {
    this.messages.update((current) => ({ ...current, [id]: value }));
  }

  protected async decide(item: ApplicationReview, decision: 'approve' | 'reject'): Promise<void> {
    this.busy.set(item.id);
    this.error.set('');
    try {
      const updated = await this.api.decideApplication(item.id, decision, (this.notes()[item.id] ?? '').trim(), (this.messages()[item.id] ?? '').trim());
      this.applications.update((list) => list.map((current) => current.id === updated.id ? updated : current));
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile registrare la decisione.'));
    } finally {
      this.busy.set('');
    }
  }
}
