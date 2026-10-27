import { ChangeDetectionStrategy, Component, inject, input, output, signal, effect } from '@angular/core';
import type { SavedTrip } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { TripsStore } from '../../core/state/trips.store';
import { ButtonComponent, DialogComponent, NoticeComponent, TextFieldComponent } from '../ui';

/**
 * Dialoghi "Rinomina" ed "Elimina" di un viaggio. Il genitore imposta
 * `renaming` o `deleting`; il componente chiama lo store ed emette `done`.
 */
@Component({
  selector: 'odys-trip-management-dialogs',
  imports: [DialogComponent, ButtonComponent, TextFieldComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <odys-dialog [open]="!!renaming()" title="Rinomina viaggio" (closed)="done.emit()">
      <p class="muted hint">Scegli un nome per ritrovarlo più facilmente.</p>
      <odys-text-field label="Nome del viaggio" [(value)]="name" placeholder="Es. Weekend a Lisbona" icon="edit" />
      @if (error()) {<odys-notice tone="danger" class="spaced">{{ error() }}</odys-notice>}
      <ng-container dialog-actions>
        <button odysButton variant="ghost" (click)="done.emit()">Annulla</button>
        <button odysButton icon="check" [disabled]="!name().trim()" [loading]="busy()" (click)="confirmRename()">Salva nome</button>
      </ng-container>
    </odys-dialog>

    <odys-dialog [open]="!!deleting()" title="Eliminare il viaggio?" (closed)="done.emit()">
      <p class="muted">“{{ deleting()?.title }}” verrà rimosso dai tuoi viaggi. L’operazione non si può annullare.</p>
      @if (error()) {<odys-notice tone="danger" class="spaced">{{ error() }}</odys-notice>}
      <ng-container dialog-actions>
        <button odysButton variant="ghost" (click)="done.emit()">Annulla</button>
        <button odysButton variant="danger" icon="trash" [loading]="busy()" (click)="confirmDelete()">Elimina viaggio</button>
      </ng-container>
    </odys-dialog>
  `,
  styles: `.hint { margin-bottom: var(--space-3); font-size: var(--text-sm); } .spaced { margin-top: var(--space-3); }`,
})
export class TripManagementDialogsComponent {
  private readonly store = inject(TripsStore);
  readonly renaming = input<SavedTrip | null>(null);
  readonly deleting = input<SavedTrip | null>(null);
  readonly done = output<void>();
  protected readonly name = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  constructor() {
    effect(() => {
      this.name.set(this.renaming()?.title ?? '');
      this.error.set('');
    });
  }

  protected async confirmRename(): Promise<void> {
    const trip = this.renaming();
    if (!trip || !this.name().trim()) return;
    await this.run(() => this.store.rename(trip.id, this.name()));
  }

  protected async confirmDelete(): Promise<void> {
    const trip = this.deleting();
    if (trip) await this.run(() => this.store.remove(trip.id));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await action();
      this.done.emit();
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
