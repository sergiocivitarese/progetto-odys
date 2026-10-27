import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { POST_STATUS_LABELS, type Post } from '../../core/api/creator.api';
import { IconComponent } from '../ui';

/** Tempo mancante alla pubblicazione programmata, in parole (C-22). */
export function countdown(iso: string | undefined, now: number): string {
  if (!iso) return '';
  const minutes = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
  if (minutes < 60) return `tra ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `tra ${hours} h`;
  return `tra ${Math.round(hours / 24)} giorni`;
}

/**
 * Tessera quadrata di un post per le griglie (C-24): copertina ritagliata al centro,
 * segni per video e carosello, stato e conto alla rovescia nella bacheca privata.
 */
@Component({
  selector: 'odys-post-tile',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="tile" [routerLink]="link()" [attr.aria-label]="label()">
      @if (cover(); as url) {
        <img [src]="url" alt="" loading="lazy" />
      } @else {
        <span class="placeholder" aria-hidden="true"><odys-icon name="upload" [size]="22" /></span>
      }
      <span class="badges" aria-hidden="true">
        @if (post().media.length > 1) {<span class="badge"><odys-icon name="copy" [size]="14" /></span>}
        @else if (post().media[0]?.kind === 'video') {<span class="badge"><odys-icon name="zap" [size]="14" /></span>}
      </span>
      @if (showStatus()) {
        <span class="status status--{{ post().effectiveStatus }}">
          {{ statusLabel() }}@if (post().effectiveStatus === 'scheduled') { · {{ eta() }} }
        </span>
      }
    </a>
  `,
  styles: `
    :host { display: block; }
    .tile { position: relative; display: block; aspect-ratio: 1; overflow: hidden; border-radius: var(--radius-md); background: var(--color-surface-muted); }
    .tile:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px; }
    img { width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; transition: transform var(--duration-base); }
    .tile:hover img { transform: scale(1.03); }
    .placeholder { display: grid; place-items: center; width: 100%; height: 100%; color: var(--color-text-muted); }
    .badges { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; }
    .badge { display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--radius-pill); background: rgb(17 17 17 / 0.6); color: #fff; }
    .status { position: absolute; left: 8px; bottom: 8px; padding: 3px 8px; border-radius: var(--radius-pill); font-size: var(--text-xs); font-weight: 700; background: rgb(17 17 17 / 0.72); color: #fff; }
    .status--published { background: var(--color-accent); color: var(--color-on-accent); }
    .status--scheduled { background: var(--color-primary); color: var(--color-on-primary); }
  `,
})
export class PostTileComponent {
  readonly post = input.required<Post>();
  /** Bacheca privata: stato e link all'editor. */
  readonly showStatus = input(false);
  readonly now = input(Date.now());

  protected readonly link = computed(() => this.showStatus() ? ['/studio', this.post().id] : ['/esplora', this.post().id]);
  protected readonly cover = computed(() => this.post().media[0]?.urls?.thumbnail ?? this.post().media[0]?.urls?.display);
  protected readonly statusLabel = computed(() => POST_STATUS_LABELS[this.post().effectiveStatus]);
  protected readonly eta = computed(() => countdown(this.post().scheduledFor, this.now()));
  protected readonly label = computed(() => {
    const caption = this.post().caption.trim().slice(0, 80) || 'Post senza didascalia';
    return this.showStatus() ? `${caption} · ${this.statusLabel()}` : `${caption} di ${this.post().author.displayName}`;
  });
}
