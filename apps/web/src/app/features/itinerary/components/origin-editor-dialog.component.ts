import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import type { Itinerary, LodgingInfo } from '@odys/domain';
import { apiErrorMessage } from '../../../core/api/api-client';
import { ButtonComponent, DialogComponent, NoticeComponent, TextFieldComponent } from '../../../shared/ui';
import { ItineraryStore } from '../itinerary.store';

/** Alloggio o punto di partenza: mostra un riepilogo dei percorsi prima di salvare. */
@Component({
  selector: 'odys-origin-editor-dialog',
  imports: [DialogComponent, ButtonComponent, NoticeComponent, TextFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <odys-dialog [open]="open()" title="Completa punto di partenza" (closed)="closed.emit()">
      <p class="muted intro">Le attività resteranno nello stesso ordine. Vedrai un riepilogo prima di salvare i nuovi percorsi demo.</p>
      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
      <div class="fields">
        <odys-text-field label="Alloggio" icon="home" placeholder="Es. Hotel vicino al centro" [value]="fields().name ?? ''" (valueChange)="patch({ name: $event })" />
        <div class="two">
          <odys-text-field label="Indirizzo" placeholder="Facoltativo" [value]="fields().address ?? ''" (valueChange)="patch({ address: $event })" />
          <odys-text-field label="Zona" placeholder="Facoltativo" [value]="fields().zone ?? ''" (valueChange)="patch({ zone: $event })" />
        </div>
        <odys-text-field label="Punto di partenza personalizzato" icon="map-pin" placeholder="Es. Piazza principale" [value]="fields().customStartingPoint ?? ''" (valueChange)="patch({ customStartingPoint: $event })" />
        <p class="muted hint">Cercheremo la posizione automaticamente dopo il salvataggio. Non chiediamo coordinate tecniche.</p>
      </div>
      @if (preview(); as next) {
        <odys-notice tone="info" title="Riepilogo aggiornamento" class="preview">
          Conserviamo {{ activityCount() }} attività e il loro ordine. Aggiorniamo solo origini, destinazioni, tratte, mezzi e indicazioni di orario.<br />
          <strong>Prima:</strong> {{ plan().routeSummary }}<br />
          <strong>Dopo:</strong> {{ next.routeSummary }}
        </odys-notice>
      }
      <ng-container dialog-actions>
        @if (preview()) {
          <button odysButton variant="ghost" (click)="preview.set(null)">Annulla anteprima</button>
          <button odysButton icon="check" [loading]="busy()" (click)="confirm()">Salva nuova versione</button>
        } @else {
          <button odysButton variant="ghost" (click)="closed.emit()">Annulla</button>
          <button odysButton icon="navigation" [loading]="busy()" (click)="showPreview()">Mostra riepilogo percorsi</button>
        }
      </ng-container>
    </odys-dialog>
  `,
  styles: `
    .intro { font-size: var(--text-sm); margin-bottom: var(--space-4); }
    .fields { display: flex; flex-direction: column; gap: var(--space-4); margin-top: var(--space-3); }
    .two { display: grid; gap: var(--space-4); grid-template-columns: 1fr 1fr; }
    .hint { font-size: var(--text-xs); }
    .preview { margin-top: var(--space-4); }
  `,
})
export class OriginEditorDialogComponent {
  private readonly store = inject(ItineraryStore);
  readonly open = input(false);
  readonly plan = input.required<Itinerary>();
  readonly closed = output<void>();
  protected readonly fields = signal<LodgingInfo>({});
  protected readonly preview = signal<Itinerary | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly activityCount = computed(() => this.plan().days.reduce((total, day) => total + day.activities.length, 0));

  constructor() {
    effect(() => {
      if (this.open()) {
        this.fields.set({ ...(this.plan().lodging ?? {}) });
        this.preview.set(null);
        this.error.set('');
      }
    });
  }

  protected patch(value: Partial<LodgingInfo>): void {
    this.fields.update((current) => ({ ...current, ...value }));
    this.preview.set(null);
  }

  protected async showPreview(): Promise<void> {
    await this.run(async () => this.preview.set(await this.store.previewOrigin(this.fields())));
  }

  protected async confirm(): Promise<void> {
    const preview = this.preview();
    if (preview) await this.run(async () => { if (await this.store.confirmOrigin(preview)) this.closed.emit(); });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try { await action(); } catch (error) { this.error.set(apiErrorMessage(error)); } finally { this.busy.set(false); }
  }
}
