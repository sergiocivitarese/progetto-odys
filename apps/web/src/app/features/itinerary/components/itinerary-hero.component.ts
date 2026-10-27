import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  arrivalDayLabel,
  ARRIVAL_TRANSPORT_LABELS,
  budgetSummary,
  firstDestinationLabel,
  TRANSPORT_LABELS,
  type Itinerary,
  type WeatherSnapshot,
} from '@odys/domain';
import { ButtonComponent, IconComponent, InfoRowComponent } from '../../../shared/ui';

/** Riepilogo del viaggio: durata, profilo, date, arrivo, budget e meteo. */
@Component({
  selector: 'odys-itinerary-hero',
  imports: [ButtonComponent, IconComponent, InfoRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero">
      <div class="hero__top">
        <div>
          <p class="hero__kicker">Itinerario pronto</p>
          <p class="hero__title">{{ plan().duration }} {{ plan().duration === 1 ? 'giorno' : 'giorni' }} da vivere</p>
        </div>
        <span class="hero__sun"><odys-icon name="sun" [size]="22" /></span>
      </div>
      <p class="hero__profile">{{ plan().profile }}</p>

      <div class="grid">
        <odys-info-row icon="calendar" title="Date" [value]="(plan().departure || '—') + ' → ' + (plan().returnDate || '—')" />
        <odys-info-row icon="clock" title="Orari" [value]="(plan().arrivalTime || 'Orario non inserito') + ' arrivo · ' + (plan().departureTime || 'Orario non inserito') + ' partenza'" />
        <odys-info-row icon="sliders" title="Ritmo" [value]="plan().pace" />
        <odys-info-row icon="navigation" title="Arrivo" [value]="arrival()" />
        <odys-info-row icon="calendar" title="Giorno di arrivo" [value]="arrivalDay()" />
        <odys-info-row icon="map-pin" title="Prima destinazione" [value]="firstDestination()" />
        <odys-info-row icon="route" title="Spostamenti locali" [value]="transport()" />
        <odys-info-row icon="credit-card" title="Budget per viaggiatore" [value]="budget().confirmed ? budget().perTraveler : 'Valore migrato: ' + budget().perTraveler + ' · da verificare'" />
        @if (budget().estimatedTotal) {
          <odys-info-row icon="users" title="Budget totale stimato" [value]="budget().estimatedTotal + ' · ' + budget().travelerCount + ' viaggiatori'" />
        }
      </div>

      @if (!budget().estimatedTotal) {
        <p class="hero__hint">{{ budget().confirmed ? 'Il totale stimato richiede un budget numerico e il numero di viaggiatori.' : 'Il valore migrato non viene interpretato come budget individuale: confermalo prima di calcolare un totale.' }}</p>
      }
      <button odysButton variant="ghost" size="sm" icon="credit-card" class="hero__budget" (click)="editBudget.emit()">{{ budget().confirmed ? 'Modifica budget per viaggiatore' : 'Conferma budget per viaggiatore' }}</button>

      <p class="hero__weather"><odys-icon name="cloud" [size]="16" /> {{ weatherLine() }}</p>
      @if (plan().scheduleNote) {
        <p class="hero__warning"><odys-icon name="alert-triangle" [size]="16" /> {{ plan().scheduleNote }}</p>
      }
    </section>
  `,
  styles: `
    .hero { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-6); border-radius: var(--radius-xl); background: var(--color-brand-panel); color: var(--odys-off-white);
      --info-icon-bg: rgb(255 255 255 / 0.1); --info-muted: var(--color-on-brand-muted); }
    .hero__top { display: flex; justify-content: space-between; gap: var(--space-4); }
    .hero__kicker { font-size: var(--text-xs); font-weight: 700; letter-spacing: var(--tracking-wide); text-transform: uppercase; color: var(--odys-lime); }
    .hero__title { font-family: var(--font-brand); font-weight: 800; font-size: var(--text-2xl); line-height: var(--leading-tight); margin-top: 4px; }
    .hero__sun { display: grid; place-items: center; width: 48px; height: 48px; border-radius: var(--radius-md); background: var(--odys-lime); color: var(--odys-ink); flex-shrink: 0; }
    .hero__profile { color: var(--color-on-brand-muted); font-size: var(--text-sm); }
    .grid { display: grid; gap: var(--space-4); }
    .hero__hint { font-size: var(--text-xs); color: var(--color-on-brand-muted); }
    .hero__budget { align-self: flex-start; color: var(--odys-lime) !important; }
    .hero__weather, .hero__warning { display: flex; gap: var(--space-2); align-items: flex-start; padding: var(--space-3); border-radius: var(--radius-md); background: rgb(255 255 255 / 0.07); font-size: var(--text-sm); }
    .hero__warning { background: color-mix(in srgb, var(--odys-coral) 22%, transparent); }
    odys-icon { margin-top: 2px; }
    @media (min-width: 640px) { .grid { grid-template-columns: repeat(2, 1fr); } }
    @media (min-width: 1100px) { .grid { grid-template-columns: repeat(3, 1fr); } }
  `,
})
export class ItineraryHeroComponent {
  readonly plan = input.required<Itinerary>();
  readonly weather = input<WeatherSnapshot>();
  readonly editBudget = output<void>();

  protected readonly budget = computed(() => budgetSummary(this.plan()));
  protected readonly arrivalDay = computed(() => arrivalDayLabel(this.plan()));
  protected readonly firstDestination = computed(() => firstDestinationLabel(this.plan()));
  protected readonly transport = computed(() => TRANSPORT_LABELS[this.plan().transport]);
  protected readonly arrival = computed(() => {
    const plan = this.plan();
    return plan.arrivalTransport ? `${ARRIVAL_TRANSPORT_LABELS[plan.arrivalTransport]} · ${plan.arrivalPoint?.label ?? 'punto da definire'}` : 'Da definire';
  });
  protected readonly weatherLine = computed(() => {
    const record = this.weather();
    if (!record) return this.plan().weatherNote;
    const kind = record.status === 'HISTORICAL_CLIMATE' ? 'clima storico, non previsione' : record.status === 'OFFLINE' ? 'ultimo dato salvato' : 'previsione indicativa';
    return `${record.provider} · ${kind} per ${record.nodeLabel}`;
  });
}
