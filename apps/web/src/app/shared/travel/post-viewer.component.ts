import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { openStreetMapUrl } from '@odys/domain';
import { formatPrice } from '../../core/api/catalog.api';
import type { Post } from '../../core/api/creator.api';
import { ButtonComponent, IconComponent } from '../ui';

/**
 * Il post come contenuto editoriale (C-28, U-19): carosello su tela 4:5 con ritaglio
 * centrato (C-25), didascalia, luogo con collegamento OpenStreetMap, viaggio collegato
 * (C-27, U-21) e, per il pubblico, like e salvataggi (U-20).
 */
@Component({
  selector: 'odys-post-viewer',
  imports: [DatePipe, RouterLink, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="viewer">
      <div class="canvas" aria-roledescription="carosello" [attr.aria-label]="'Media ' + (index() + 1) + ' di ' + post().media.length">
        @if (current(); as media) {
          @if (media.kind === 'video') {
            <video [src]="media.urls?.display" [poster]="media.urls?.thumbnail" controls playsinline preload="metadata"></video>
          } @else if (media.urls?.display) {
            <img [src]="media.urls?.display" [alt]="post().caption.slice(0, 120) || 'Foto del post'" />
          } @else {
            <span class="pending">{{ media.status === 'failed' ? 'Caricamento non riuscito' : 'Caricamento in corso…' }}</span>
          }
        } @else {
          <span class="pending">Nessun media</span>
        }
        @if (post().media.length > 1) {
          <button type="button" class="nav nav--prev" (click)="go(-1)" [disabled]="index() === 0" aria-label="Media precedente"><odys-icon name="chevron-left" /></button>
          <button type="button" class="nav nav--next" (click)="go(1)" [disabled]="index() === post().media.length - 1" aria-label="Media successivo"><odys-icon name="chevron-right" /></button>
          <span class="dots" aria-hidden="true">@for (m of post().media; track m.id; let i = $index) {<span [class.on]="i === index()"></span>}</span>
        }
      </div>

      <div class="body">
        <a class="author" [routerLink]="['/coordinatori', post().author.id]">
          <span class="avatar" aria-hidden="true">{{ post().author.displayName[0] }}</span>
          <span><strong>{{ post().author.displayName }}</strong>
            @if (post().publishedAt) {<small>{{ post().publishedAt | date: 'd MMMM y' }}</small>}</span>
        </a>
        @if (post().location; as place) {
          <p class="place"><odys-icon name="map-pin" [size]="14" /> {{ place.label }}
            @if (placeUrl()) { · <a [href]="placeUrl()" target="_blank" rel="noopener noreferrer">mappa<span class="visually-hidden"> su OpenStreetMap (nuova scheda)</span></a>}</p>
        }
        @if (post().caption) {<p class="caption">{{ post().caption }}</p>}

        @if (post().trip; as trip) {
          <a class="trip" [routerLink]="['/gruppi', trip.id]">
            <span class="trip__icon" aria-hidden="true"><odys-icon name="route" /></span>
            <span><small>Itinerario collegato · gratuito</small><strong>{{ trip.title }}</strong><small>{{ trip.destination }} · {{ price(trip.priceCents, trip.currency) }}</small></span>
            <odys-icon name="arrow-right" />
          </a>
        }

        @if (interactive()) {
          <div class="actions">
            <button odysButton [variant]="post().liked ? 'accent' : 'secondary'" size="sm" icon="star" [attr.aria-pressed]="!!post().liked" (click)="like.emit()">
              {{ post().likes }} {{ post().likes === 1 ? 'mi piace' : 'mi piace' }}
            </button>
            <button odysButton [variant]="post().saved ? 'accent' : 'ghost'" size="sm" icon="bookmark" [attr.aria-pressed]="!!post().saved" (click)="save.emit()">{{ post().saved ? 'Salvato' : 'Salva' }}</button>
            <button odysButton variant="ghost" size="sm" icon="alert-triangle" (click)="report.emit()">Segnala</button>
          </div>
        }
      </div>
    </article>
  `,
  styles: `
    .viewer { display: grid; gap: var(--space-5); }
    .canvas { position: relative; aspect-ratio: 4 / 5; width: 100%; max-width: 560px; overflow: hidden; border-radius: var(--radius-lg); background: #111; }
    .canvas img, .canvas video { width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; }
    .pending { display: grid; place-items: center; height: 100%; color: #ddd; font-size: var(--text-sm); }
    .nav { position: absolute; top: 50%; transform: translateY(-50%); display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: var(--radius-pill); background: rgb(255 255 255 / 0.9); color: #111; cursor: pointer; }
    .nav:disabled { opacity: 0; pointer-events: none; }
    .nav--prev { left: 10px; } .nav--next { right: 10px; }
    .dots { position: absolute; bottom: 12px; left: 0; right: 0; display: flex; justify-content: center; gap: 6px;
      span { width: 7px; height: 7px; border-radius: 50%; background: rgb(255 255 255 / 0.5); } .on { background: #fff; } }
    .body { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
    .author { display: flex; align-items: center; gap: var(--space-3); color: var(--color-text); text-decoration: none;
      > span:last-child { display: flex; flex-direction: column; } small { color: var(--color-text-muted); } }
    .avatar { display: grid; place-items: center; width: 40px; height: 40px; border-radius: var(--radius-pill); background: var(--color-accent); color: var(--color-on-accent); font-weight: 800; }
    .place { display: flex; align-items: center; gap: 4px; font-size: var(--text-sm); color: var(--color-text-muted); a { color: var(--color-link); } }
    .caption { white-space: pre-line; line-height: var(--leading-body); }
    .trip { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); background: var(--color-accent-soft); color: var(--color-text); text-decoration: none;
      > span:nth-child(2) { display: flex; flex-direction: column; flex: 1; min-width: 0; } small { color: var(--color-text-muted); font-size: var(--text-xs); } }
    .trip__icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: var(--radius-sm); background: var(--color-accent); color: var(--color-on-accent); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    @media (min-width: 900px) { .viewer { grid-template-columns: minmax(0, 560px) minmax(0, 1fr); align-items: start; } }
  `,
})
export class PostViewerComponent {
  readonly post = input.required<Post>();
  /** Like, salvataggio e segnalazione (non nell'anteprima dell'autore). */
  readonly interactive = input(true);
  readonly like = output<void>();
  readonly save = output<void>();
  readonly report = output<void>();

  protected readonly index = signal(0);
  protected readonly current = computed(() => this.post().media[this.index()]);
  protected readonly placeUrl = computed(() => openStreetMapUrl(this.post().location));

  constructor() {
    // Un altro post (o media rimossi): si riparte dal primo.
    effect(() => { if (this.index() >= this.post().media.length) this.index.set(0); });
  }

  protected go(step: number): void {
    this.index.set(Math.max(0, Math.min(this.post().media.length - 1, this.index() + step)));
  }

  protected price(cents?: number, currency?: string): string {
    return formatPrice(cents, currency);
  }
}
