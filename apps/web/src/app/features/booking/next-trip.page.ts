import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, daysUntil, formatAmount, type Booking, type PublishedTripSummary } from '../../core/api/catalog.api';
import { ReviewCardComponent } from './review-card.component';
import { EntitlementsStore } from '../../core/state/entitlements.store';
import { EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';

interface Step { title: string; detail: string; state: 'done' | 'current' | 'todo' }

const LONG_DATE = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const SHORT_DATE = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const STATUS: Record<string, string> = { pending: 'Richiesta inviata', confirmed: 'Confermata', balance_paid: 'Saldata' };

/**
 * Prossimo viaggio (TB-10): conto alla rovescia, stato della prenotazione
 * (richiesta inviata → confermata dal coordinatore → saldo pagato), accesso
 * all'itinerario, promemoria e pagamento del saldo, invito al Premium.
 */
@Component({
  selector: 'odys-next-trip-page',
  imports: [DatePipe, RouterLink, EmptyStateComponent, IconComponent, NoticeComponent, ReviewCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page next">
      <h1>Prossimo viaggio</h1>
      @if (appena() === 'prenotato' && booking()) {<odys-notice tone="success" title="Acconto pagato">La tua richiesta è arrivata al coordinatore: di solito risponde entro 24 ore.</odys-notice>}
      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
      @if (thanks()) {<odys-notice tone="success">Grazie! La tua recensione è sul profilo del coordinatore.</odys-notice>}
      @for (trip of toReview(); track trip.id) {
        <odys-review-card [trip]="trip" (saved)="reviewed($event)" />
      }

      @if (loading()) {
        <div class="skeleton" aria-busy="true"></div>
      } @else if (booking(); as b) {
        <section class="hero">
          <p class="hero__top"><span class="badge"><odys-icon name="check" [size]="16" [strokeWidth]="2.6" /> {{ statusLabel() }}</span><span>{{ b.trip!.destination }} · con {{ b.trip!.coordinator.displayName }}</span></p>
          @if (days() !== undefined && days()! > 0) {
            <p class="count"><strong>{{ days() }}</strong><span>{{ days() === 1 ? 'giorno alla partenza' : 'giorni alla partenza' }}</span></p>
          } @else {
            <p class="count"><strong>{{ days() === 0 ? 'Oggi' : 'In corso' }}</strong><span>{{ days() === 0 ? 'si parte' : 'buon viaggio' }}</span></p>
          }
          <p class="meta-line">{{ b.trip!.destination }} · {{ startLabel() }}</p>
        </section>

        <section class="steps" aria-labelledby="steps-title">
          <h2 id="steps-title">Il tuo percorso</h2>
          <ol>
            @for (step of steps(); track step.title) {
              <li [class]="'step step--' + step.state">
                <span class="step__dot" aria-hidden="true">@if (step.state === 'done') {<odys-icon name="check" [size]="14" [strokeWidth]="3" />}</span>
                <span><strong>{{ step.title }}</strong><span class="step__detail">{{ step.detail }}</span></span>
              </li>
            }
          </ol>
          @if (b.status === 'confirmed' && b.balanceRemindedAt) {
            <p class="reminder" role="status"><odys-icon name="bell" [size]="16" /> Il coordinatore ti ricorda il saldo ({{ b.balanceRemindedAt | date: 'd MMM, HH:mm' }}).</p>
          }
          @if (b.status === 'confirmed') {
            <button type="button" class="pay" [disabled]="paying()" (click)="payBalance()">
              <odys-icon [name]="paying() ? 'loader' : 'lock'" [size]="18" [class.spin]="paying()" />
              {{ paying() ? 'Attendo la conferma…' : 'Paga il saldo · ' + money(balance()) }}
            </button>
            <p class="muted small">Pagamento di prova: nessun addebito reale.</p>
          }
        </section>

        <div class="tiles">
          <a class="tile tile--dark" [routerLink]="['/gruppi', b.tripId, 'giorno', 1]">
            <odys-icon name="list" [size]="24" />
            <strong>Itinerario</strong>
            <span>{{ b.trip!.durationDays ?? '—' }} giorni, ora per ora</span>
          </a>
          @if (entitlements.has('split.use') && b.status !== 'pending') {
            <a class="tile" routerLink="/split" [queryParams]="{ viaggio: b.tripId }">
              <odys-icon name="chart-pie" [size]="24" />
              <strong>Cassa comune</strong>
              <span>Dividi le spese</span>
            </a>
          } @else {
            <span class="tile" aria-disabled="true">
              <odys-icon name="message" [size]="24" />
              <strong>Chat del gruppo</strong>
              <span>In arrivo</span>
            </span>
          }
        </div>

        @if (!entitlements.has('ai.generate')) {
          <a class="premium" routerLink="/premium" [queryParams]="{ funzione: 'split.use' }">
            <odys-icon name="star" [size]="22" />
            <span><strong>Passa a Premium:</strong> dividi le spese con il gruppo e crea viaggi su misura con l’AI.</span>
            <odys-icon name="chevron-right" [size]="20" />
          </a>
        }

        @if (b.others) {<p class="muted small">Hai altre {{ b.others }} prenotazioni attive: le trovi nel tuo <a routerLink="/account" fragment="partecipazioni">account</a>.</p>}
      } @else if (!error() && !toReview().length) {
        <odys-empty-state icon="bag" title="Nessun viaggio prenotato" description="Quando blocchi un posto pagando l’acconto, il viaggio compare qui con il conto alla rovescia e i prossimi passi." actionLabel="Trova un viaggio" (action)="router.navigate(['/'])" />
      }
    </div>
  `,
  styles: `
    .reminder { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-3) 0 0; padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); background: var(--color-accent-soft); font-size: var(--text-sm); font-weight: 700; }
    .next { display: flex; flex-direction: column; gap: var(--space-5); max-width: 640px; }
    h1 { font-size: clamp(2.25rem, 1.5rem + 3vw, 3rem); }
    .skeleton { min-height: 280px; border-radius: var(--radius-xl); background: var(--color-surface-muted); }
    .hero { position: relative; isolation: isolate; overflow: hidden; display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5); border-radius: var(--radius-xl); background: var(--odys-blue); color: #fff; }
    .hero::before { content: ''; position: absolute; z-index: -1; right: -16%; top: -40%; width: 62%; aspect-ratio: 1; border-radius: 50%; border: 36px solid rgb(255 255 255 / 0.16); }
    .hero__top { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); font-weight: 700; color: #e3e8ff; }
    .badge { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 14px; border-radius: var(--radius-pill); background: var(--odys-lime); color: var(--odys-ink); font-weight: 900; }
    .count { display: flex; align-items: flex-end; gap: var(--space-3); line-height: 0.85;
      strong { font-size: clamp(5rem, 26vw, 8rem); font-weight: 900; letter-spacing: -0.05em; font-variant-numeric: tabular-nums; }
      span { max-width: 9ch; padding-bottom: var(--space-3); font-size: var(--text-lg); font-weight: 800; line-height: 1.15; } }
    .hero .meta-line { color: #e3e8ff; }
    .steps { padding: var(--space-5); border-radius: var(--radius-xl); background: var(--color-surface); border: var(--border-width) solid var(--color-border);
      h2 { font-size: var(--text-lg); margin-bottom: var(--space-4); }
      ol { list-style: none; margin: 0; padding: 0; } }
    .step { position: relative; display: grid; grid-template-columns: 32px 1fr; gap: var(--space-4); padding-bottom: var(--space-5);
      > span:last-child { display: flex; flex-direction: column; line-height: 1.3; strong { font-size: var(--text-lg); font-weight: 900; } } }
    .step:last-child { padding-bottom: 0; }
    .step:not(:last-child)::after { content: ''; position: absolute; left: 15px; top: 32px; bottom: 0; width: 2px; background: var(--color-border); }
    .step--done:not(:last-child)::after { background: var(--odys-ink); }
    .step__dot { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; border: 3px solid var(--color-border-strong); background: var(--color-surface); }
    .step--done .step__dot { border-color: var(--odys-ink); background: var(--odys-ink); color: var(--odys-lime); }
    .step--current .step__dot { border-color: var(--odys-blue); }
    .step__detail { color: var(--color-text-muted); }
    .step--current .step__detail { color: var(--color-link); font-weight: 700; }
    .pay { display: flex; align-items: center; justify-content: center; gap: var(--space-2); width: 100%; min-height: 56px; margin-top: var(--space-5); border: 0; border-radius: var(--radius-pill); background: var(--odys-ink); color: var(--odys-lime); font: inherit; font-weight: 900; font-size: var(--text-md); cursor: pointer;
      &[disabled] { opacity: 0.6; cursor: progress; } }
    :host-context([data-theme='dark']) .pay { background: var(--odys-lime); color: var(--odys-ink); }
    .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
    .tile { display: flex; flex-direction: column; gap: var(--space-1); min-height: 140px; padding: var(--space-5); border-radius: var(--radius-xl); background: var(--color-surface); border: var(--border-width) solid var(--color-border); color: var(--color-text); text-decoration: none;
      odys-icon { margin-bottom: auto; } strong { font-size: var(--text-lg); font-weight: 900; } span { color: var(--color-text-muted); } }
    .tile[aria-disabled='true'] { opacity: 0.7; }
    .tile--dark { background: var(--odys-ink); border-color: var(--odys-ink); color: #fff; odys-icon { color: var(--odys-lime); } span { color: #c9c7c0; } }
    .premium { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-5); border-radius: var(--radius-xl); background: var(--odys-lime); color: var(--odys-ink); text-decoration: none; line-height: 1.35; font-weight: 600;
      strong { font-weight: 900; } span { flex: 1; } }
    .small { font-size: var(--text-sm); }
    .spin { animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `,
})
export default class NextTripPage implements OnInit {
  private readonly catalog = inject(CatalogApi);
  protected readonly router = inject(Router);
  protected readonly entitlements = inject(EntitlementsStore);
  /** `?appena=prenotato` dopo il checkout. */
  readonly appena = input<string>();

  protected readonly booking = signal<Booking | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly paying = signal(false);
  /** Viaggi conclusi a cui si è partecipato e ancora senza recensione (TB-12). */
  protected readonly toReview = signal<PublishedTripSummary[]>([]);
  protected readonly thanks = signal(false);

  protected readonly statusLabel = computed(() => STATUS[this.booking()?.status ?? ''] ?? '');
  protected readonly days = computed(() => daysUntil(this.booking()?.trip?.startDate));
  protected readonly startLabel = computed(() => {
    const start = this.booking()?.trip?.startDate;
    return start ? SHORT_DATE.format(new Date(`${start}T00:00:00Z`)) : 'date da definire';
  });
  protected readonly balance = computed(() => {
    const b = this.booking();
    return b?.priceCents !== undefined && b.depositCents !== undefined ? b.priceCents - b.depositCents : undefined;
  });
  protected readonly steps = computed<Step[]>(() => {
    const b = this.booking();
    if (!b) return [];
    const deposit = b.payments.find((payment) => payment.kind === 'deposit' && payment.status === 'confirmed');
    const balance = b.payments.find((payment) => payment.kind === 'balance' && payment.status === 'confirmed');
    const when = (iso?: string) => (iso ? new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '');
    const due = b.balanceDueDate ? `Entro il ${LONG_DATE.format(new Date(`${b.balanceDueDate}T00:00:00Z`))}` : 'Prima della partenza';
    return [
      { title: `Acconto pagato · ${this.money(b.depositCents)}`, detail: when(deposit?.confirmedAt), state: 'done' },
      b.status === 'pending'
        ? { title: 'Conferma del coordinatore', detail: 'In attesa · di solito entro 24 h', state: 'current' }
        : { title: 'Confermata dal coordinatore', detail: when(b.decidedAt), state: 'done' },
      b.status === 'balance_paid'
        ? { title: `Saldo pagato · ${this.money(this.balance())}`, detail: when(balance?.confirmedAt), state: 'done' }
        : { title: `Saldo ${this.money(this.balance())}`, detail: due, state: b.status === 'confirmed' ? 'current' : 'todo' },
    ];
  });

  async ngOnInit(): Promise<void> {
    void this.loadReviews();
    try {
      this.booking.set(await this.catalog.nextTrip());
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile caricare il tuo prossimo viaggio.'));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadReviews(): Promise<void> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const done = (await this.catalog.myParticipations())
        .filter((item) => (item.status === 'confirmed' || item.status === 'balance_paid') && item.trip?.endDate && item.trip.endDate < today)
        .map((item) => item.trip!);
      const missing = await Promise.all(done.map(async (trip) => ((await this.catalog.myReview(trip.id).catch(() => null)) ? null : trip)));
      this.toReview.set(missing.filter((trip): trip is PublishedTripSummary => trip !== null));
    } catch {
      // Le recensioni sono un invito in più: senza risposta la pagina resta utilizzabile.
    }
  }

  protected reviewed(tripId: string): void {
    this.toReview.update((list) => list.filter((trip) => trip.id !== tripId));
    this.thanks.set(true);
  }

  protected money(cents: number | undefined): string {
    return formatAmount(cents, this.booking()?.currency);
  }

  /** Saldo (TB-10): come l'acconto, conta solo la conferma del fornitore. */
  protected async payBalance(): Promise<void> {
    const booking = this.booking();
    if (!booking) return;
    this.paying.set(true);
    this.error.set('');
    try {
      await this.catalog.pay(booking.id, 'balance');
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const current = await this.catalog.nextTrip();
        if (current?.status === 'balance_paid' || current?.id !== booking.id) { this.booking.set(current); return; }
      }
      this.error.set('La conferma del saldo sta richiedendo più del previsto: ricarica la pagina tra poco.');
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Pagamento non riuscito. Nessun importo è stato addebitato.'));
    } finally {
      this.paying.set(false);
    }
  }
}
