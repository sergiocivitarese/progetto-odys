import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import type { TripChangeKind } from '../../../core/api/trips.api';
import { ButtonComponent, DialogComponent, IconComponent, type IconName, NoticeComponent } from '../../../shared/ui';
import { ItineraryStore } from '../itinerary.store';

const KIND: Record<TripChangeKind, { label: string; icon: IconName }> = {
  created: { label: 'Viaggio creato', icon: 'star' },
  edited: { label: 'Itinerario modificato', icon: 'edit' },
  dates: { label: 'Date e arrivo', icon: 'calendar' },
  budget: { label: 'Budget', icon: 'credit-card' },
  lodging: { label: 'Alloggio e percorsi', icon: 'home' },
  geography: { label: 'Posizione confermata', icon: 'map-pin' },
  progress: { label: 'Avanzamento', icon: 'check' },
  route: { label: 'Percorso online', icon: 'route' },
  import: { label: 'Importato', icon: 'upload' },
  restore: { label: 'Ripristino', icon: 'restore' },
};

/** Cronologia delle versioni salvate, con ripristino (lo storico non perde mai nulla). */
@Component({
  selector: 'odys-version-history-dialog',
  imports: [DatePipe, ButtonComponent, DialogComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <odys-dialog [open]="open()" title="Cronologia del viaggio" (closed)="confirming.set(null); closed.emit()">
      <p class="muted intro">Ogni salvataggio crea una versione. Ripristinarne una non cancella le altre: diventa la versione più recente.</p>
      @if (store.versionsLoading() && !store.versions().length) {
        <p class="muted"><odys-icon name="loader" /> Caricamento…</p>
      }
      <ol class="versions">
        @for (item of store.versions(); track item.version; let first = $first) {
          <li [class.is-current]="first">
            <span class="icon"><odys-icon [name]="kind(item.changeKind).icon" [size]="16" /></span>
            <div class="body">
              <p><strong>Versione {{ item.version }}</strong> · {{ kind(item.changeKind).label }} @if (first) {<span class="current">attuale</span>}</p>
              <p class="muted small">{{ item.createdAt | date: 'd MMM y, HH:mm' }}@if (item.summary) { · {{ item.summary }}}</p>
              @if (confirming() === item.version) {
                <odys-notice tone="warning">
                  Ripristinare la versione {{ item.version }}? Le modifiche successive restano nello storico.
                  <div class="actions">
                    <button odysButton size="sm" icon="restore" [loading]="busy()" (click)="restore(item.version)">Ripristina</button>
                    <button odysButton variant="ghost" size="sm" (click)="confirming.set(null)">Annulla</button>
                  </div>
                </odys-notice>
              }
            </div>
            @if (!first && confirming() !== item.version) {
              <button odysButton variant="ghost" size="sm" icon="restore" (click)="confirming.set(item.version)">Ripristina</button>
            }
          </li>
        } @empty {
          @if (!store.versionsLoading()) {<li class="muted">Nessuna versione salvata.</li>}
        }
      </ol>
    </odys-dialog>
  `,
  styles: `
    .intro { font-size: var(--text-sm); margin-bottom: var(--space-4); }
    .versions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    li { display: flex; gap: var(--space-3); align-items: flex-start; padding: var(--space-3) 0; border-bottom: var(--border-width) solid var(--color-border); }
    .icon { display: grid; place-items: center; width: 32px; height: 32px; flex-shrink: 0; border-radius: var(--radius-sm); background: var(--color-surface-muted); }
    li.is-current .icon { background: var(--color-accent); color: var(--color-on-accent); }
    .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .small { font-size: var(--text-sm); }
    .current { margin-left: var(--space-1); padding: 1px 8px; border-radius: var(--radius-pill); background: var(--color-accent-soft); font-size: var(--text-xs); font-weight: 700; }
    .actions { display: flex; gap: var(--space-2); margin-top: var(--space-2); }
    odys-notice { margin-top: var(--space-2); }
  `,
})
export class VersionHistoryDialogComponent {
  protected readonly store = inject(ItineraryStore);
  readonly open = input(false);
  readonly closed = output<void>();
  protected readonly confirming = signal<number | null>(null);
  protected readonly busy = signal(false);

  protected kind(value: TripChangeKind) {
    return KIND[value] ?? KIND.edited;
  }

  protected async restore(version: number): Promise<void> {
    this.busy.set(true);
    const ok = await this.store.restoreVersion(version);
    this.busy.set(false);
    this.confirming.set(null);
    if (ok) this.closed.emit();
  }
}
