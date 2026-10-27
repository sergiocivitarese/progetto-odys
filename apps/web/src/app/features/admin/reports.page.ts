import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-client';
import { ModerationApi, REPORT_REASONS, REPORT_TARGET_LABELS, type ReportAction, type ReportReview, type ReportStatus } from '../../core/api/moderation.api';
import { ButtonComponent, ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';
import { AdminNavComponent } from './admin-nav.component';

const LINKS: Record<string, (id: string) => string[]> = { post: (id) => ['/esplora', id], published_trip: (id) => ['/gruppi', id], profile: (id) => ['/coordinatori', id] };
const ACTION_LABELS: Record<string, string> = { none: 'nessun intervento', hidden: 'contenuto rimosso', suspended: 'account sospeso' };

/**
 * Coda di revisione delle segnalazioni (G-03, G-04, S-07): contenuto, motivo,
 * numero di segnalazioni; decisione con nota, applicata a tutte le segnalazioni
 * aperte sullo stesso contenuto e registrata nel registro attività.
 */
@Component({
  selector: 'odys-admin-reports-page',
  imports: [DatePipe, FormsModule, RouterLink, AdminNavComponent, ButtonComponent, ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="head">
        <p class="eyebrow">Amministrazione</p>
        <h1>Segnalazioni</h1>
      </header>
      <odys-admin-nav />
      <div class="filters" role="group" aria-label="Filtra per stato">
        @for (option of filters; track option.value) {
          <button odysChip [selected]="filter() === option.value" (click)="filter.set(option.value)">{{ option.label }} · {{ count(option.value) }}</button>
        }
      </div>
      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
      @if (loading()) {
        <p class="muted"><odys-icon name="loader" /> Caricamento…</p>
      } @else {
        @for (item of visible(); track item.id) {
          <article class="card">
            <header class="card__head">
              <div>
                <p class="eyebrow">{{ targetLabel(item) }} · {{ reasonLabel(item) }}@if (item.reportsOnTarget > 1) { · {{ item.reportsOnTarget }} segnalazioni}</p>
                <h2><a [routerLink]="link(item)">{{ item.targetTitle || 'Contenuto senza titolo' }}</a></h2>
                <p class="muted small">Di {{ item.targetOwnerName || '—' }} · segnalato da {{ item.reporterEmail }} il {{ item.createdAt | date: 'd MMM y, HH:mm' }}</p>
              </div>
              <span class="status status--{{ item.status }}">{{ statusLabel(item) }}</span>
            </header>
            @if (item.details) {<p class="details">“{{ item.details }}”</p>}
            @if (item.status === 'open') {
              <label class="label" [for]="'note-' + item.id">Nota per il registro</label>
              <textarea [id]="'note-' + item.id" rows="2" maxlength="1000" [ngModel]="notes()[item.id] || ''" (ngModelChange)="setNote(item.id, $event)"></textarea>
              <div class="actions">
                @if (item.targetKind !== 'profile') {
                  <button odysButton variant="accent" icon="x" [disabled]="busy() === item.id" (click)="resolve(item, 'hidden')">Rimuovi il contenuto</button>
                }
                <button odysButton variant="secondary" icon="lock" [disabled]="busy() === item.id" (click)="resolve(item, 'suspended')">Sospendi l’account</button>
                <button odysButton variant="ghost" [disabled]="busy() === item.id" (click)="resolve(item, 'dismiss')">Archivia senza interventi</button>
              </div>
            } @else {
              <p class="muted small">Decisa il {{ item.decidedAt | date: 'd MMM y' }} · {{ actionLabel(item) }}@if (item.resolutionNote) { · {{ item.resolutionNote }}}</p>
            }
          </article>
        } @empty {
          <odys-empty-state icon="shield" title="Nessuna segnalazione in questo stato" description="Le segnalazioni degli utenti su post, viaggi e profili arrivano qui." />
        }
      }
    </div>
  `,
  styles: `
    .head { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-4); h1 { font-size: var(--text-3xl); } }
    .filters { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-4); }
    .card { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5); margin-bottom: var(--space-3); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); }
    .card__head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-3); h2 { font-size: var(--text-xl); } h2 a { color: var(--color-text); } }
    .details { padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface-muted); }
    .label { font-size: var(--text-sm); font-weight: 600; }
    textarea { width: 100%; padding: var(--space-3); border-radius: var(--radius-md); border: var(--border-width) solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); font: inherit; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .status { align-self: flex-start; padding: 4px 10px; border-radius: var(--radius-pill); font-size: var(--text-xs); font-weight: 700; background: var(--color-danger-soft); color: var(--color-danger-text); }
    .status--resolved, .status--dismissed { background: var(--color-surface-muted); color: var(--color-text-muted); }
    .small { font-size: var(--text-sm); }
  `,
})
export default class AdminReportsPage implements OnInit {
  private readonly api = inject(ModerationApi);
  protected readonly reports = signal<ReportReview[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly busy = signal('');
  protected readonly notes = signal<Record<string, string>>({});
  protected readonly filter = signal<ReportStatus>('open');
  protected readonly filters: Array<{ value: ReportStatus; label: string }> = [
    { value: 'open', label: 'Da valutare' },
    { value: 'resolved', label: 'Con intervento' },
    { value: 'dismissed', label: 'Archiviate' },
  ];
  protected readonly visible = computed(() => this.reports().filter((item) => item.status === this.filter()));

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      this.reports.set(await this.api.reports());
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Segnalazioni non disponibili.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected count(status: ReportStatus): number { return this.reports().filter((item) => item.status === status).length; }
  protected targetLabel(item: ReportReview): string { return REPORT_TARGET_LABELS[item.targetKind]; }
  protected reasonLabel(item: ReportReview): string { return REPORT_REASONS.find((reason) => reason.value === item.reason)?.label ?? item.reason; }
  protected statusLabel(item: ReportReview): string { return item.status === 'open' ? 'Da valutare' : item.status === 'resolved' ? 'Intervento' : 'Archiviata'; }
  protected actionLabel(item: ReportReview): string { return ACTION_LABELS[item.actionTaken ?? 'none']; }
  protected link(item: ReportReview): string[] { return LINKS[item.targetKind](item.targetId); }
  protected setNote(id: string, value: string): void { this.notes.update((current) => ({ ...current, [id]: value })); }

  protected async resolve(item: ReportReview, action: ReportAction): Promise<void> {
    if (action === 'suspended' && !confirm(`Sospendere l’account di ${item.targetOwnerName || 'questo utente'}? Perderà le funzioni da coordinatore finché non lo riattivi.`)) return;
    this.busy.set(item.id);
    this.error.set('');
    try {
      await this.api.resolve(item.id, action, (this.notes()[item.id] || '').trim());
      await this.load();
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Decisione non registrata.'));
    } finally {
      this.busy.set('');
    }
  }
}
