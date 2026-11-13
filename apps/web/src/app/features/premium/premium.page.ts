import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Entitlement } from '@odys/domain';
import { AuthStore } from '../../core/auth/auth.store';
import { EntitlementsStore } from '../../core/state/entitlements.store';
import { ButtonComponent, IconComponent, LogoComponent, type IconName } from '../../shared/ui';

interface Feature { icon: IconName; title: string; text: string; entitlement: Entitlement }

const TRAVELLER: Feature[] = [
  { icon: 'sparkles', title: 'Generatore AI', text: 'Dici meta, date, budget e interessi: l’itinerario giorno per giorno lo prepara Odys.', entitlement: 'ai.generate' },
  { icon: 'map', title: 'Meteo, mappe e storia dei luoghi', text: 'Ogni viaggio salvato con le previsioni, il percorso del giorno e la storia di ciò che visiti.', entitlement: 'trips.insights' },
  { icon: 'chart-pie', title: 'Split delle spese', text: 'Cassa comune del gruppo: chi ha pagato, chi deve a chi, e il saldo con meno pagamenti possibili.', entitlement: 'split.use' },
];
const COORDINATOR: Feature[] = [
  { icon: 'chart-column', title: 'Guadagni e prenotazioni', text: 'Compenso del periodo, prenotazioni per settimana, saldi in sospeso da sollecitare.', entitlement: 'analytics.coordinator' },
  { icon: 'funnel', title: 'Funnel e post che vendono', text: 'Da quante visualizzazioni nascono le prenotazioni, e quali post le portano.', entitlement: 'analytics.coordinator' },
];

/**
 * Schermata di upgrade (TP-10): ogni funzione a pagamento aperta da chi non
 * ne ha diritto porta qui, mai a un errore. `?funzione=` indica cosa si cercava.
 */
@Component({
  selector: 'odys-premium-page',
  imports: [RouterLink, ButtonComponent, IconComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="premium">
      <div class="premium__inner">
        <p class="brandline"><odys-logo variant="mark" [size]="26" /><span class="meta-line">{{ forCoordinators() ? 'Coordinatore Premium' : 'Traveller Premium' }}</span></p>
        <h1>{{ forCoordinators() ? 'I tuoi viaggi,' : 'Il viaggio su misura,' }} <span>{{ forCoordinators() ? 'in numeri.' : 'dall’idea al rientro.' }}</span></h1>
        <p class="lead">
          @if (entitlements.has(wanted())) {
            Hai già questa funzione nel tuo piano ({{ entitlements.planLabel() }}).
          } @else {
            {{ forCoordinators() ? 'Con Coordinatore Premium vedi quanto rendono viaggi e contenuti.' : 'Con Traveller Premium hai tutto il Base e in più:' }}
          }
        </p>

        <ul class="features">
          @for (feature of features(); track feature.title) {
            <li [class.is-wanted]="feature.entitlement === wanted()">
              <span class="features__icon"><odys-icon [name]="feature.icon" [size]="22" /></span>
              <span><strong>{{ feature.title }}</strong>{{ feature.text }}</span>
            </li>
          }
        </ul>

        <div class="status">
          <odys-icon name="info" [size]="20" />
          <p>
            Gli abbonamenti non si acquistano ancora dall’app: prezzi e durata sono in definizione.
            @if (auth.isAuthenticated()) { Il tuo piano di oggi è <strong>{{ entitlements.planLabel() }}</strong>. }
          </p>
        </div>

        <div class="actions">
          <a odysButton variant="accent" size="lg" routerLink="/" trailingIcon="arrow-right">Torna a Esplora</a>
          @if (!auth.isAuthenticated()) {
            <a odysButton variant="secondary" size="lg" routerLink="/accedi" [queryParams]="{ ritorno: '/premium' }">Accedi</a>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .premium { background: var(--odys-ink); color: var(--odys-off-white); min-height: calc(100dvh - var(--header-height)); margin-bottom: calc(-1 * (var(--bottom-nav-height) + var(--bottom-nav-gap) * 2 + env(safe-area-inset-bottom))); padding-bottom: calc(var(--bottom-nav-height) + var(--space-12)); }
    .premium__inner { max-width: 640px; margin-inline: auto; padding: var(--space-8) var(--layout-gutter) var(--space-8); display: flex; flex-direction: column; gap: var(--space-6); --logo-ring: var(--odys-lime); }
    .brandline { display: flex; align-items: center; gap: var(--space-3); color: var(--odys-lime); }
    h1 { font-size: clamp(2.25rem, 1.5rem + 4vw, 3.5rem); span { color: var(--odys-lime); display: block; } }
    .lead { color: #d6d4cd; font-size: var(--text-lg); }
    .features { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .features li { display: grid; grid-template-columns: auto 1fr; gap: var(--space-4); align-items: start; padding: var(--space-5) 0; border-top: 1px solid #33332f; }
    .features li:last-child { border-bottom: 1px solid #33332f; }
    .features strong { display: block; font-size: var(--text-lg); font-weight: 800; margin-bottom: var(--space-1); }
    .features span:last-child { color: #c9c7c0; line-height: 1.5; }
    .features__icon { display: grid; place-items: center; width: 48px; height: 48px; border-radius: var(--radius-md); background: #232321; color: var(--odys-lime); }
    .is-wanted .features__icon { background: var(--odys-blue); color: #fff; }
    .is-wanted strong { color: var(--odys-lime); }
    .status { display: grid; grid-template-columns: auto 1fr; gap: var(--space-3); padding: var(--space-4); border-radius: var(--radius-lg); background: #232321; color: #d6d4cd; font-size: var(--text-sm); line-height: 1.5; strong { color: var(--odys-off-white); } }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    :host ::ng-deep a.odys-button--secondary { background: transparent; color: var(--odys-off-white); border-color: #6a685f; }
    @media (min-width: 900px) { .premium { margin-bottom: 0; padding-bottom: var(--space-12); } }
  `,
})
export default class PremiumPage {
  protected readonly auth = inject(AuthStore);
  protected readonly entitlements = inject(EntitlementsStore);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap);
  protected readonly wanted = computed(() => (this.params()?.get('funzione') ?? 'ai.generate') as Entitlement);
  /** Chi vende già viaggi cerca le statistiche; gli altri le funzioni del Traveller Premium. */
  protected readonly forCoordinators = computed(() => this.wanted() === 'analytics.coordinator' || (this.entitlements.has('trips.sell') && !this.entitlements.has('analytics.coordinator')));
  protected readonly features = computed(() => (this.forCoordinators() ? COORDINATOR : TRAVELLER));
}
