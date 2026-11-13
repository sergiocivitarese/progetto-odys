import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatAmount, formatDateRange, initialsOf, PUBLISHED_STATUS_LABELS, urgencyLabel, type PublishedTripSummary } from '../../core/api/catalog.api';
import { IconComponent } from '../ui';

export type TripCardTone = 'blue' | 'coral' | 'lime' | 'ink';
const TONES: TripCardTone[] = ['blue', 'coral', 'lime', 'ink'];

/** Colore stabile per viaggio: lo stesso viaggio ha lo stesso colore in ogni schermata. */
export function toneOf(id: string): TripCardTone {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

/**
 * Card di un viaggio pubblicato (TB-05): meta in maiuscolo, durata e date,
 * prezzo «da», coordinatore con valutazione, posti liberi con etichetta di
 * urgenza sotto i 5 posti, affinità «X% per te» e cuore per salvare.
 * `size="lg"` è la card in evidenza, `sm` quella compatta delle griglie.
 */
@Component({
  selector: 'odys-published-trip-card',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': '"tone-" + (tone() ?? autoTone()) + " size-" + size()' },
  template: `
    <article class="card">
      <div class="card__top">
        @if (badge(); as label) {
          <span class="badge" [class.badge--urgent]="urgent()"><span class="badge__dot" aria-hidden="true"></span>{{ label }}</span>
        }
        @if (trip().affinity && trip().affinity!.percent > 0) {
          <span class="badge badge--affinity">{{ trip().affinity!.percent }}% per te</span>
        }
        @if (showSave()) {
          <button type="button" class="save" [class.is-saved]="saved()" [attr.aria-pressed]="saved()" [attr.aria-label]="(saved() ? 'Togli dai salvati: ' : 'Salva: ') + trip().title" (click)="toggleSave.emit(trip().id)">
            <odys-icon name="heart" [size]="20" [strokeWidth]="2.4" />
          </button>
        }
      </div>

      <p class="meta-line">{{ metaLine() }}</p>
      <h3 class="destination" [style.--chars]="chars()">
        <a [routerLink]="['/gruppi', trip().id]">{{ headline() }}</a>
      </h3>
      <p class="tagline">{{ size() === 'lg' ? (trip().summary || trip().title) : trip().title }}</p>

      @if (size() === 'lg') {
        <div class="strip">
          <a class="who" [routerLink]="['/coordinatori', trip().coordinator.id]">
            <span class="avatar" aria-hidden="true">{{ initials() }}</span>
            <span class="who__text"><strong>con {{ trip().coordinator.displayName }}</strong><span>{{ dates() }}@if (trip().coordinator.rating) { · ★ {{ rating() }}}</span></span>
          </a>
          <span class="price"><span class="price__from">da</span>{{ price() }}</span>
        </div>
      } @else {
        <p class="price-line">{{ price() }}</p>
      }
    </article>
  `,
  styles: `
    :host { display: block; container-type: inline-size; --card-bg: var(--odys-blue); --card-fg: #fff; --card-soft: #dfe5ff; --card-ring: rgb(255 255 255 / 0.16); --card-kicker: var(--odys-lime); }
    :host(.tone-coral) { --card-bg: var(--odys-coral); --card-fg: var(--odys-ink); --card-soft: #3a130c; --card-ring: rgb(255 255 255 / 0.2); --card-kicker: var(--odys-ink); }
    :host(.tone-lime) { --card-bg: var(--odys-lime); --card-fg: var(--odys-ink); --card-soft: #2b3206; --card-ring: rgb(18 18 18 / 0.08); --card-kicker: var(--odys-ink); }
    :host(.tone-ink) { --card-bg: #1b1b1a; --card-fg: #fff; --card-soft: #d2d0c9; --card-ring: rgb(255 255 255 / 0.07); --card-kicker: var(--odys-lime); }

    .card { position: relative; isolation: isolate; overflow: hidden; display: flex; flex-direction: column; height: 100%; min-height: 0;
      padding: var(--space-5); border-radius: var(--radius-xl); background: var(--card-bg); color: var(--card-fg); }
    // L'anello dell'orbita: un arco fuori campo, sempre dietro al contenuto.
    .card::before { content: ''; position: absolute; z-index: -1; right: -22%; top: -38%; width: 78%; aspect-ratio: 1; border-radius: 50%; border: clamp(18px, 9cqi, 40px) solid var(--card-ring); }

    .card__top { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-height: 44px; padding-right: 52px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 12px; border-radius: var(--radius-pill); background: var(--odys-ink); color: #fff; font-size: var(--text-xs); font-weight: 800; white-space: nowrap; }
    .badge__dot { display: none; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .badge--urgent { background: var(--odys-coral); color: var(--odys-ink); .badge__dot { display: block; } }
    :host(.tone-coral) .badge--urgent { background: var(--odys-ink); color: var(--odys-coral); }
    .badge--affinity { background: var(--odys-lime); color: var(--odys-ink); }
    :host(.tone-lime) .badge--affinity { background: var(--odys-ink); color: var(--odys-lime); }
    .save { position: absolute; top: var(--space-5); right: var(--space-5); z-index: 2; display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: 50%; cursor: pointer;
      background: color-mix(in srgb, var(--card-fg) 16%, transparent); color: var(--card-fg); transition: background-color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out); }
    .save:hover { background: color-mix(in srgb, var(--card-fg) 26%, transparent); }
    .save:active { transform: scale(0.92); }
    .save.is-saved { background: var(--card-fg); color: var(--card-bg); }
    .save.is-saved ::ng-deep svg { fill: currentColor; }

    .meta-line { margin-top: var(--space-6); color: var(--card-kicker); font-weight: 700; }
    .destination { margin-top: var(--space-2); font-size: clamp(1.375rem, calc((100cqi - 48px) / (var(--chars) * 0.8)), 4.75rem); overflow-wrap: normal; hyphens: none;
      a { color: inherit; text-decoration: none; }
      // Tutta la card apre il viaggio; cuore e coordinatore restano cliccabili sopra.
      a::after { content: ''; position: absolute; inset: 0; z-index: 1; border-radius: inherit; }
      a:focus-visible { outline: none; }
      a:focus-visible::after { outline: 3px solid var(--card-fg); outline-offset: -5px; } }
    .tagline { margin-top: var(--space-3); color: var(--card-soft); font-weight: 600; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

    .strip { position: relative; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-top: auto; padding: var(--space-2); border-radius: var(--radius-lg); background: #fff; color: var(--odys-ink); }
    .tagline + .strip { margin-top: var(--space-6); }
    .who { display: flex; align-items: center; gap: var(--space-3); min-width: 0; min-height: 44px; color: inherit; text-decoration: none; }
    .who:hover strong { text-decoration: underline; }
    .avatar { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; border-radius: 50%; background: var(--odys-ink); color: var(--odys-lime); font-weight: 900; font-size: var(--text-sm); }
    .who__text { display: flex; flex-direction: column; min-width: 0; line-height: 1.25;
      strong { font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      span { font-size: var(--text-sm); color: #55534e; white-space: nowrap; } }
    .price { display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0; padding: 6px 14px; border-radius: var(--radius-md); background: var(--odys-lime); color: var(--odys-ink); font-weight: 900; font-size: var(--text-xl); line-height: 1; font-variant-numeric: tabular-nums; }
    .price__from { font-size: 0.6875rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }

    :host(.size-sm) .card { padding: var(--space-4); border-radius: var(--radius-lg); min-height: 210px; }
    :host(.size-sm) .card__top { min-height: 44px; padding-right: 48px; }
    :host(.size-sm) .badge { min-height: 26px; padding: 0 10px; }
    :host(.size-sm) .save { top: var(--space-3); right: var(--space-3); }
    :host(.size-sm) .meta-line { margin-top: auto; padding-top: var(--space-6); }
    :host(.size-sm) .destination { font-size: clamp(1.125rem, calc((100cqi - 36px) / (var(--chars) * 0.8)), 2.25rem); line-height: 0.98; }
    :host(.size-sm) .tagline { margin-top: var(--space-2); font-size: var(--text-sm); -webkit-line-clamp: 1; }
    .price-line { margin-top: var(--space-1); font-weight: 900; font-size: var(--text-lg); font-variant-numeric: tabular-nums; }
  `,
})
export class PublishedTripCardComponent {
  readonly trip = input.required<PublishedTripSummary>();
  readonly saved = input(false);
  readonly showSave = input(true);
  readonly size = input<'lg' | 'sm'>('lg');
  /** Colore della card; se manca è scelto in modo stabile dal viaggio. */
  readonly tone = input<TripCardTone>();
  /** Sostituisce l'etichetta in alto (es. «Tra 9 giorni» in «Partono a breve»). */
  readonly label = input<string>();
  readonly toggleSave = output<string>();

  protected readonly autoTone = computed(() => toneOf(this.trip().id));
  protected readonly headline = computed(() => this.trip().destination || this.trip().title);
  /** Parola più lunga della meta: decide la dimensione del titolo perché non esca dalla card. */
  protected readonly chars = computed(() => Math.max(5, ...this.headline().split(/\s+/).map((word) => word.length)));
  protected readonly urgent = computed(() => !this.label() && !!urgencyLabel(this.trip()) && this.trip().seatsLeft !== 0);
  protected readonly badge = computed(() => {
    if (this.label()) return this.label()!;
    const trip = this.trip();
    if (trip.effectiveStatus !== 'published') return PUBLISHED_STATUS_LABELS[trip.effectiveStatus];
    // Nelle card piccole solo l'urgenza: i posti liberi stanno nel dettaglio.
    if (this.size() === 'sm') return urgencyLabel(trip);
    return urgencyLabel(trip) ?? (trip.seatsLeft !== undefined && trip.capacity ? `${trip.seatsLeft} di ${trip.capacity} posti liberi` : null);
  });
  protected readonly metaLine = computed(() => {
    const trip = this.trip();
    const days = trip.durationDays ? `${trip.durationDays} ${this.size() === 'lg' ? (trip.durationDays === 1 ? 'giorno' : 'giorni') : 'gg'}` : '';
    const where = this.size() === 'lg' ? trip.country || trip.region : formatDateRange(trip.startDate, trip.endDate);
    return [where, days].filter(Boolean).join(' · ');
  });
  protected readonly dates = computed(() => formatDateRange(this.trip().startDate, this.trip().endDate));
  protected readonly price = computed(() => formatAmount(this.trip().priceCents, this.trip().currency));
  protected readonly initials = computed(() => initialsOf(this.trip().coordinator.displayName));
  protected readonly rating = computed(() => this.trip().coordinator.rating?.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
}
