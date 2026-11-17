import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { agencyCan, BOOKING_CHANNEL_LABELS, DASHBOARD_PERIODS, type AgencyDashboardSummary, type DashboardPeriodKey } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { AgencyApi, type MyAgency } from '../../core/api/agency.api';
import { formatPrice } from '../../core/api/catalog.api';
import { ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';

/**
 * Dati dell'agenzia (AG-07): fatturato lordo del periodo, riempimento medio,
 * viaggi pubblicati, coordinatori attivi, prenotazioni per canale e classifica
 * dei coordinatori. I numeri arrivano dal server: qui si mostrano soltanto.
 */
@Component({
  selector: 'odys-agency-data-page',
  imports: [RouterLink, ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="head">
        <p class="eyebrow">{{ mine()?.agency?.displayName ?? 'Agenzia' }}</p>
        <h1>Dati dell’agenzia</h1>
      </header>
      <div class="periods" role="group" aria-label="Periodo">
        @for (item of periods; track item.key) {<button odysChip [selected]="period() === item.key" (click)="period.set(item.key)">{{ item.label }}</button>}
      </div>

      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}

      @if (data(); as d) {
        <section class="hero" aria-labelledby="rev-title">
          <p class="hero__label" id="rev-title">Fatturato lordo · {{ d.range.label.toLowerCase() }}</p>
          <p class="hero__value">{{ money(d.revenue.grossCents) }}</p>
          <p class="hero__meta">
            @if (d.revenue.changePercent !== null) {
              <span class="delta" [class.delta--down]="d.revenue.changePercent < 0"><odys-icon [name]="d.revenue.changePercent < 0 ? 'arrow-down' : 'arrow-up'" [size]="14" />{{ d.revenue.changePercent > 0 ? '+' : '' }}{{ d.revenue.changePercent }}%</span>
              <span>rispetto al periodo precedente ({{ money(d.revenue.previousGrossCents) }})</span>
            } @else {<span>Nessun incasso nel periodo precedente da confrontare</span>}
          </p>
          <p class="hero__note">Acconti e saldi confermati sui viaggi del catalogo e su quelli coperti dall’agenzia.</p>
        </section>

        <div class="kpis">
          <div class="kpi"><span class="kpi__value">{{ d.averageFill === null ? '—' : percent(d.averageFill) }}</span><span class="kpi__label">riempimento medio</span></div>
          <div class="kpi"><span class="kpi__value">{{ d.publishedTrips }}</span><span class="kpi__label">viaggi in vendita o in corso</span></div>
          <div class="kpi"><span class="kpi__value">{{ d.activeCoordinators }}<small>/{{ d.coordinators }}</small></span><span class="kpi__label">coordinatori attivi</span></div>
        </div>

        <section class="card" aria-labelledby="ch-title">
          <h2 id="ch-title">Prenotazioni per canale</h2>
          @if (bookings() > 0) {
            <div class="split" role="img" [attr.aria-label]="channelsLabel()">
              <span class="split__odys" [style.flex-grow]="d.channels.odys"></span>
              <span class="split__direct" [style.flex-grow]="d.channels.direct"></span>
            </div>
            <ul class="legend">
              <li><span class="dot dot--odys" aria-hidden="true"></span>{{ channelLabels.odys }} <strong>{{ d.channels.odys }}</strong></li>
              <li><span class="dot dot--direct" aria-hidden="true"></span>{{ channelLabels.direct }} <strong>{{ d.channels.direct }}</strong>@if (d.channels.directShare !== null) { · {{ d.channels.directShare }}%}</li>
            </ul>
          } @else {
            <p class="muted">Nessuna prenotazione con acconto nel periodo.</p>
          }
          <p class="muted small">«Canali diretti»: chi arriva dal link del kit social condiviso fuori da Odys o da un viaggio su invito (regola provvisoria).</p>
        </section>

        <section class="card" aria-labelledby="lb-title">
          <h2 id="lb-title">Classifica dei coordinatori</h2>
          @if (d.leaderboard.length) {
            <ol class="board">
              @for (row of d.leaderboard; track row.userId; let i = $index) {
                <li class="board__row">
                  <span class="board__rank" [class.board__rank--top]="i === 0 && row.revenueCents > 0">{{ i + 1 }}</span>
                  <span class="board__main">
                    <a [routerLink]="['/coordinatori', row.userId]"><strong>{{ row.name }}</strong></a>@if (row.licensed) {<span class="tag">con licenza</span>}
                    <span class="bar" role="img" [attr.aria-label]="row.fill === null ? 'Nessun viaggio in vendita' : 'Riempimento ' + percent(row.fill)"><span [style.width.%]="(row.fill ?? 0) * 100"></span></span>
                    <span class="muted small">{{ row.trips }} {{ row.trips === 1 ? 'viaggio' : 'viaggi' }} · riempimento {{ row.fill === null ? '—' : percent(row.fill) }}</span>
                  </span>
                  <span class="board__rev">{{ money(row.revenueCents) }}</span>
                </li>
              }
            </ol>
          } @else {
            <p class="muted">Invita i coordinatori nel team: qui vedrai ricavi e riempimento di ciascuno.</p>
          }
        </section>
      } @else if (!loading() && !error()) {
        <odys-empty-state icon="chart-column" title="Nessun dato" description="I dati dell’agenzia li vedono proprietario e amministratori." />
      } @else if (loading()) {
        <p class="muted">Carico i dati…</p>
      }
    </div>
  `,
  styles: `
    .head { margin-bottom: var(--space-4); h1 { font-size: var(--text-3xl); } }
    .periods { display: flex; gap: var(--space-2); overflow-x: auto; margin: 0 calc(-1 * var(--layout-gutter, 16px)) var(--space-5); padding: 0 var(--layout-gutter, 16px) 2px; scrollbar-width: none; > * { flex-shrink: 0; } }
    odys-notice { display: block; margin-bottom: var(--space-4); }
    .hero { padding: var(--space-5); border-radius: var(--radius-xl, 28px); background: var(--odys-blue); color: #fff; }
    .hero__label { font-size: var(--text-sm); font-weight: 700; opacity: 0.85; }
    .hero__value { margin: 4px 0; font-family: var(--font-brand); font-weight: 900; font-size: clamp(2.25rem, 11vw, 3.5rem); line-height: 1; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
    .hero__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px var(--space-2); font-size: var(--text-sm); opacity: 0.9; }
    .hero__note { margin-top: var(--space-2); font-size: var(--text-xs); opacity: 0.8; }
    .delta { display: inline-flex; align-items: center; gap: 2px; padding: 2px 8px; border-radius: var(--radius-pill); background: var(--odys-lime); color: var(--odys-ink); font-weight: 800; }
    .delta--down { background: var(--odys-coral); }
    .kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); margin: var(--space-4) 0; }
    .kpi { display: flex; flex-direction: column; gap: 2px; padding: var(--space-4) var(--space-3); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); text-align: center; }
    .kpi__value { font-family: var(--font-brand); font-weight: 900; font-size: var(--text-2xl); font-variant-numeric: tabular-nums; small { font-size: 0.55em; color: var(--color-text-muted); } }
    .kpi__label { font-size: var(--text-xs); font-weight: 600; color: var(--color-text-muted); line-height: 1.25; }
    .card { display: flex; flex-direction: column; gap: var(--space-3); margin-bottom: var(--space-4); padding: var(--space-5); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); h2 { font-size: var(--text-lg); } }
    .split { display: flex; gap: 2px; height: 14px; border-radius: 4px; overflow: hidden; > span { flex-basis: 0; } }
    .split__odys { background: var(--odys-blue); }
    .split__direct { background: var(--color-text); }
    .legend { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); margin: 0; padding: 0; list-style: none; font-size: var(--text-sm); li { display: inline-flex; align-items: center; gap: 6px; } }
    .dot { width: 10px; height: 10px; border-radius: 3px; }
    .dot--odys { background: var(--odys-blue); }
    .dot--direct { background: var(--color-text); }
    .board { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .board__row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface-muted); }
    .board__rank { display: grid; place-items: center; flex-shrink: 0; width: 32px; height: 32px; border-radius: 50%; background: var(--color-surface); font-weight: 900; font-variant-numeric: tabular-nums; }
    .board__rank--top { background: var(--odys-lime); color: var(--odys-ink); }
    .board__main { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; a { color: var(--color-text); text-decoration: none; } }
    .tag { margin-left: 6px; padding: 1px 8px; border-radius: var(--radius-pill); background: var(--odys-blue); color: #fff; font-size: var(--text-xs); font-weight: 700; }
    .bar { display: block; height: 8px; border-radius: 4px; background: var(--color-surface); box-shadow: inset 0 0 0 1px var(--color-border); > span { display: block; height: 100%; border-radius: 4px; background: var(--odys-blue); } }
    .board__rev { flex-shrink: 0; font-weight: 800; font-variant-numeric: tabular-nums; }
    .muted { color: var(--color-text-muted); font-size: var(--text-sm); }
    .small { font-size: var(--text-xs); }
  `,
})
export default class AgencyDataPage {
  private readonly api = inject(AgencyApi);
  protected readonly periods = (Object.keys(DASHBOARD_PERIODS) as DashboardPeriodKey[]).map((key) => ({ key, label: DASHBOARD_PERIODS[key] }));
  protected readonly channelLabels = BOOKING_CHANNEL_LABELS;
  protected readonly period = signal<DashboardPeriodKey>('month');
  protected readonly mine = signal<MyAgency | null>(null);
  protected readonly data = signal<AgencyDashboardSummary | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly bookings = computed(() => (this.data()?.channels.odys ?? 0) + (this.data()?.channels.direct ?? 0));
  protected readonly channelsLabel = computed(() => {
    const c = this.data()?.channels;
    return c ? `${BOOKING_CHANNEL_LABELS.odys} ${c.odys}, ${BOOKING_CHANNEL_LABELS.direct} ${c.direct}` : '';
  });

  constructor() {
    effect(() => {
      const period = this.period();
      untracked(() => void this.load(period));
    });
  }

  private async load(period: DashboardPeriodKey): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const mine = this.mine() ?? (await this.api.mine());
      this.mine.set(mine);
      if (!mine || !agencyCan(mine.role, 'licenses.assign')) { this.data.set(null); return; }
      const result = await this.api.dashboard(mine.agency.id, period);
      if (period === this.period()) this.data.set(result.summary);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile leggere i dati.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected money(cents: number): string {
    return formatPrice(cents, 'EUR');
  }

  protected percent(value: number): string {
    return `${Math.round(value * 100)}%`;
  }
}
