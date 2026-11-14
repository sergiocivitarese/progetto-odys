import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-client';
import { AgencyApi, type AgencyPublicProfile } from '../../core/api/agency.api';
import { initialsOf } from '../../core/api/catalog.api';
import { EmptyStateComponent, IconComponent } from '../../shared/ui';

/** Pagina pubblica dell'agenzia (AG-01): chi è, contatti e coordinatori del team. */
@Component({
  selector: 'odys-agency-public-page',
  imports: [RouterLink, EmptyStateComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @if (error()) {
        <odys-empty-state icon="users" title="Agenzia non trovata" [description]="error()" />
      } @else if (agency(); as a) {
        <header class="hero">
          <span class="logo">
            @if (a.logoUrl) {<img [src]="a.logoUrl" alt="" />} @else {<span aria-hidden="true">{{ initials() }}</span>}
          </span>
          <p class="eyebrow">Agenzia di viaggi@if (a.city) { · {{ a.city }}}@if (a.country) {, {{ a.country }}}</p>
          <h1>{{ a.displayName }}</h1>
          @if (a.description) {<p class="bio">{{ a.description }}</p>}
          <ul class="contacts">
            @if (a.website) {<li><a [href]="a.website" target="_blank" rel="noopener"><odys-icon name="arrow-up-right" [size]="16" /> {{ host(a.website) }}</a></li>}
            @if (a.email) {<li><a [href]="'mailto:' + a.email"><odys-icon name="mail" [size]="16" /> {{ a.email }}</a></li>}
            @if (a.phone) {<li><a [href]="'tel:' + a.phone.replace(' ', '')"><odys-icon name="message" [size]="16" /> {{ a.phone }}</a></li>}
          </ul>
        </header>

        <h2>Coordinatori · {{ a.coordinators.length }}</h2>
        <ul class="team">
          @for (c of a.coordinators; track c.id) {
            <li>
              <a class="coach" [routerLink]="['/coordinatori', c.id]">
                <span class="coach__avatar">@if (c.avatarUrl) {<img [src]="c.avatarUrl" alt="" />} @else {{{ initialsFor(c.displayName) }}}</span>
                <span class="coach__main">
                  <strong>{{ c.displayName }}@if (c.verified) {<odys-icon name="verified" [size]="16" class="ok" />}</strong>
                  <span class="muted">@if (c.rating) {★ {{ rating(c.rating) }} · }{{ c.tripsCompleted ?? 0 }} viaggi fatti@if (c.headline) { · {{ c.headline }}}</span>
                </span>
                <odys-icon name="chevron-right" />
              </a>
            </li>
          } @empty {
            <li class="muted">I coordinatori del team compariranno qui.</li>
          }
        </ul>
      } @else {
        <p class="muted">Carico…</p>
      }
    </div>
  `,
  styles: `
    .hero { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-6) var(--space-5); border-radius: var(--radius-xl, 28px); background: var(--odys-blue); color: #fff;
      .eyebrow { color: var(--odys-lime); } h1 { font-family: var(--font-brand); font-weight: 900; font-size: clamp(2rem, 9vw, 3rem); line-height: 1; letter-spacing: -0.02em; } }
    .logo { display: grid; place-items: center; width: 72px; height: 72px; margin-bottom: var(--space-2); border-radius: var(--radius-lg); background: #fff; color: var(--odys-blue); font-weight: 900; font-size: var(--text-xl); overflow: hidden;
      img { width: 100%; height: 100%; object-fit: cover; } }
    .bio { font-size: var(--text-lg); opacity: 0.95; max-width: 60ch; }
    .contacts { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-2) 0 0; padding: 0; list-style: none;
      a { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 var(--space-3); border-radius: var(--radius-pill); background: rgb(255 255 255 / 0.15); color: #fff; font-size: var(--text-sm); font-weight: 700; text-decoration: none; } }
    h2 { font-size: var(--text-xl); margin: var(--space-6) 0 var(--space-3); }
    .team { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .coach { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); color: var(--color-text); text-decoration: none; }
    .coach__avatar { display: grid; place-items: center; flex-shrink: 0; width: 48px; height: 48px; border-radius: 50%; background: var(--odys-ink); color: var(--odys-lime); font-weight: 900; overflow: hidden;
      img { width: 100%; height: 100%; object-fit: cover; } }
    .coach__main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; strong { display: inline-flex; align-items: center; gap: 4px; } .muted { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
    .ok { color: var(--odys-blue); }
    .muted { color: var(--color-text-muted); font-size: var(--text-sm); }
  `,
})
export default class AgencyPublicPage {
  private readonly api = inject(AgencyApi);
  readonly slug = input.required<string>();
  protected readonly agency = signal<AgencyPublicProfile | null>(null);
  protected readonly error = signal('');
  protected readonly initials = computed(() => initialsOf(this.agency()?.displayName ?? ''));

  constructor() {
    effect(() => {
      const slug = this.slug();
      untracked(async () => {
        try {
          this.agency.set(await this.api.publicProfile(slug));
        } catch (error) {
          this.error.set(apiErrorMessage(error, 'Questa agenzia non esiste o non è più su Odys.'));
        }
      });
    });
  }

  protected initialsFor(name: string): string {
    return initialsOf(name);
  }

  protected host(url: string): string {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  protected rating(value: number): string {
    return value.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
}
