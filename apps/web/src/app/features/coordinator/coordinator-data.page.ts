import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DASHBOARD_PERIODS, type DashboardPeriodKey } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, formatPrice, type CoordinatorDashboard } from '../../core/api/catalog.api';
import { ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';

const SHORT_DAY = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Dati del Coordinatore Premium (CP-01…CP-06): guadagni del periodo, indicatori,
 * avvisi con «Sollecita», viaggi attivi, funnel e post che vendono. Ogni numero
 * arriva dal server, calcolato dagli eventi registrati: il client li mostra soltanto.
 */
@Component({
  selector: 'odys-coordinator-data-page',
  imports: [DatePipe, RouterLink, ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="head">
        <p class="eyebrow">Coordinatore Premium</p>
        <h1>I tuoi dati</h1>
      </header>
      <div class="periods" role="group" aria-label="Periodo">
        @for (item of periods; track item.key) {
          <button odysChip [selected]="period() === item.key" (click)="period.set(item.key)">{{ item.label }}</button>
        }
      </div>

      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
      @if (notice()) {<odys-notice tone="success">{{ notice() }}</odys-notice>}

      @if (data(); as d) {
        <!-- CP-01 Guadagni -->
        <section class="earn" aria-labelledby="earn-title">
          <p class="earn__label" id="earn-title">A te · {{ d.summary.range.label.toLowerCase() }}</p>
          <p class="earn__value">{{ money(d.summary.earnings.netCents) }}</p>
          <p class="earn__meta">
            @if (d.summary.earnings.changePercent !== null) {
              <span class="delta" [class.delta--down]="d.summary.earnings.changePercent < 0">
                <odys-icon [name]="d.summary.earnings.changePercent < 0 ? 'arrow-down' : 'arrow-up'" [size]="14" />
                {{ d.summary.earnings.changePercent > 0 ? '+' : '' }}{{ d.summary.earnings.changePercent }}%
              </span>
              <span>rispetto al periodo precedente ({{ money(d.summary.earnings.previousNetCents) }})</span>
            } @else {
              <span>Nessun incasso nel periodo precedente da confrontare</span>
            }
          </p>
          <p class="earn__note">Incassato {{ money(d.summary.earnings.grossCents) }} · servizio Odys stimato {{ money(d.summary.earnings.serviceCents) }} ({{ ratePercent() }}%). Prima dei costi del viaggio.</p>

          <div class="weeks">
            <p class="weeks__title">Prenotazioni confermate per settimana</p>
            <div class="bars" role="img" [attr.aria-label]="weeksLabel()">
              @for (week of d.summary.weeklyBookings; track week.weekStart; let last = $last) {
                <div class="bar" tabindex="0" [attr.aria-label]="'Settimana del ' + day(week.weekStart) + ': ' + week.count + ' prenotazioni'">
                  <span class="bar__tip">{{ week.count }} · sett. del {{ day(week.weekStart) }}</span>
                  <span class="bar__track">
                    <span class="bar__fill" [class.bar__fill--now]="last" [style.height.%]="barHeight(week.count)"></span>
                  </span>
                  @if (last || week.count === maxWeek()) {<span class="bar__value">{{ week.count }}</span>}
                </div>
              }
            </div>
            <div class="bars__axis" aria-hidden="true"><span>{{ day(d.summary.weeklyBookings[0].weekStart) }}</span><span>questa settimana</span></div>
          </div>
        </section>

        <!-- CP-02 Indicatori -->
        <div class="kpis">
          <div class="kpi"><span class="kpi__value">{{ d.summary.seats.sold }}<small>/{{ d.summary.seats.offered }}</small></span><span class="kpi__label">posti venduti</span></div>
          <div class="kpi"><span class="kpi__value">@if (d.kpis.rating) {{{ rating(d.kpis.rating) }}<small class="star">★</small>} @else {—}</span><span class="kpi__label">{{ d.kpis.reviewsCount }} {{ d.kpis.reviewsCount === 1 ? 'recensione' : 'recensioni' }}</span></div>
          <div class="kpi"><span class="kpi__value">{{ d.kpis.followers }}</span><span class="kpi__label">follower</span></div>
        </div>

        <!-- CP-03 Avvisi -->
        @if (d.balances.length || d.drafts.length) {
          <section class="card" aria-labelledby="alerts-title">
            <h2 id="alerts-title">Da fare</h2>
            <ul class="list">
              @for (item of d.balances; track item.requestId) {
                <li class="alert" [class.alert--late]="item.overdue">
                  <span class="alert__icon"><odys-icon name="credit-card" [size]="18" /></span>
                  <span class="alert__text">
                    <strong>Saldo di {{ item.name }}@if (item.amountDueCents !== undefined) { · {{ money(item.amountDueCents) }}}</strong>
                    <span>{{ item.tripTitle }} · @if (item.overdue) {<b>scaduto il {{ item.balanceDueDate | date: 'd MMM' }}</b>} @else if (item.balanceDueDate) {entro il {{ item.balanceDueDate | date: 'd MMM' }}} @else {prima della partenza}</span>
                    @if (item.remindedAt) {<span class="muted">Sollecitato il {{ item.remindedAt | date: 'd MMM, HH:mm' }}</span>}
                  </span>
                  <button type="button" class="remind" [disabled]="busy() === item.requestId || recently(item.remindedAt)" (click)="remind(item.tripId, item.requestId)">
                    {{ recently(item.remindedAt) ? 'Inviato' : 'Sollecita' }}
                  </button>
                </li>
              }
              @for (draft of d.drafts; track draft.tripId) {
                <li class="alert">
                  <span class="alert__icon"><odys-icon name="alert-triangle" [size]="18" /></span>
                  <span class="alert__text"><strong>{{ draft.title }}</strong><span>Bozza · {{ draft.missing }}</span></span>
                  <a class="remind" [routerLink]="['/coordinatore', draft.tripId]" [queryParams]="{ passo: 1 }">Completa</a>
                </li>
              }
            </ul>
          </section>
        }

        <!-- CP-04 Viaggi attivi -->
        <section class="card" aria-labelledby="trips-title">
          <h2 id="trips-title">Viaggi in vendita</h2>
          <ul class="list">
            @for (trip of d.summary.activeTrips; track trip.id) {
              <li>
                <a class="fill" [routerLink]="['/coordinatore', trip.id]">
                  <span class="fill__head">
                    <strong>{{ trip.title }}</strong>
                    @if (trip.soldOut) {<span class="sold-out">Tutto esaurito</span>} @else {<span class="muted">{{ trip.sold }}/{{ trip.capacity ?? '—' }}</span>}
                  </span>
                  <span class="seats" role="img" [attr.aria-label]="trip.sold + ' posti venduti su ' + (trip.capacity ?? 0)">
                    @for (seat of seatsOf(trip.capacity ?? 0, trip.sold); track $index) {<span class="seat" [class.is-sold]="seat" [class.is-full]="trip.soldOut"></span>}
                  </span>
                  <span class="muted small">{{ trip.destination }}@if (trip.startDate) { · parte il {{ trip.startDate | date: 'd MMM y' }}}</span>
                </a>
              </li>
            } @empty {
              <li class="muted">Nessun viaggio in vendita in questo momento.</li>
            }
          </ul>
        </section>

        <!-- CP-05 Funnel -->
        <section class="card" aria-labelledby="funnel-title">
          <h2 id="funnel-title">Dalle visite alle prenotazioni</h2>
          <ol class="funnel">
            @for (stage of d.summary.funnel; track stage.key; let first = $first) {
              <li>
                <span class="funnel__head">
                  <span>{{ stage.label }}</span>
                  <strong>{{ stage.count }}</strong>
                </span>
                <span class="funnel__track"><span class="funnel__fill" [style.width.%]="funnelWidth(stage.count)"></span></span>
                @if (!first) {<span class="funnel__rate">{{ stage.rate === null ? '—' : stage.rate + '% dalla fase prima' }}</span>}
              </li>
            }
          </ol>
          <p class="muted small">Visite al dettaglio dei viaggi (una al giorno per persona), salvataggi, acconti pagati e conferme: tutto registrato dal server.</p>
        </section>

        <!-- CP-06 Post che vendono -->
        <section class="card" aria-labelledby="posts-title">
          <h2 id="posts-title">Post che vendono</h2>
          @if (d.posts.length) {
            <div class="table-wrap">
              <table class="posts">
                <thead><tr><th scope="col">Post</th><th scope="col">Visite</th><th scope="col">Salvati</th><th scope="col">Prenot.</th></tr></thead>
                <tbody>
                  @for (post of d.posts; track post.postId) {
                    <tr [class.is-top]="post.bookings > 0 && post.bookings === topBookings()">
                      <th scope="row"><a [routerLink]="['/esplora', post.postId]">{{ post.caption || 'Post senza didascalia' }}</a></th>
                      <td>{{ post.views }}</td><td>{{ post.saves }}</td><td><strong>{{ post.bookings }}</strong></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="muted">Pubblica un post collegato a un viaggio: qui vedrai quante visite e prenotazioni porta.</p>
          }
          <p class="muted small">Una prenotazione confermata va al post collegato al viaggio che la persona ha visto per ultimo nei 30 giorni prima (regola provvisoria). Itinerari a pagamento: la vendita non è ancora attiva.</p>
        </section>
      } @else if (loading()) {
        <p class="muted">Carico i dati…</p>
      } @else if (!error()) {
        <odys-empty-state icon="chart-column" title="Nessun dato" description="Pubblica un viaggio: visite, salvataggi e prenotazioni compariranno qui." />
      }
    </div>
  `,
  styles: `
    .head { margin-bottom: var(--space-4); h1 { font-size: var(--text-3xl); } }
    .periods { display: flex; gap: var(--space-2); overflow-x: auto; margin: 0 calc(-1 * var(--layout-gutter, 16px)) var(--space-5); padding: 0 var(--layout-gutter, 16px) 2px; scrollbar-width: none; > * { flex-shrink: 0; } }
    odys-notice { display: block; margin-bottom: var(--space-4); }
    .earn { padding: var(--space-5); border-radius: var(--radius-xl, 28px); background: var(--color-brand-panel); color: var(--color-on-brand); }
    .earn__label { font-size: var(--text-sm); font-weight: 700; color: var(--color-on-brand-muted); }
    .earn__value { margin: 4px 0; font-family: var(--font-brand); font-weight: 900; font-size: clamp(2.25rem, 11vw, 3.5rem); line-height: 1; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
    .earn__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px var(--space-2); font-size: var(--text-sm); color: var(--color-on-brand-muted); }
    .delta { display: inline-flex; align-items: center; gap: 2px; padding: 2px 8px; border-radius: var(--radius-pill); background: var(--odys-lime); color: var(--odys-ink); font-weight: 800; }
    .delta--down { background: var(--odys-coral); }
    .earn__note { margin-top: var(--space-2); font-size: var(--text-xs); color: var(--color-on-brand-muted); }
    .weeks { margin-top: var(--space-5); padding-top: var(--space-4); border-top: 1px solid rgb(255 255 255 / 0.14); }
    .weeks__title { font-size: var(--text-sm); font-weight: 700; margin-bottom: var(--space-3); }
    .bars { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 6px; height: 120px; align-items: end; }
    .bar { position: relative; display: flex; flex-direction: column; justify-content: flex-end; height: 100%; outline: none; cursor: default;
      &:hover .bar__tip, &:focus-visible .bar__tip { opacity: 1; translate: -50% 0; }
      &:focus-visible .bar__track { outline: 2px solid var(--odys-lime); outline-offset: 2px; } }
    .bar__track { position: relative; display: flex; align-items: flex-end; height: calc(100% - 18px); border-bottom: 1px solid rgb(255 255 255 / 0.2); }
    .bar__fill { display: block; width: 100%; min-height: 2px; border-radius: 4px 4px 0 0; background: rgb(255 255 255 / 0.55); }
    .bar__fill--now { background: var(--odys-lime); }
    .bar__value { position: absolute; top: 0; left: 0; right: 0; text-align: center; font-size: var(--text-xs); font-weight: 800; font-variant-numeric: tabular-nums; }
    .bar__tip { position: absolute; bottom: calc(100% + 6px); left: 50%; z-index: 2; translate: -50% 4px; padding: 4px 8px; border-radius: var(--radius-md); background: var(--odys-cream, #f8f6f2); color: var(--odys-ink); font-size: var(--text-xs); font-weight: 700; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity var(--duration-fast), translate var(--duration-fast); }
    .bars__axis { display: flex; justify-content: space-between; margin-top: 6px; font-size: var(--text-xs); color: var(--color-on-brand-muted); }
    .kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); margin: var(--space-4) 0; }
    .kpi { display: flex; flex-direction: column; gap: 2px; padding: var(--space-4) var(--space-3); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); text-align: center; }
    .kpi__value { font-family: var(--font-brand); font-weight: 900; font-size: var(--text-2xl); font-variant-numeric: tabular-nums; small { font-size: 0.55em; color: var(--color-text-muted); } }
    .star { color: var(--odys-coral) !important; }
    .kpi__label { font-size: var(--text-xs); font-weight: 600; color: var(--color-text-muted); }
    .card { display: flex; flex-direction: column; gap: var(--space-3); margin-bottom: var(--space-4); padding: var(--space-5); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); h2 { font-size: var(--text-lg); } }
    .list { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .alert { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface-muted); }
    .alert--late { background: var(--color-danger-soft); }
    .alert__icon { display: grid; place-items: center; flex-shrink: 0; width: 36px; height: 36px; border-radius: 50%; background: var(--color-surface); }
    .alert__text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; font-size: var(--text-sm); b { color: var(--color-danger-text); } }
    .remind { flex-shrink: 0; min-height: 44px; padding: 0 var(--space-4); border: 0; border-radius: var(--radius-pill); background: var(--odys-ink); color: #fff; font: inherit; font-size: var(--text-sm); font-weight: 800; display: inline-flex; align-items: center; text-decoration: none; cursor: pointer;
      &:disabled { background: var(--color-surface); color: var(--color-text-muted); cursor: default; } }
    .fill { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface-muted); color: var(--color-text); text-decoration: none; }
    .fill__head { display: flex; justify-content: space-between; gap: var(--space-3); strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
    .sold-out { flex-shrink: 0; padding: 2px 10px; border-radius: var(--radius-pill); background: var(--odys-coral); color: var(--odys-ink); font-size: var(--text-xs); font-weight: 800; }
    .seats { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 3px; }
    .seat { height: 10px; border-radius: var(--radius-pill); background: var(--color-surface); box-shadow: inset 0 0 0 1px var(--color-border-strong); }
    .seat.is-sold { background: var(--odys-blue); box-shadow: none; }
    .seat.is-full { background: var(--odys-coral); }
    .funnel { display: flex; flex-direction: column; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
    .funnel__head { display: flex; justify-content: space-between; font-size: var(--text-sm); font-weight: 600; strong { font-variant-numeric: tabular-nums; } }
    .funnel__track { display: block; height: 12px; margin-top: 4px; border-radius: var(--radius-pill); background: var(--color-surface-muted); }
    .funnel__fill { display: block; height: 100%; min-width: 4px; border-radius: var(--radius-pill); background: var(--odys-blue); }
    .funnel__rate { display: block; margin-top: 2px; font-size: var(--text-xs); color: var(--color-text-muted); }
    .table-wrap { overflow-x: auto; }
    .posts { width: 100%; border-collapse: collapse; font-size: var(--text-sm);
      th, td { padding: var(--space-2); border-bottom: var(--border-width) solid var(--color-border); text-align: right; font-variant-numeric: tabular-nums; }
      th[scope='row'], thead th:first-child { text-align: left; }
      th[scope='row'] { max-width: 0; width: 60%; font-weight: 600; white-space: nowrap; a { display: inline-block; max-width: calc(100% - 1.4em); vertical-align: bottom; overflow: hidden; text-overflow: ellipsis; color: var(--color-text); } }
      thead th { font-size: var(--text-xs); color: var(--color-text-muted); font-weight: 700; }
      tr.is-top th[scope='row']::before { content: '★ '; color: var(--odys-coral); } }
    .muted { color: var(--color-text-muted); }
    .small { font-size: var(--text-xs); }
  `,
})
export default class CoordinatorDataPage {
  private readonly api = inject(CatalogApi);
  protected readonly periods = (Object.keys(DASHBOARD_PERIODS) as DashboardPeriodKey[]).map((key) => ({ key, label: DASHBOARD_PERIODS[key] }));
  protected readonly period = signal<DashboardPeriodKey>('month');
  protected readonly data = signal<CoordinatorDashboard | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly busy = signal('');

  protected readonly ratePercent = computed(() => Math.round((this.data()?.serviceRate ?? 0) * 100));
  protected readonly maxWeek = computed(() => Math.max(0, ...(this.data()?.summary.weeklyBookings.map((week) => week.count) ?? [0])));
  protected readonly maxFunnel = computed(() => Math.max(1, ...(this.data()?.summary.funnel.map((stage) => stage.count) ?? [1])));
  protected readonly topBookings = computed(() => Math.max(0, ...(this.data()?.posts.map((post) => post.bookings) ?? [0])));
  protected readonly weeksLabel = computed(() => 'Prenotazioni confermate nelle ultime 8 settimane: ' + (this.data()?.summary.weeklyBookings.map((week) => `${this.day(week.weekStart)} ${week.count}`).join(', ') ?? ''));

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
      const data = await this.api.dashboard(period);
      if (period === this.period()) this.data.set(data);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile leggere i dati.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected async remind(tripId: string, requestId: string): Promise<void> {
    this.busy.set(requestId);
    this.notice.set('');
    this.error.set('');
    try {
      const { remindedAt } = await this.api.remindBalance(tripId, requestId);
      this.data.update((data) => data ? { ...data, balances: data.balances.map((item) => (item.requestId === requestId ? { ...item, remindedAt } : item)) } : data);
      this.notice.set('Sollecito inviato: il viaggiatore lo vede in Prossimo viaggio.');
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Sollecito non inviato.'));
    } finally {
      this.busy.set('');
    }
  }

  protected recently(iso?: string): boolean {
    return Boolean(iso && Date.parse(iso) > Date.now() - 86_400_000);
  }

  protected barHeight(count: number): number {
    const max = this.maxWeek();
    return max ? (count / max) * 100 : 0;
  }

  protected funnelWidth(count: number): number {
    return (count / this.maxFunnel()) * 100;
  }

  protected seatsOf(capacity: number, sold: number): boolean[] {
    return Array.from({ length: capacity }, (_, index) => index < sold);
  }

  protected money(cents: number): string {
    return formatPrice(cents, 'EUR');
  }

  protected rating(value: number): string {
    return value.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  protected day(iso: string): string {
    return SHORT_DAY.format(new Date(`${iso}T00:00:00Z`));
  }
}
