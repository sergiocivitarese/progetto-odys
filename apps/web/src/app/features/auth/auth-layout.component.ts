import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent, LogoComponent } from '../../shared/ui';

/** Impaginazione comune delle pagine di accesso: pannello del brand + modulo. */
@Component({
  selector: 'odys-auth-layout',
  imports: [IconComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page auth">
      <aside class="brand" aria-hidden="true">
        <odys-logo variant="mark" [size]="48" />
        <p class="brand__tagline">Plan. Discover. Experience.</p>
        <p class="brand__title">{{ claim() }}</p>
        <ul>
          <li><odys-icon name="bookmark" [size]="16" /> I tuoi viaggi salvati e sempre aggiornati</li>
          <li><odys-icon name="restore" [size]="16" /> La cronologia di ogni modifica, ripristinabile</li>
          <li><odys-icon name="users" [size]="16" /> Le idee di gruppo che vuoi ritrovare</li>
        </ul>
      </aside>
      <section class="panel" [attr.aria-labelledby]="'auth-title'">
        <p class="eyebrow">{{ eyebrow() }}</p>
        <h1 id="auth-title">{{ title() }}</h1>
        @if (subtitle()) {<p class="muted subtitle">{{ subtitle() }}</p>}
        <ng-content />
      </section>
    </div>
  `,
  styles: `
    .auth { display: grid; gap: var(--space-5); max-width: 1040px; }
    .brand { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-8) var(--space-6); border-radius: var(--radius-xl); background: var(--color-brand-panel); color: var(--color-on-brand); }
    .brand__tagline { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.28em; text-transform: uppercase; color: var(--odys-lime); margin-top: var(--space-3); }
    .brand__title { font-family: var(--font-brand); font-weight: 800; font-size: var(--text-2xl); line-height: var(--leading-tight); }
    ul { list-style: none; margin: var(--space-3) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); color: var(--color-on-brand-muted); }
    li { display: flex; gap: var(--space-2); align-items: flex-start; } li odys-icon { color: var(--odys-lime); margin-top: 3px; }
    .panel { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-6); border-radius: var(--radius-xl); background: var(--color-surface); border: var(--border-width) solid var(--color-border); }
    h1 { font-size: var(--text-2xl); }
    .subtitle { margin-top: calc(var(--space-2) * -1); }
    @media (max-width: 719px) { .brand ul { display: none; } .brand { padding: var(--space-5); } }
    @media (min-width: 720px) {
      .auth { grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); align-items: stretch; padding-top: var(--space-10); }
      .panel { padding: var(--space-8); }
    }
  `,
})
export class AuthLayoutComponent {
  readonly eyebrow = input('Il tuo account');
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
  readonly claim = input('Il viaggio giusto, sempre con te.');
}
