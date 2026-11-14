import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  addActivity, deleteActivity, displayDayDate, moveActivityToDay, moveActivityWithinDay, moveDay, updateActivity, updateActivityPlaceQuery,
  type Activity, type Itinerary, type Transport,
} from '@odys/domain';
import { ButtonComponent, IconComponent } from '../../shared/ui';

const TRANSPORTS: Array<{ value: Transport; label: string }> = [
  { value: 'a piedi', label: 'A piedi' },
  { value: 'trasporto pubblico', label: 'Mezzi pubblici' },
  { value: 'autobus', label: 'Bus' },
  { value: 'auto', label: 'Auto' },
  { value: 'taxi', label: 'Taxi' },
  { value: 'treno', label: 'Treno' },
  { value: 'traghetto', label: 'Traghetto' },
  { value: 'aereo', label: 'Aereo' },
  { value: 'misto', label: 'Misto' },
];

/**
 * Itinerario modificabile dentro l'offerta del coordinatore (CB-03): giorni
 * riordinabili con titolo; per ogni attività orario, titolo, durata, località,
 * note e mezzo per raggiungerla. Le tratte si ricalcolano al salvataggio.
 */
@Component({
  selector: 'odys-offer-itinerary-editor',
  imports: [FormsModule, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (itinerary(); as plan) {
      <ol class="days">
        @for (day of plan.days; track day.day; let d = $index; let firstDay = $first; let lastDay = $last) {
          <li class="day">
            <details [open]="d === 0">
              <summary>
                <span class="day__num">{{ day.day }}</span>
                <span class="day__head">
                  <strong>{{ day.label || 'Giorno ' + day.day }}</strong>
                  <span class="muted">{{ day.date ? dayDate(day.date) + ' · ' : '' }}{{ day.activities.length }} {{ day.activities.length === 1 ? 'attività' : 'attività' }}</span>
                </span>
                <odys-icon name="chevron-down" class="chev" />
              </summary>
              <div class="day__body">
                <div class="day__tools">
                  <label class="field-label grow">Titolo del giorno
                    <input class="field" [name]="'label-' + d" maxlength="80" [ngModel]="day.label" (ngModelChange)="setDayLabel(d, $event)" />
                  </label>
                  <span class="order" role="group" [attr.aria-label]="'Sposta il giorno ' + day.day">
                    <button type="button" class="icon-btn" [disabled]="firstDay" (click)="shiftDay(d, -1)" [attr.aria-label]="'Sposta il programma del giorno ' + day.day + ' prima'"><odys-icon name="arrow-up" [size]="18" /></button>
                    <button type="button" class="icon-btn" [disabled]="lastDay" (click)="shiftDay(d, 1)" [attr.aria-label]="'Sposta il programma del giorno ' + day.day + ' dopo'"><odys-icon name="arrow-down" [size]="18" /></button>
                  </span>
                </div>

                @for (activity of day.activities; track activity.id ?? $index; let a = $index; let firstAct = $first; let lastAct = $last) {
                  <div class="act">
                    <div class="act__row">
                      <input class="field act__time" type="time" [name]="'time-' + d + '-' + a" [attr.aria-label]="'Orario di ' + activity.title" [ngModel]="activity.time" (ngModelChange)="patch(d, a, { time: $event })" />
                      <input class="field grow" [name]="'title-' + d + '-' + a" maxlength="120" placeholder="Cosa si fa" [attr.aria-label]="'Titolo dell’attività ' + (a + 1) + ' del giorno ' + day.day" [ngModel]="activity.title" (ngModelChange)="patch(d, a, { title: $event })" />
                    </div>
                    <div class="act__grid">
                      <label class="field-label">Località
                        <input class="field" [name]="'place-' + d + '-' + a" maxlength="120" placeholder="Es. Belvedere di Murro" [ngModel]="activity.place?.title ?? ''" (ngModelChange)="setPlace(d, a, $event)" />
                      </label>
                      <label class="field-label">Durata
                        <input class="field" [name]="'dur-' + d + '-' + a" maxlength="30" placeholder="Es. 2 ore" [ngModel]="activity.duration ?? ''" (ngModelChange)="patch(d, a, { duration: $event })" />
                      </label>
                      <label class="field-label">Come ci si arriva
                        <select class="field" [name]="'tr-' + d + '-' + a" [ngModel]="activity.transport ?? plan.transport" (ngModelChange)="patch(d, a, { transport: $event })">
                          @for (item of transports; track item.value) {<option [value]="item.value">{{ item.label }}</option>}
                        </select>
                      </label>
                    </div>
                    <label class="field-label">Note per il gruppo
                      <textarea class="field" rows="2" maxlength="500" [name]="'notes-' + d + '-' + a" placeholder="Es. scarpe comode, biglietto incluso" [ngModel]="activity.notes ?? ''" (ngModelChange)="patch(d, a, { notes: $event })"></textarea>
                    </label>
                    <div class="act__tools">
                      <button type="button" class="icon-btn" [disabled]="firstAct" (click)="shiftActivity(d, a, -1)" [attr.aria-label]="'Sposta prima ' + activity.title"><odys-icon name="arrow-up" [size]="16" /></button>
                      <button type="button" class="icon-btn" [disabled]="lastAct" (click)="shiftActivity(d, a, 1)" [attr.aria-label]="'Sposta dopo ' + activity.title"><odys-icon name="arrow-down" [size]="16" /></button>
                      @if (plan.days.length > 1) {
                        <select class="field field--sm" [name]="'move-' + d + '-' + a" [attr.aria-label]="'Sposta ' + activity.title + ' in un altro giorno'" [ngModel]="''" (ngModelChange)="toDay(d, a, $event)">
                          <option value="" disabled>Sposta al giorno…</option>
                          @for (other of plan.days; track other.day; let o = $index) {@if (o !== d) {<option [value]="o">Giorno {{ other.day }}</option>}}
                        </select>
                      }
                      <button type="button" class="icon-btn icon-btn--danger" (click)="remove(d, a)" [attr.aria-label]="'Togli ' + activity.title"><odys-icon name="trash" [size]="16" /></button>
                    </div>
                  </div>
                } @empty {
                  <p class="muted small">Giornata libera. Aggiungi un’attività o lasciala così.</p>
                }
                <button odysButton type="button" variant="secondary" size="sm" icon="plus" (click)="add(d)">Aggiungi un’attività</button>
              </div>
            </details>
          </li>
        }
      </ol>
    }
  `,
  styles: `
    :host { display: block; }
    .days { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .day details { border-radius: var(--radius-lg); border: var(--border-width) solid var(--color-border); background: var(--color-surface); }
    .day details[open] { border-color: var(--color-border-strong); }
    summary { display: flex; align-items: center; gap: var(--space-3); min-height: 56px; padding: var(--space-3) var(--space-4); cursor: pointer; list-style: none;
      &::-webkit-details-marker { display: none; } }
    details[open] .chev { rotate: 180deg; }
    .chev { flex-shrink: 0; color: var(--color-text-muted); transition: rotate var(--duration-fast) var(--ease-out); }
    .day__num { display: grid; place-items: center; flex-shrink: 0; width: 36px; height: 36px; border-radius: 50%; background: var(--odys-ink); color: #fff; font-family: var(--font-brand); font-weight: 900; }
    .day__head { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
    .day__body { display: flex; flex-direction: column; gap: var(--space-3); padding: 0 var(--space-3) var(--space-3); > button { align-self: flex-start; } }
    .day__tools { display: flex; align-items: flex-end; gap: var(--space-2); }
    .order { display: flex; gap: 4px; }
    .act { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface-muted); }
    .act__row { display: flex; flex-wrap: wrap; gap: var(--space-2); > .grow { flex: 1 1 100%; order: -1; font-weight: 700; } }
    .field.act__time { width: 112px; flex: 0 0 112px; font-variant-numeric: tabular-nums; }
    .act__grid { display: grid; gap: var(--space-2); }
    .act__tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
    .grow { flex: 1; min-width: 0; }
    .field-label { display: flex; flex-direction: column; gap: 4px; font-size: var(--text-sm); font-weight: 600; }
    .field { width: 100%; min-height: 44px; padding: 0 var(--space-3); border-radius: var(--radius-md); border: var(--border-width) solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); font: inherit; font-weight: 400; min-width: 0; }
    textarea.field { padding-block: var(--space-2); resize: vertical; }
    .field--sm { width: auto; flex: 1; min-width: 150px; }
    .icon-btn { display: grid; place-items: center; width: 44px; height: 44px; flex-shrink: 0; border-radius: var(--radius-md); border: var(--border-width) solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); cursor: pointer;
      &:disabled { opacity: 0.35; cursor: default; }
      &:not(:disabled):hover { border-color: var(--color-text); } }
    .icon-btn--danger:hover { color: var(--color-danger-text); border-color: var(--color-danger); background: var(--color-danger-soft); }
    .muted { color: var(--color-text-muted); font-size: var(--text-sm); }
    .small { font-size: var(--text-sm); }
    @media (min-width: 640px) {
      .act__grid { grid-template-columns: 2fr 1fr 1fr; }
      .act__row > .grow { flex: 1 1 0; order: 0; }
      .day__body { padding: 0 var(--space-4) var(--space-4); }
    }
  `,
})
export class OfferItineraryEditorComponent {
  readonly itinerary = model<Itinerary | null>(null);
  protected readonly transports = TRANSPORTS;

  private apply(change: (plan: Itinerary) => Itinerary): void {
    const plan = this.itinerary();
    if (plan) this.itinerary.set(change(plan));
  }

  protected dayDate(value: string): string {
    return displayDayDate(value);
  }

  protected setDayLabel(dayIndex: number, label: string): void {
    this.apply((plan) => ({ ...plan, days: plan.days.map((day, index) => (index === dayIndex ? { ...day, label } : day)) }));
  }

  protected shiftDay(dayIndex: number, delta: number): void {
    this.apply((plan) => moveDay(plan, dayIndex, dayIndex + delta));
  }

  protected patch(dayIndex: number, activityIndex: number, change: Partial<Activity>): void {
    this.apply((plan) => updateActivity(plan, dayIndex, activityIndex, change));
  }

  protected setPlace(dayIndex: number, activityIndex: number, value: string): void {
    this.apply((plan) => updateActivityPlaceQuery(plan, dayIndex, activityIndex, value));
  }

  protected shiftActivity(dayIndex: number, activityIndex: number, delta: number): void {
    this.apply((plan) => moveActivityWithinDay(plan, dayIndex, activityIndex, activityIndex + delta));
  }

  protected toDay(dayIndex: number, activityIndex: number, target: string): void {
    const to = Number(target);
    if (Number.isInteger(to)) this.apply((plan) => moveActivityToDay(plan, dayIndex, activityIndex, to));
  }

  protected add(dayIndex: number): void {
    this.apply((plan) => addActivity(plan, dayIndex));
  }

  protected remove(dayIndex: number, activityIndex: number): void {
    this.apply((plan) => deleteActivity(plan, dayIndex, activityIndex));
  }
}
