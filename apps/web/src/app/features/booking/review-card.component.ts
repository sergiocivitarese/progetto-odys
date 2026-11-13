import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, type PublishedTripSummary } from '../../core/api/catalog.api';
import { NoticeComponent } from '../../shared/ui';

/**
 * Recensione a fine viaggio (TB-12): voto al coordinatore e al viaggio, più un
 * commento facoltativo. La recensione compare sul profilo del coordinatore.
 */
@Component({
  selector: 'odys-review-card',
  imports: [FormsModule, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="review" (submit)="$event.preventDefault(); save()">
      <h2>Com’è andato {{ trip().destination || trip().title }}?</h2>
      <p class="muted">La tua recensione aiuta chi sceglie il prossimo viaggio con {{ trip().coordinator.displayName }}.</p>
      @for (row of rows; track row.key) {
        <fieldset>
          <legend>{{ row.label }}</legend>
          <div class="stars">
            @for (value of [1, 2, 3, 4, 5]; track value) {
              <label [class.is-on]="value <= ratings()[row.key]">
                <input type="radio" [name]="row.key + '-' + trip().id" [value]="value" [checked]="ratings()[row.key] === value" (change)="rate(row.key, value)" />
                <span aria-hidden="true">★</span><span class="visually-hidden">{{ value }} {{ value === 1 ? 'stella' : 'stelle' }}</span>
              </label>
            }
          </div>
        </fieldset>
      }
      <label class="visually-hidden" [for]="'review-body-' + trip().id">Commento</label>
      <textarea [id]="'review-body-' + trip().id" rows="3" maxlength="800" placeholder="Cosa ricorderai di questo viaggio? (facoltativo)" [ngModel]="body()" (ngModelChange)="body.set($event)" name="body"></textarea>
      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
      <button type="submit" class="send" [disabled]="!ratings().coordinator || !ratings().trip || saving()">{{ saving() ? 'Invio…' : 'Pubblica la recensione' }}</button>
    </form>
  `,
  styles: `
    .review { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5); border-radius: var(--radius-xl); background: var(--color-surface); border: 2px solid var(--odys-coral); }
    h2 { font-size: var(--text-xl); }
    fieldset { margin: 0; padding: 0; border: 0; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
    legend { float: left; font-weight: 800; padding: 0; }
    .stars { display: flex; }
    .stars label { display: grid; place-items: center; width: 44px; height: 44px; cursor: pointer; color: var(--color-border-strong); font-size: 28px; line-height: 1; }
    .stars label.is-on { color: var(--odys-coral); }
    .stars label:focus-within { outline: 3px solid var(--color-focus); outline-offset: -4px; border-radius: 8px; }
    .stars input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    textarea { width: 100%; padding: var(--space-3); border-radius: var(--radius-md); border: var(--border-width) solid var(--color-border-strong); background: var(--color-bg); color: var(--color-text); font: inherit; resize: vertical; }
    .send { min-height: 52px; border: 0; border-radius: var(--radius-pill); background: var(--odys-ink); color: var(--odys-lime); font: inherit; font-weight: 900; cursor: pointer;
      &[disabled] { background: var(--color-surface-muted); color: var(--color-text-muted); cursor: not-allowed; } }
  `,
})
export class ReviewCardComponent {
  private readonly catalog = inject(CatalogApi);
  readonly trip = input.required<PublishedTripSummary>();
  readonly saved = output<string>();

  protected readonly rows = [{ key: 'coordinator' as const, label: 'Il coordinatore' }, { key: 'trip' as const, label: 'Il viaggio' }];
  protected readonly ratings = signal({ coordinator: 0, trip: 0 });
  protected readonly body = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal('');

  protected rate(key: 'coordinator' | 'trip', value: number): void {
    this.ratings.update((current) => ({ ...current, [key]: value }));
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set('');
    try {
      await this.catalog.saveReview(this.trip().id, { coordinatorRating: this.ratings().coordinator, tripRating: this.ratings().trip, body: this.body().trim() });
      this.saved.emit(this.trip().id);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Recensione non salvata.'));
    } finally {
      this.saving.set(false);
    }
  }
}
