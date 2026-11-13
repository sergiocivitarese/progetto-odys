import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Puntatore «Orbit Route» per mappe e itinerari: anello aperto con punto corallo
 * e numero della tappa al centro. `active` lo riempie di lime (tappa attiva).
 */
@Component({
  selector: 'odys-ring-pin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-active]': 'active()', '[style.--pin-size.px]': 'size()' },
  template: `
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="15" class="disc" />
      <path d="M31 11.5A14 14 0 1 0 34 20" class="ring" />
      <circle cx="31.5" cy="9" r="4" class="dot" />
    </svg>
    <span class="label"><ng-content /></span>
  `,
  styles: `
    :host { position: relative; display: inline-grid; place-items: center; width: var(--pin-size, 36px); height: var(--pin-size, 36px); flex-shrink: 0; }
    svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .disc { fill: var(--color-surface); }
    .ring { fill: none; stroke: var(--color-primary); stroke-width: 6; stroke-linecap: round; }
    .dot { fill: var(--color-urgent); }
    .label { position: relative; font-family: var(--font-brand); font-weight: 900; font-size: calc(var(--pin-size, 36px) * 0.36); line-height: 1; color: var(--color-text); font-variant-numeric: tabular-nums; }
    :host(.is-active) .disc { fill: var(--odys-lime); }
    :host(.is-active) .ring { stroke: var(--odys-ink); }
    :host(.is-active) .label { color: var(--odys-ink); }
  `,
})
export class RingPinComponent {
  readonly active = input(false);
  readonly size = input(36);
}
