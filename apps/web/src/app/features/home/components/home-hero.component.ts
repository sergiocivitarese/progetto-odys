import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '../../../shared/ui';

/** Blocco di apertura della Home: messaggio di valore + CTA principale. */
@Component({
  selector: 'odys-home-hero',
  imports: [ButtonComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero__copy">
        <p class="hero__tagline">Plan. Discover. Experience.</p>
        <h1 id="hero-title">Il viaggio giusto, <span class="highlight">senza il rumore.</span></h1>
        <p class="hero__lead">Costruisci un itinerario che segue il tuo ritmo, non il contrario. Date, tappe e interessi: il resto lo completi quando vuoi.</p>
        <div class="hero__actions">
          <a odysButton variant="accent" size="lg" trailingIcon="arrow-up-right" routerLink="/pianifica">Pianifica il mio viaggio</a>
          <a odysButton variant="ghost" routerLink="/gruppi" class="hero__secondary">Esplora i viaggi di gruppo</a>
        </div>
      </div>
      <div class="hero__art" aria-hidden="true">
        <svg viewBox="0 0 240 240">
          <circle cx="120" cy="120" r="104" fill="none" stroke="#3157FF" stroke-width="2" stroke-dasharray="4 10" />
          <path d="M120 44a76 76 0 1 1-50 133l-32 26 13-43A76 76 0 0 1 120 44Zm0 34a42 42 0 1 0 0 84 42 42 0 0 0 0-84Z" fill="#F8F7F3" />
          <path d="M120 88c2.6 14.4 9.6 21.4 24 24-14.4 2.6-21.4 9.6-24 24-2.6-14.4-9.6-21.4-24-24 14.4-2.6 21.4-9.6 24-24Z" fill="#D8F64E" />
          <path d="M34 178c40 18 120 20 178-44" fill="none" stroke="#3157FF" stroke-width="6" stroke-linecap="round" />
          <path d="m204 120 14 8-16 6" fill="none" stroke="#3157FF" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
    </section>
  `,
  styles: `
    .hero {
      position: relative; display: grid; gap: var(--space-6); overflow: hidden;
      padding: var(--space-8) var(--space-6); border-radius: var(--radius-xl);
      background: var(--color-brand-panel); color: var(--odys-off-white);
    }
    .hero__tagline { font-size: var(--text-xs); font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; color: var(--odys-lime); margin-bottom: var(--space-3); }
    h1 { font-size: var(--text-3xl); max-width: 14ch; }
    .highlight { color: var(--odys-lime); font-style: italic; }
    .hero__lead { margin-top: var(--space-4); max-width: 46ch; color: var(--color-on-brand-muted); font-size: var(--text-lg); }
    .hero__actions { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-6); align-items: center; }
    .hero__secondary { color: var(--odys-off-white); }
    .hero__secondary:hover { background: rgb(255 255 255 / 0.08) !important; }
    .hero__art { display: none; }
    .hero__art svg { width: 100%; height: auto; }
    @media (min-width: 900px) {
      .hero { grid-template-columns: 1.4fr 1fr; align-items: center; padding: var(--space-12); }
      .hero__art { display: block; max-width: 300px; justify-self: end; }
    }
  `,
})
export class HomeHeroComponent {}
