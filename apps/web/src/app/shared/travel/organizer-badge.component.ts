import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../ui';

/** «Organizzato e garantito da [Agenzia]» (AG-12): sui viaggi coperti da un'agenzia (ombrello). */
@Component({
  selector: 'odys-organizer-badge',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-compact]': 'compact()' },
  template: `
    <a class="badge" [routerLink]="['/agenzie', agency().slug]" [attr.title]="'Organizzato e garantito da ' + agency().name" (click)="$event.stopPropagation()">
      <odys-icon name="verified" [size]="compact() ? 14 : 16" />
      @if (compact()) {
        <span><span class="sr-only">Organizzato e garantito da </span><strong>{{ agency().name }}</strong></span>
      } @else {
        <span>Organizzato e garantito da <strong>{{ agency().name }}</strong></span>
      }
    </a>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .badge { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 6px 12px; border-radius: var(--radius-pill); background: var(--color-primary-soft); color: var(--color-link); font-size: var(--text-sm); font-weight: 600; text-decoration: none;
      span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } strong { font-weight: 800; } }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    :host(.is-compact) .badge { padding: 3px 8px; font-size: var(--text-xs); background: rgb(255 255 255 / 0.9); color: var(--odys-blue); }
  `,
})
export class OrganizerBadgeComponent {
  readonly agency = input.required<{ name: string; slug: string }>();
  readonly compact = input(false);
}
