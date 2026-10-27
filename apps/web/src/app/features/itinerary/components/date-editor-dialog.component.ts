import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { dateFieldsOf, nodeIdForLabel, type Itinerary, type TripDateFields } from '@odys/domain';
import { apiErrorMessage } from '../../../core/api/api-client';
import { ButtonComponent, ChipComponent, DialogComponent, NoticeComponent, TextFieldComponent } from '../../../shared/ui';
import { ItineraryStore } from '../itinerary.store';

/**
 * Modifica di date, arrivo e orari. Se cambiano durata o arrivo chiede una
 * conferma esplicita prima di ricalcolare (attività, ordine e note restano).
 */
@Component({
  selector: 'odys-date-editor-dialog',
  imports: [DialogComponent, ButtonComponent, ChipComponent, NoticeComponent, TextFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <odys-dialog [open]="open()" title="Modifica date, arrivo e orari" (closed)="closed.emit()">
      <p class="muted intro">Le attività restano nel loro ordine; vedrai una conferma prima di salvare le tratte che dipendono dall’arrivo.</p>
      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
      <div class="fields">
        <div class="two">
          <odys-text-field label="Data di partenza" type="date" [value]="fields().departure" (valueChange)="patch({ departure: $event })" />
          <odys-text-field label="Data di rientro" type="date" [value]="fields().returnDate" (valueChange)="patch({ returnDate: $event })" />
        </div>
        <div class="group">
          <p class="label">Quando arrivi?</p>
          <div class="chips">
            <button odysChip [selected]="!fields().arrivalDate && fields().arrivalDayOffset !== 1" (click)="patch({ arrivalDate: undefined, arrivalDayOffset: 0 })">Lo stesso giorno</button>
            <button odysChip [selected]="!fields().arrivalDate && fields().arrivalDayOffset === 1" (click)="patch({ arrivalDate: undefined, arrivalDayOffset: 1 })">Il giorno successivo</button>
            <button odysChip [selected]="!!fields().arrivalDate" (click)="patch({ arrivalDate: fields().arrivalDate || fields().departure, arrivalDayOffset: undefined })">Data specifica</button>
          </div>
        </div>
        <odys-text-field label="Data di arrivo specifica (facoltativa)" type="date" [value]="fields().arrivalDate ?? ''" (valueChange)="patch({ arrivalDate: $event || undefined, arrivalDayOffset: $event ? undefined : fields().arrivalDayOffset ?? 0 })" />
        <div class="two">
          <odys-text-field label="Orario di arrivo" type="time" [value]="fields().arrivalTime" (valueChange)="patch({ arrivalTime: $event })" />
          <odys-text-field label="Orario di partenza" type="time" [value]="fields().departureTime" (valueChange)="patch({ departureTime: $event })" />
        </div>
        <div class="group">
          <p class="label">Prima destinazione dopo l’arrivo</p>
          <div class="chips">
            <button odysChip [selected]="fields().arrivalDestinationKind === 'lodging'" (click)="patch({ arrivalDestinationKind: 'lodging', arrivalDestinationPoint: undefined })">Alloggio</button>
            <button odysChip [selected]="fields().arrivalDestinationKind === 'first-activity'" (click)="patch({ arrivalDestinationKind: 'first-activity', arrivalDestinationPoint: undefined })">Prima attività</button>
            <button odysChip [selected]="fields().arrivalDestinationKind === 'custom'" (click)="patch({ arrivalDestinationKind: 'custom' })">Punto personalizzato</button>
          </div>
        </div>
        @if (fields().arrivalDestinationKind === 'custom') {
          <odys-text-field label="Punto personalizzato" icon="map-pin" [value]="fields().arrivalDestinationPoint?.label ?? ''" (valueChange)="setCustomPoint($event)" />
        }
      </div>
      @if (needsConfirmation()) {
        <odys-notice tone="warning" title="Conferma il ricalcolo" class="confirm">Conserviamo attività, ordine e note. Aggiorniamo solo le giornate e le tratte dipendenti da date, arrivo o prima destinazione.</odys-notice>
      }
      <ng-container dialog-actions>
        @if (needsConfirmation()) {
          <button odysButton variant="ghost" (click)="needsConfirmation.set(false)">Annulla</button>
          <button odysButton icon="check" [loading]="busy()" (click)="apply()">Conferma e ricalcola</button>
        } @else {
          <button odysButton variant="ghost" (click)="closed.emit()">Annulla</button>
          <button odysButton icon="check" [loading]="busy()" (click)="submit()">Salva date e ricalcola</button>
        }
      </ng-container>
    </odys-dialog>
  `,
  styles: `
    .intro { font-size: var(--text-sm); margin-bottom: var(--space-4); }
    .fields { display: flex; flex-direction: column; gap: var(--space-4); margin-top: var(--space-3); }
    .two { display: grid; gap: var(--space-4); grid-template-columns: 1fr 1fr; }
    .group { display: flex; flex-direction: column; gap: var(--space-2); }
    .label { font-size: var(--text-sm); font-weight: 600; }
    .chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .confirm { margin-top: var(--space-4); }
  `,
})
export class DateEditorDialogComponent {
  private readonly store = inject(ItineraryStore);
  readonly open = input(false);
  readonly plan = input.required<Itinerary>();
  readonly closed = output<void>();

  protected readonly fields = signal<TripDateFields>({ departure: '', returnDate: '', arrivalTime: '', departureTime: '' });
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly needsConfirmation = signal(false);

  constructor() {
    effect(() => {
      if (this.open()) {
        this.fields.set(dateFieldsOf(this.plan()));
        this.error.set('');
        this.needsConfirmation.set(false);
      }
    });
  }

  protected patch(value: Partial<TripDateFields>): void {
    this.fields.update((current) => ({ ...current, ...value }));
    this.needsConfirmation.set(false);
  }

  protected setCustomPoint(label: string): void {
    this.patch({ arrivalDestinationPoint: label.trim() ? { id: nodeIdForLabel(label, 'manual'), label: label.trim(), type: 'custom', source: 'Inserito manualmente', reliabilityStatus: 'MISSING', geoStatus: 'MISSING' } : undefined });
  }

  protected async submit(): Promise<void> {
    this.busy.set(true);
    try {
      const check = await this.store.checkDates(this.fields());
      if (check.error) this.error.set(check.error);
      else if (check.requiresConfirmation) this.needsConfirmation.set(true);
      else await this.apply();
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async apply(): Promise<void> {
    this.busy.set(true);
    try {
      if (await this.store.applyDates(this.fields())) this.closed.emit();
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
