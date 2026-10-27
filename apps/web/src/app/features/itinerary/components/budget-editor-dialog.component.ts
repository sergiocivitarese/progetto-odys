import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import type { Itinerary } from '@odys/domain';
import { apiErrorMessage } from '../../../core/api/api-client';
import { ButtonComponent, DialogComponent, NoticeComponent, TextFieldComponent } from '../../../shared/ui';
import { ItineraryStore } from '../itinerary.store';

/** Conferma esplicita del budget per viaggiatore: il totale si calcola solo dopo. */
@Component({
  selector: 'odys-budget-editor-dialog',
  imports: [DialogComponent, ButtonComponent, NoticeComponent, TextFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <odys-dialog [open]="open()" title="Budget per viaggiatore" (closed)="closed.emit()">
      <p class="muted intro">Conferma esplicitamente il valore per viaggiatore. Il totale viene calcolato solo dopo questa conferma.</p>
      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
      <div class="fields">
        <odys-text-field label="Budget per viaggiatore" icon="credit-card" placeholder="Es. 1.000€" [(value)]="budget" />
        <odys-text-field label="Viaggiatori" icon="users" inputMode="numeric" placeholder="Es. 2" [(value)]="travelers" />
      </div>
      <ng-container dialog-actions>
        <button odysButton variant="ghost" (click)="closed.emit()">Annulla</button>
        <button odysButton icon="check" [loading]="busy()" (click)="confirm()">Conferma e calcola totale</button>
      </ng-container>
    </odys-dialog>
  `,
  styles: `.intro { font-size: var(--text-sm); margin-bottom: var(--space-4); } .fields { display: grid; gap: var(--space-4); margin-top: var(--space-3); }`,
})
export class BudgetEditorDialogComponent {
  private readonly store = inject(ItineraryStore);
  readonly open = input(false);
  readonly plan = input.required<Itinerary>();
  readonly closed = output<void>();
  protected readonly budget = signal('');
  protected readonly travelers = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);

  constructor() {
    effect(() => {
      if (this.open()) {
        this.budget.set(this.plan().budgetPerTraveler ?? this.plan().budget ?? '');
        this.travelers.set(this.plan().travelers ?? '');
        this.error.set('');
      }
    });
  }

  protected async confirm(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      if (await this.store.confirmBudget({ travelers: this.travelers(), budgetPerTraveler: this.budget() })) this.closed.emit();
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
