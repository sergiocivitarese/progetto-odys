import { ChangeDetectionStrategy, Component, inject, input, output, signal, effect } from '@angular/core';
import type { SavedTrip } from '@odys/domain';
import { apiErrorMessage } from '../../../core/api/api-client';
import { TripsStore } from '../../../core/state/trips.store';
import { ButtonComponent, DialogComponent, NoticeComponent, TextFieldComponent } from '../../../shared/ui';

/**
 * Import di un export JSON (Odys o Triply v5). Se il viaggio esiste già,
 * chiede conferma prima di sostituirlo — come nella Home originale.
 */
@Component({
  selector: 'odys-import-trip-dialog',
  imports: [DialogComponent, ButtonComponent, TextFieldComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <odys-dialog [open]="open()" [title]="pending() ? 'Sostituire il viaggio esistente?' : 'Importa viaggio JSON'" (closed)="closed.emit()">
      @if (pending(); as trip) {
        <p class="muted">L’export contiene “{{ trip.title }}” con lo stesso identificativo di un viaggio già salvato. Conferma prima di sostituirlo.</p>
      } @else {
        <p class="muted hint">Incolla un export Odys (compatibile con Triply v5) oppure carica il file. I file corrotti o di un’altra versione vengono rifiutati senza modificare i viaggi salvati.</p>
        <label class="file">
          <input type="file" accept="application/json,.json" (change)="readFile($event)" />
          <span>Scegli file .json</span>
        </label>
        <odys-text-field label="Contenuto JSON" [(value)]="raw" [multiline]="true" placeholder='{"format":"travel-companion-trip", ...}' />
      }
      @if (error()) {<odys-notice tone="danger" class="spaced">{{ error() }}</odys-notice>}
      <ng-container dialog-actions>
        @if (pending()) {
          <button odysButton variant="ghost" (click)="pending.set(null)">Annulla</button>
          <button odysButton icon="check" [loading]="busy()" (click)="persist()">Sostituisci</button>
        } @else {
          <button odysButton variant="ghost" (click)="closed.emit()">Annulla</button>
          <button odysButton icon="upload" [disabled]="!raw().trim()" [loading]="busy()" (click)="submit()">Importa</button>
        }
      </ng-container>
    </odys-dialog>
  `,
  styles: `
    .hint { font-size: var(--text-sm); margin-bottom: var(--space-3); }
    .spaced { margin-top: var(--space-3); }
    .file { display: inline-flex; margin-bottom: var(--space-3); cursor: pointer; }
    .file input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .file span { padding: var(--space-2) var(--space-4); border-radius: var(--radius-pill); border: var(--border-width) dashed var(--color-border-strong); font-size: var(--text-sm); font-weight: 600; }
    .file:focus-within span { outline: 3px solid var(--color-focus); outline-offset: 2px; }
  `,
})
export class ImportTripDialogComponent {
  private readonly store = inject(TripsStore);
  readonly open = input(false);
  readonly closed = output<void>();
  readonly imported = output<{ trip: SavedTrip; replaced: boolean }>();

  protected readonly raw = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly pending = signal<SavedTrip | null>(null);

  constructor() {
    effect(() => {
      if (!this.open()) {
        this.raw.set('');
        this.error.set('');
        this.pending.set(null);
      }
    });
  }

  protected async readFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.raw.set(await file.text());
  }

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const preview = await this.store.previewImport(this.raw());
      if (preview.replacesExisting) this.pending.set(preview.trip);
      else await this.persist();
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile leggere questo export.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async persist(): Promise<void> {
    this.busy.set(true);
    try {
      this.imported.emit(await this.store.import(this.raw()));
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile salvare il viaggio importato.'));
    } finally {
      this.busy.set(false);
    }
  }
}
