import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, HostListener, inject, input, output, signal, viewChild } from '@angular/core';
import type { AgendaStop } from '@odys/domain';
import { IconComponent, RingPinComponent } from '../ui';
import { fitMercator, OSM_ATTRIBUTION_URL } from './web-mercator';

/** Riquadro normale e a schermo intero: il secondo è più grande, quindi la cartina è più dettagliata. */
const SIZES = { inline: { width: 360, height: 270 }, full: { width: 720, height: 540 } } as const;

/**
 * Mappa del giorno (TP-05, TP-07): cartina OpenStreetMap, puntatori ad anello
 * numerati e percorso; schermo intero con selettore del giorno.
 */
@Component({
  selector: 'odys-day-map',
  imports: [NgTemplateOutlet, IconComponent, RingPinComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #canvas let-size="size">
      <div class="canvas" [style.aspect-ratio]="size.width + ' / ' + size.height">
        <svg [attr.viewBox]="'0 0 ' + size.width + ' ' + size.height" aria-hidden="true">
          @if (!tilesFailed()) {
            @for (tile of view().tiles; track tile.key) {
              <image [attr.href]="tile.href" [attr.x]="tile.x" [attr.y]="tile.y" [attr.width]="view().tileSize" [attr.height]="view().tileSize" preserveAspectRatio="none" (error)="tilesFailed.set(true)" />
            }
          }
          @if (line()) {<polyline [attr.points]="line()" class="route" />}
        </svg>
        @for (pin of pins(); track pin.stop) {
          <button type="button" class="pin" [style.left.%]="pin.left" [style.top.%]="pin.top"
            [attr.aria-label]="'Tappa ' + pin.stop + ': ' + pin.title + (pin.time ? ', alle ' + pin.time : '')" [attr.aria-pressed]="pin.stop === activeStop()"
            (click)="stopSelect.emit(pin.stop)">
            <odys-ring-pin [size]="fullscreen() ? 38 : 32" [active]="pin.stop === activeStop()">{{ pin.stop }}</odys-ring-pin>
          </button>
        }
        @if (anchorPin(); as a) {
          <span class="pin anchor" [style.left.%]="a.left" [style.top.%]="a.top"><odys-ring-pin [size]="30" [active]="true"></odys-ring-pin><span class="anchor__label">{{ a.label }}</span></span>
        }
      </div>
    </ng-template>

    @if (stops().length || anchor()) {
      <figure class="map">
        <ng-container [ngTemplateOutlet]="canvas" [ngTemplateOutletContext]="{ size: sizes.inline }" />
        <figcaption>
          <span>{{ stops().length ? stops().length + (stops().length === 1 ? ' tappa' : ' tappe') : 'Le tappe compaiono quando i luoghi hanno una posizione' }}</span>
          <button type="button" class="expand" (click)="open()"><odys-icon name="arrow-up-right" [size]="16" /> Schermo intero</button>
        </figcaption>
        <p class="attribution">Mappa <a [href]="osmUrl" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></p>
      </figure>
    } @else {
      <p class="empty"><odys-icon name="map-pin" [size]="18" /> Nessuna tappa con posizione in questo giorno: la mappa compare quando i luoghi hanno coordinate confermate.</p>
    }

    @if (fullscreen()) {
      <div class="overlay" role="dialog" aria-modal="true" [attr.aria-label]="'Mappa del giorno ' + selectedDay()">
        <header class="overlay__head">
          @if (days().length > 1) {
            <div class="days" role="group" aria-label="Scegli il giorno">
              @for (day of days(); track day.day) {
                <button type="button" class="day" [class.is-active]="day.day === selectedDay()" [attr.aria-pressed]="day.day === selectedDay()" (click)="dayChange.emit(day.day)">G{{ day.day }}</button>
              }
            </div>
          }
          <button #closeButton type="button" class="close" (click)="close()" aria-label="Chiudi la mappa a schermo intero"><odys-icon name="x" /></button>
        </header>
        <div class="overlay__map">
          @if (stops().length || anchor()) {
            <ng-container [ngTemplateOutlet]="canvas" [ngTemplateOutletContext]="{ size: sizes.full }" />
          } @else {
            <p class="empty empty--dark">Nessuna tappa con posizione in questo giorno.</p>
          }
        </div>
        <p class="attribution attribution--dark">Mappa <a [href]="osmUrl" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></p>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .map { margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
    .canvas { position: relative; width: 100%; border-radius: var(--radius-lg); overflow: hidden; background: var(--color-primary-soft); }
    svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .route { fill: none; stroke: var(--odys-blue); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 8 6; }
    .pin { position: absolute; transform: translate(-50%, -50%); padding: 0; border: 0; background: transparent; cursor: pointer; border-radius: 50%; }
    .pin:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px; }
    .anchor { cursor: default; display: grid; justify-items: center; }
    .anchor__label { position: absolute; top: calc(100% + 4px); padding: 3px 10px; border-radius: var(--radius-pill); background: var(--color-surface); color: var(--color-text); font-size: var(--text-xs); font-weight: 800; white-space: nowrap; box-shadow: var(--shadow-sm); }
    figcaption { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); font-size: var(--text-sm); font-weight: 700; }
    .expand { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 var(--space-3); border: 0; border-radius: var(--radius-pill); background: var(--color-surface-muted); color: var(--color-text); font: inherit; font-weight: 700; cursor: pointer; }
    .attribution { font-size: 11px; color: var(--color-text-muted); a { color: inherit; } }
    .empty { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-4); border-radius: var(--radius-lg); background: var(--color-surface-muted); color: var(--color-text-muted); font-size: var(--text-sm); }
    .overlay { position: fixed; inset: 0; z-index: 100; display: flex; flex-direction: column; gap: var(--space-3); padding: calc(env(safe-area-inset-top) + var(--space-3)) var(--space-4) calc(env(safe-area-inset-bottom) + var(--space-3)); background: var(--odys-ink); color: #fff; }
    .overlay__head { display: flex; align-items: center; gap: var(--space-3); }
    .days { display: flex; gap: var(--space-2); overflow-x: auto; flex: 1; padding-bottom: 2px; }
    .day { flex-shrink: 0; min-width: 48px; min-height: 44px; border-radius: var(--radius-pill); border: 1px solid rgb(255 255 255 / 0.3); background: transparent; color: #fff; font: inherit; font-weight: 800; cursor: pointer; }
    .day.is-active { background: var(--odys-lime); color: var(--odys-ink); border-color: var(--odys-lime); }
    .close { display: grid; place-items: center; width: 44px; height: 44px; margin-left: auto; flex-shrink: 0; border: 0; border-radius: 50%; background: rgb(255 255 255 / 0.12); color: #fff; cursor: pointer; }
    .overlay__map { flex: 1; min-height: 0; display: grid; place-items: center; }
    .overlay__map .canvas { width: min(100%, calc((100dvh - 150px) * 4 / 3)); }
    .empty--dark { background: rgb(255 255 255 / 0.08); color: rgb(255 255 255 / 0.75); }
    .attribution--dark { color: rgb(255 255 255 / 0.7); text-align: center; }
  `,
})
export class DayMapComponent {
  readonly stops = input.required<AgendaStop[]>();
  readonly path = input<Array<[number, number]>>([]);
  /** Punto di riferimento quando nessuna tappa del giorno ha una posizione. */
  readonly anchor = input<{ label: string; latitude: number; longitude: number }>();
  readonly activeStop = input<number>();
  /** Giorni per il selettore a schermo intero. */
  readonly days = input<Array<{ day: number; label: string }>>([]);
  readonly selectedDay = input<number>(1);
  readonly dayChange = output<number>();
  readonly stopSelect = output<number>();

  protected readonly sizes = SIZES;
  protected readonly osmUrl = OSM_ATTRIBUTION_URL;
  protected readonly fullscreen = signal(false);
  protected readonly tilesFailed = signal(false);
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private opener: HTMLElement | null = null;

  private readonly size = computed(() => this.fullscreen() ? SIZES.full : SIZES.inline);
  protected readonly view = computed(() => {
    const { width, height } = this.size();
    const anchor = this.anchor();
    const points = this.stops().length
      ? [...this.stops().map((stop) => [stop.longitude, stop.latitude] as [number, number]), ...this.path()]
      : anchor ? [[anchor.longitude, anchor.latitude] as [number, number]] : [];
    return fitMercator(points, { width, height, padding: this.fullscreen() ? 56 : 36, maxZoom: this.stops().length ? 16 : 13 });
  });
  protected readonly pins = computed(() => {
    const { width, height } = this.size();
    return this.stops().map((stop) => {
      const point = this.view().project(stop.longitude, stop.latitude);
      return { ...stop, left: (point.x / width) * 100, top: (point.y / height) * 100 };
    });
  });
  protected readonly anchorPin = computed(() => {
    const anchor = this.anchor();
    if (this.stops().length || !anchor) return null;
    const { width, height } = this.size();
    const point = this.view().project(anchor.longitude, anchor.latitude);
    return { label: anchor.label, left: (point.x / width) * 100, top: (point.y / height) * 100 };
  });
  protected readonly line = computed(() => this.path().length > 1
    ? this.path().map(([lon, lat]) => { const p = this.view().project(lon, lat); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ')
    : '');

  constructor() {
    // All'apertura il fuoco va sul pulsante di chiusura; la pagina sotto non scorre.
    effect(() => {
      const open = this.fullscreen();
      document.body.style.overflow = open ? 'hidden' : '';
      if (open) queueMicrotask(() => this.closeButton()?.nativeElement.focus());
    });
    inject(DestroyRef).onDestroy(() => { document.body.style.overflow = ''; });
  }

  protected open(): void {
    this.opener = document.activeElement as HTMLElement | null;
    this.fullscreen.set(true);
  }

  protected close(): void {
    this.fullscreen.set(false);
    this.opener?.focus();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.fullscreen()) this.close();
  }
}
