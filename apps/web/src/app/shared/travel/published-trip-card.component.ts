import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatPrice, PUBLISHED_STATUS_LABELS, type PublishedTripSummary } from '../../core/api/catalog.api';
import { ButtonComponent } from '../ui';

/**
 * Card di un viaggio pubblicato da un coordinatore: destinazione, titolo,
 * coordinatore (link al profilo, U-04), date, posti, quota e "Salva".
 */
@Component({
  selector: 'odys-published-trip-card',
  imports: [ButtonComponent, RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card">
      <a class="card__media" [routerLink]="['/gruppi', trip().id]" [attr.aria-label]="'Apri ' + trip().title">
        @if (trip().coverImageUrl) {
          <img [src]="trip().coverImageUrl" alt="" loading="lazy" />
        } @else {
          <span class="cover" aria-hidden="true"><span>{{ trip().destination || trip().title }}</span></span>
        }
        @if (trip().effectiveStatus !== 'published') {<span class="status">{{ statusLabel() }}</span>}
      </a>
      <div class="card__body">
        <p class="eyebrow">{{ trip().destination }}</p>
        <h3><a [routerLink]="['/gruppi', trip().id]">{{ trip().title }}</a></h3>
        <a class="creator" [routerLink]="['/coordinatori', trip().coordinator.id]">
          <span class="avatar" aria-hidden="true">{{ trip().coordinator.displayName[0] }}</span>
          <span>Con <strong>{{ trip().coordinator.displayName }}</strong></span>
        </a>
        <dl class="meta">
          <div><dt>Quando</dt><dd>{{ trip().startDate ? (trip().startDate | date: 'd MMM') : 'Date da definire' }}@if (trip().durationDays) { · {{ trip().durationDays }} gg}</dd></div>
          <div><dt>Posti</dt><dd>{{ trip().capacity ?? '—' }}</dd></div>
          <div><dt>Quota</dt><dd class="price">{{ price() }}</dd></div>
        </dl>
        @if (showSave()) {
          <button odysButton [variant]="saved() ? 'accent' : 'secondary'" icon="bookmark" [block]="true" [attr.aria-pressed]="saved()" (click)="toggleSave.emit(trip().id)">
            {{ saved() ? 'Idea salvata' : 'Salva idea' }}
          </button>
        }
      </div>
    </article>
  `,
  styles: `
    .card { display: flex; flex-direction: column; height: 100%; background: var(--color-surface); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-xl); overflow: hidden; }
    .card__media { position: relative; display: block; aspect-ratio: 16 / 9; background: var(--color-surface-muted); }
    img { width: 100%; height: 100%; object-fit: cover; }
    .cover { display: flex; align-items: flex-end; height: 100%; padding: var(--space-4); background: var(--color-brand-panel);
      background-image: radial-gradient(circle at 85% 20%, color-mix(in srgb, var(--odys-lime) 55%, transparent) 0 18%, transparent 19%), radial-gradient(circle at 15% 120%, var(--odys-blue) 0 35%, transparent 36%);
      span { font-family: var(--font-brand); font-weight: 800; font-size: var(--text-2xl); color: var(--color-on-brand); line-height: 1.1; } }
    .status { position: absolute; top: var(--space-3); left: var(--space-3); padding: 3px 10px; border-radius: var(--radius-pill); background: var(--color-surface); font-size: var(--text-xs); font-weight: 700; }
    .card__body { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-5); flex: 1; }
    h3 { font-size: var(--text-xl); a { color: inherit; text-decoration: none; } a:hover { color: var(--color-link); } }
    .creator { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--color-text-muted); font-size: var(--text-sm); text-decoration: none; align-self: flex-start;
      strong { color: var(--color-text); } &:hover strong { color: var(--color-link); } }
    .avatar { display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--radius-sm); background: var(--color-accent); color: var(--color-on-accent); font-weight: 800; font-size: var(--text-sm); }
    .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); margin: var(--space-2) 0 var(--space-3); margin-top: auto; }
    dt { font-size: var(--text-xs); color: var(--color-text-muted); }
    dd { margin: 0; font-weight: 700; font-variant-numeric: tabular-nums; }
    .price { color: var(--color-link); }
  `,
})
export class PublishedTripCardComponent {
  readonly trip = input.required<PublishedTripSummary>();
  readonly saved = input(false);
  readonly showSave = input(true);
  readonly toggleSave = output<string>();
  protected readonly price = computed(() => formatPrice(this.trip().priceCents, this.trip().currency));
  protected readonly statusLabel = computed(() => PUBLISHED_STATUS_LABELS[this.trip().effectiveStatus]);
}
