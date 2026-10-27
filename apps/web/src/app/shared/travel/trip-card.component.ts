import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { SavedTrip } from '@odys/domain';
import { ButtonComponent, IconComponent } from '../ui';

/** Card di un viaggio salvato con azioni Riapri / Rinomina / Elimina. */
@Component({
  selector: 'odys-trip-card',
  imports: [ButtonComponent, IconComponent, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card">
      <button type="button" class="card__main" (click)="open.emit(trip())" [attr.aria-label]="'Apri ' + trip().title">
        <span class="card__badge">{{ trip().itinerary.duration }}<small>{{ trip().itinerary.duration === 1 ? 'giorno' : 'giorni' }}</small></span>
        <span class="card__body">
          <span class="eyebrow">{{ trip().updatedAt ? ('Aggiornato ' + (trip().updatedAt | date: 'd MMM')) : 'Viaggio salvato' }}</span>
          <span class="card__title">{{ trip().title }}</span>
          <span class="card__meta"><odys-icon name="map-pin" [size]="14" /> {{ trip().itinerary.destination }}</span>
          <span class="card__meta">{{ trip().itinerary.departure || 'Date da definire' }} · {{ trip().itinerary.pace }}</span>
        </span>
        <odys-icon name="arrow-right" class="card__arrow" />
      </button>
      @if (manageable()) {
        <footer class="card__actions">
          <button odysButton variant="ghost" size="sm" icon="edit" (click)="rename.emit(trip())" [attr.aria-label]="'Rinomina ' + trip().title">Rinomina</button>
          <button odysButton variant="ghost" size="sm" icon="trash" class="danger" (click)="remove.emit(trip())" [attr.aria-label]="'Elimina ' + trip().title">Elimina</button>
        </footer>
      }
    </article>
  `,
  styles: `
    .card { display: flex; flex-direction: column; height: 100%; background: var(--color-surface); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; transition: border-color var(--duration-base), box-shadow var(--duration-base); }
    .card:hover { border-color: var(--color-border-strong); box-shadow: var(--shadow-md); }
    .card__main { display: flex; align-items: center; gap: var(--space-4); flex: 1; padding: var(--space-4); border: 0; background: transparent; text-align: left; cursor: pointer; }
    .card__badge { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 60px; height: 60px; flex-shrink: 0; border-radius: var(--radius-md); background: var(--color-brand-panel); color: var(--odys-lime); font-family: var(--font-brand); font-weight: 800; font-size: var(--text-xl); line-height: 1; }
    .card__badge small { font-family: var(--font-ui); font-size: 11px; font-weight: 600; color: var(--color-on-brand-muted); margin-top: 3px; }
    .card__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .card__title { font-family: var(--font-brand); font-weight: 800; font-size: var(--text-lg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card__meta { display: inline-flex; align-items: center; gap: 4px; color: var(--color-text-muted); font-size: var(--text-sm); }
    .card__arrow { color: var(--color-text-muted); }
    .card__actions { display: flex; gap: var(--space-1); padding: var(--space-1) var(--space-2) var(--space-2); border-top: var(--border-width) solid var(--color-border); }
    .danger { color: var(--color-danger-text); }
  `,
})
export class TripCardComponent {
  readonly trip = input.required<SavedTrip>();
  readonly manageable = input(true);
  readonly open = output<SavedTrip>();
  readonly rename = output<SavedTrip>();
  readonly remove = output<SavedTrip>();
}
