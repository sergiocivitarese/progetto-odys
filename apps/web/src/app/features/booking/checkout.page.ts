import { OrganizerBadgeComponent } from '../../shared/travel/organizer-badge.component';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, formatAmount, formatDateRange, type Booking, type Payment } from '../../core/api/catalog.api';
import { toneOf } from '../../shared/travel/published-trip-card.component';
import { EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';

/**
 * Checkout dell'acconto (TB-09): riepilogo, saldo e scadenza, acconto ora,
 * metodo di pagamento, condizioni e posto riservato con timer. Il pagamento
 * è concluso solo quando il server riceve la conferma del fornitore.
 */
@Component({
  selector: 'odys-checkout-page',
  imports: [FormsModule, RouterLink, EmptyStateComponent, IconComponent, NoticeComponent, OrganizerBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page checkout">
      @if (loading()) {
        <p class="muted"><odys-icon name="loader" /> Caricamento…</p>
      } @else if (!booking() || !booking()!.trip) {
        <odys-empty-state icon="compass" title="Prenotazione non trovata" [description]="error() || 'Riprova dalla pagina del viaggio.'" />
      } @else if (booking(); as b) {
        <div class="top">
          <a class="round" [routerLink]="['/gruppi', b.tripId]" aria-label="Torna al viaggio"><odys-icon name="chevron-left" [size]="22" /></a>
          @if (b.status === 'reserved') {
            <span class="timer" [class.timer--expired]="expired()" role="timer" aria-live="off">
              <odys-icon name="timer" [size]="18" /> {{ expired() ? 'Riserva scaduta' : 'Posto riservato per ' + countdown() }}
            </span>
          }
        </div>

        <header>
          <p class="meta-line kicker">Ultimo passo</p>
          <h1>Blocca il tuo posto</h1>
        </header>

        <div class="summary">
          <span class="summary__cover" [class]="'summary__cover tone-' + tone()"><span>{{ b.trip!.destination }}</span></span>
          <span class="summary__text">
            <strong>{{ b.trip!.title }}</strong>
            <span>{{ dates() }} · {{ b.trip!.durationDays }} giorni</span>
            @if (b.seatNumber && b.trip!.capacity) {<span class="seat">Posto {{ b.seatNumber }} di {{ b.trip!.capacity }}</span>}
          </span>
        </div>

        <dl class="bill">
          <div><dt>Prezzo viaggio</dt><dd>{{ money(b.priceCents) }}</dd></div>
          <div><dt>Saldo {{ dueLabel() }}</dt><dd>{{ money(balance()) }}</dd></div>
          <div class="bill__now"><dt>Acconto da pagare ora</dt><dd>{{ money(b.depositCents) }}</dd></div>
        </dl>

        @if (b.status === 'reserved' && !expired()) {
          <fieldset class="methods" [disabled]="paying()">
            <legend class="visually-hidden">Metodo di pagamento</legend>
            <label class="method" [class.is-on]="method() === 'card'">
              <input type="radio" name="method" value="card" [ngModel]="method()" (ngModelChange)="method.set($event)" />
              <span>Carta di credito</span><span class="meta-line muted">Prova</span>
            </label>
            <label class="method" [class.is-on]="method() === 'wallet'">
              <input type="radio" name="method" value="wallet" [ngModel]="method()" (ngModelChange)="method.set($event)" />
              <span>Wallet del telefono</span><span class="meta-line muted">Prova</span>
            </label>
          </fieldset>

          @if (b.trip?.organizerAgency; as agency) {
            <div class="agency">
              <odys-organizer-badge [agency]="agency" />
              @if (agency.saleTerms) {
                <details>
                  <summary>Condizioni di vendita di {{ agency.name }}</summary>
                  <p class="agency__terms">{{ agency.saleTerms }}</p>
                </details>
              }
            </div>
          }
          <label class="terms">
            <input type="checkbox" [ngModel]="terms()" (ngModelChange)="terms.set($event)" name="terms" [disabled]="paying()" />
            <span>Accetto le <a routerLink="/termini" target="_blank">condizioni di partecipazione</a>@if (b.trip?.organizerAgency; as agency) {, le condizioni di vendita di {{ agency.name }}} e la politica di cancellazione del viaggio.</span>
          </label>

          <odys-notice tone="info">Pagamento di prova: nessun addebito reale. Il fornitore dei pagamenti verrà collegato quando sarà scelto.</odys-notice>
        }

        @if (expired() && b.status === 'reserved') {
          <odys-notice tone="warning" title="Il posto non è più riservato">Sono passati 15 minuti: il posto è tornato disponibile per tutti. Puoi riprovare dalla pagina del viaggio.</odys-notice>
        }
        @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}

        <div class="pay">
          @if (b.status === 'reserved' && !expired()) {
            <button type="button" class="pay__button" [disabled]="!terms() || paying()" (click)="pay()">
              <odys-icon [name]="paying() ? 'loader' : 'lock'" [size]="20" [class.spin]="paying()" />
              {{ paying() ? 'Attendo la conferma del pagamento…' : 'Paga ' + money(b.depositCents) + ' e parti' }}
            </button>
            <p class="muted small">Pagamento protetto · rimborso secondo la politica del viaggio</p>
          } @else if (expired()) {
            <a class="pay__button" [routerLink]="['/gruppi', b.tripId]">Torna al viaggio</a>
          } @else {
            <a class="pay__button" routerLink="/prossimo-viaggio">Vai al tuo prossimo viaggio</a>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .checkout { display: flex; flex-direction: column; gap: var(--space-5); max-width: 560px; padding-bottom: calc(var(--space-16) + 120px); }
    .top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
    .round { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; background: var(--color-surface); border: var(--border-width) solid var(--color-border); color: var(--color-text); }
    .timer { display: inline-flex; align-items: center; gap: var(--space-2); min-height: 44px; padding: 0 var(--space-4); border-radius: var(--radius-pill); background: var(--color-danger-soft); color: var(--color-text); font-weight: 800; font-variant-numeric: tabular-nums; }
    .timer--expired { background: var(--color-surface-muted); color: var(--color-text-muted); }
    .kicker { color: var(--color-link); font-weight: 700; }
    h1 { font-size: clamp(2rem, 1.4rem + 3vw, 2.75rem); }
    .agency { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border);
      summary { cursor: pointer; font-size: var(--text-sm); font-weight: 700; min-height: 32px; } }
    .agency__terms { margin-top: var(--space-2); font-size: var(--text-sm); color: var(--color-text-muted); white-space: pre-line; }
    .summary { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-3); border-radius: var(--radius-xl); background: var(--color-surface); border: var(--border-width) solid var(--color-border); }
    .summary__cover { display: flex; align-items: flex-end; flex-shrink: 0; width: 96px; height: 96px; padding: var(--space-2); border-radius: var(--radius-lg); background: var(--odys-blue); color: #fff; overflow: hidden;
      span { font-weight: 900; font-size: var(--text-sm); text-transform: uppercase; letter-spacing: -0.02em; line-height: 1; overflow-wrap: anywhere; } }
    .summary__cover.tone-coral { background: var(--odys-coral); color: var(--odys-ink); }
    .summary__cover.tone-lime { background: var(--odys-lime); color: var(--odys-ink); }
    .summary__cover.tone-ink { background: var(--odys-ink); color: var(--odys-lime); }
    .summary__text { display: flex; flex-direction: column; min-width: 0; line-height: 1.35;
      strong { font-size: var(--text-lg); font-weight: 900; } span { color: var(--color-text-muted); } .seat { color: var(--color-link); font-weight: 800; } }
    .bill { margin: 0; padding: var(--space-5); border-radius: var(--radius-xl); background: var(--odys-ink); color: #d6d4cd;
      div { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); padding: var(--space-2) 0; }
      dd { margin: 0; color: #fff; font-weight: 800; font-variant-numeric: tabular-nums; } }
    .bill__now { margin-top: var(--space-2); padding-top: var(--space-4) !important; border-top: 1px solid #33332f; dt { color: #fff; font-weight: 800; } dd { color: var(--odys-lime); font-size: clamp(2rem, 8vw, 2.75rem); font-weight: 900; } }
    .methods { margin: 0; padding: 0; border: 0; display: flex; flex-direction: column; gap: var(--space-3); }
    .method { display: flex; align-items: center; gap: var(--space-3); min-height: 64px; padding: 0 var(--space-5); border-radius: var(--radius-xl); background: var(--color-surface); border: 2px solid var(--color-border); font-weight: 800; cursor: pointer;
      input { width: 22px; height: 22px; accent-color: var(--odys-blue); margin: 0; } span:nth-of-type(1) { flex: 1; } }
    .method.is-on { border-color: var(--odys-blue); }
    .terms { display: flex; gap: var(--space-3); align-items: flex-start; font-size: var(--text-md); line-height: 1.45; cursor: pointer;
      input { flex-shrink: 0; width: 24px; height: 24px; margin: 0; accent-color: var(--odys-ink); } }
    .pay { position: fixed; z-index: 21; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; gap: var(--space-2);
      padding: var(--space-4) var(--layout-gutter) calc(var(--space-4) + env(safe-area-inset-bottom)); background: var(--color-bg); border-top: var(--border-width) solid var(--color-border); }
    .pay__button { display: flex; align-items: center; justify-content: center; gap: var(--space-3); width: 100%; max-width: 560px; min-height: 60px; border: 0; border-radius: var(--radius-pill); background: var(--odys-lime); color: var(--odys-ink); font: inherit; font-weight: 900; font-size: var(--text-lg); text-decoration: none; cursor: pointer;
      &[disabled] { background: var(--color-surface-muted); color: var(--color-text-muted); cursor: not-allowed; } }
    .small { font-size: var(--text-sm); }
    .spin { animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (min-width: 900px) { .pay { position: static; padding: 0; border: 0; background: transparent; align-items: stretch; } .checkout { padding-bottom: var(--space-16); } }
  `,
  host: { class: 'checkout-host' },
})
export default class CheckoutPage {
  private readonly catalog = inject(CatalogApi);
  private readonly router = inject(Router);

  readonly id = input.required<string>();
  protected readonly booking = signal<Booking | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly paying = signal(false);
  protected readonly terms = signal(false);
  protected readonly method = signal<Payment['method']>('card');
  private readonly now = signal(Date.now());

  protected readonly tone = computed(() => toneOf(this.booking()?.tripId ?? ''));
  protected readonly dates = computed(() => formatDateRange(this.booking()?.trip?.startDate, this.booking()?.trip?.endDate, true));
  protected readonly balance = computed(() => {
    const b = this.booking();
    return b?.priceCents !== undefined && b.depositCents !== undefined ? b.priceCents - b.depositCents : undefined;
  });
  protected readonly dueLabel = computed(() => {
    const due = this.booking()?.balanceDueDate;
    return due ? `entro il ${new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${due}T00:00:00Z`))}` : 'prima della partenza';
  });
  private readonly remainingMs = computed(() => {
    const until = this.booking()?.reservedUntil;
    return until ? Date.parse(until) - this.now() : 0;
  });
  protected readonly expired = computed(() => this.booking()?.status === 'reserved' && this.remainingMs() <= 0);
  protected readonly countdown = computed(() => {
    const seconds = Math.max(0, Math.floor(this.remainingMs() / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      this.booking.set(await this.catalog.booking(id));
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Prenotazione non trovata.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected money(cents: number | undefined): string {
    return formatAmount(cents, this.booking()?.currency);
  }

  /** Avvia l'acconto e aspetta la conferma del fornitore, letta dal server. */
  protected async pay(): Promise<void> {
    const booking = this.booking();
    if (!booking) return;
    this.paying.set(true);
    this.error.set('');
    try {
      await this.catalog.pay(booking.id, 'deposit', this.method(), true);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const current = await this.catalog.booking(booking.id);
        this.booking.set(current);
        if (current.status !== 'reserved') {
          await this.router.navigate(['/prossimo-viaggio'], { queryParams: { appena: 'prenotato' } });
          return;
        }
      }
      this.error.set('La conferma del pagamento sta richiedendo più del previsto. Controlla tra poco in Prossimo viaggio: non ti verrà addebitato due volte.');
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Pagamento non riuscito. Nessun importo è stato addebitato.'));
    } finally {
      this.paying.set(false);
    }
  }
}
