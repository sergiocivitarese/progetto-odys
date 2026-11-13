import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Itinerary } from '@odys/domain';
import { RingPinComponent } from '../ui';

export interface TripStop {
  label: string;
  latitude: number;
  longitude: number;
  day: number;
}

/** Una tappa per città, nell'ordine dei giorni: il primo luogo con coordinate di ogni giornata. */
export function tripStops(itinerary: Itinerary): TripStop[] {
  const stops: TripStop[] = [];
  for (const day of itinerary.days) {
    const place = day.activities.map((activity) => activity.place).find((item) => item?.latitude !== undefined && item?.longitude !== undefined);
    const fallback = day.finalDestination?.latitude !== undefined ? day.finalDestination : undefined;
    const latitude = place?.latitude ?? fallback?.latitude;
    const longitude = place?.longitude ?? fallback?.longitude;
    if (latitude === undefined || longitude === undefined) continue;
    const label = (place?.city || fallback?.city || place?.title || fallback?.label || day.label).trim();
    const previous = stops.at(-1);
    if (previous && previous.label.toLowerCase() === label.toLowerCase()) continue;
    stops.push({ label, latitude, longitude, day: day.day });
  }
  return stops;
}

/** Chilometri in linea d'aria tra le tappe (formula dell'emisenoverso). */
export function stopsDistanceKm(stops: TripStop[]): number {
  let total = 0;
  for (let index = 1; index < stops.length; index += 1) {
    const a = stops[index - 1];
    const b = stops[index];
    const rad = Math.PI / 180;
    const dLat = (b.latitude - a.latitude) * rad;
    const dLon = (b.longitude - a.longitude) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
    total += 2 * 6371 * Math.asin(Math.sqrt(h));
  }
  return total;
}

const W = 340;
const H = 220;
const PAD = 34;

/**
 * Mappa delle tappe in stile Orbit Route (TB-06): puntatori ad anello numerati
 * e percorso tratteggiato, disegnati dalle coordinate dell'itinerario.
 * Non è una cartina: è lo schema della rotta, leggibile anche offline.
 */
@Component({
  selector: 'odys-stops-map',
  imports: [RingPinComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="map" [attr.aria-label]="'Rotta del viaggio: ' + names()">
      <svg [attr.viewBox]="'0 0 ' + width + ' ' + height" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <polyline [attr.points]="line()" class="route" />
      </svg>
      @for (point of points(); track point.label; let first = $first; let last = $last) {
        <span class="stop" [style.left.%]="point.x / width * 100" [style.top.%]="point.y / height * 100">
          <odys-ring-pin [size]="34" [active]="first || last">{{ $index + 1 }}</odys-ring-pin>
          <span class="stop__label" [class.stop__label--below]="point.labelBelow">{{ point.label }}</span>
        </span>
      }
      <figcaption class="badge">{{ stops().length }} tappe@if (km()) { · ~{{ km() }} km}</figcaption>
    </figure>
  `,
  styles: `
    .map { position: relative; margin: 0; aspect-ratio: ${W} / ${H}; border-radius: var(--radius-lg); overflow: hidden;
      background: radial-gradient(120% 90% at 85% 10%, color-mix(in srgb, var(--odys-blue) 14%, transparent), transparent 60%), var(--color-primary-soft); border: var(--border-width) solid color-mix(in srgb, var(--odys-blue) 22%, var(--color-border)); }
    svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .route { fill: none; stroke: var(--odys-blue); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 9 7; }
    .stop { position: absolute; transform: translate(-50%, -50%); display: grid; justify-items: center; }
    .stop__label { position: absolute; bottom: calc(100% + 4px); padding: 3px 10px; border-radius: var(--radius-pill); background: var(--color-surface); color: var(--color-text); font-size: var(--text-xs); font-weight: 800; white-space: nowrap; box-shadow: var(--shadow-sm); }
    .stop__label--below { bottom: auto; top: calc(100% + 4px); }
    .badge { position: absolute; left: var(--space-3); bottom: var(--space-3); padding: 6px 12px; border-radius: var(--radius-pill); background: var(--odys-ink); color: #fff; font-size: var(--text-sm); font-weight: 800; }
  `,
})
export class StopsMapComponent {
  readonly stops = input.required<TripStop[]>();
  protected readonly width = W;
  protected readonly height = H;

  protected readonly names = computed(() => this.stops().map((stop) => stop.label).join(', '));
  protected readonly km = computed(() => {
    const value = stopsDistanceKm(this.stops());
    return value >= 10 ? Math.round(value / 10) * 10 : Math.round(value);
  });
  /** Proiezione equirettangolare nel riquadro, con la stessa scala sui due assi. */
  protected readonly points = computed(() => {
    const stops = this.stops();
    const meanLat = stops.reduce((sum, stop) => sum + stop.latitude, 0) / Math.max(1, stops.length);
    const xs = stops.map((stop) => stop.longitude * Math.cos((meanLat * Math.PI) / 180));
    const ys = stops.map((stop) => -stop.latitude);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const scale = Math.min((W - PAD * 2) / Math.max(maxX - minX, 1e-6), (H - PAD * 2) / Math.max(maxY - minY, 1e-6));
    const offsetX = (W - (maxX - minX) * scale) / 2;
    const offsetY = (H - (maxY - minY) * scale) / 2;
    return stops.map((stop, index) => {
      const y = offsetY + (ys[index] - minY) * scale;
      return { label: stop.label, x: offsetX + (xs[index] - minX) * scale, y, labelBelow: y < 44 };
    });
  });
  protected readonly line = computed(() => this.points().map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '));
}
