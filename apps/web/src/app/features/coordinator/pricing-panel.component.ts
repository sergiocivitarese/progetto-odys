import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { COST_CATEGORIES, COST_CATEGORY_LABELS, SERVICE_RATE, suggestedPriceCents, summarizePricing, type CostBasis, type CostCategory, type CostItem } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, formatPrice } from '../../core/api/catalog.api';
import { ButtonComponent, IconComponent, NoticeComponent } from '../../shared/ui';

/** Voce in modifica: l'importo resta testo finché non si salva. */
interface DraftCost { id: string; label: string; category: CostCategory; basis: CostBasis; amount: string }

function euros(value: string): number | undefined {
  const clean = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!clean) return undefined;
  const number = Number(clean);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : undefined;
}

/**
 * Composizione del prezzo (CB-04): voci di costo, servizio Odys, punto di
 * pareggio e guadagno a viaggio pieno. I conti si aggiornano mentre si scrive,
 * con la quota e i posti indicati nell'editor; le voci le vede solo il coordinatore.
 */
@Component({
  selector: 'odys-pricing-panel',
  imports: [FormsModule, ButtonComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" aria-labelledby="pricing-title">
      <div>
        <h2 id="pricing-title">Costi e guadagno</h2>
        <p class="hint">Solo tu vedi queste cifre. Indica quanto spendi per ogni partecipante e quanto per tutto il gruppo: Odys calcola da quanti iscritti il viaggio si ripaga.</p>
      </div>
      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}

      <div class="costs">
        @for (cost of costs(); track cost.id; let i = $index) {
          <div class="cost">
            <input class="field cost__label" [name]="'label-' + cost.id" maxlength="80" placeholder="Es. Hotel 4 notti" [attr.aria-label]="'Voce di costo ' + (i + 1)"
              [ngModel]="cost.label" (ngModelChange)="edit(cost.id, { label: $event })" />
            <select class="field" [name]="'cat-' + cost.id" [attr.aria-label]="'Categoria della voce ' + (i + 1)" [ngModel]="cost.category" (ngModelChange)="edit(cost.id, { category: $event })">
              @for (category of categories; track category) {<option [value]="category">{{ categoryLabels[category] }}</option>}
            </select>
            <select class="field" [name]="'basis-' + cost.id" [attr.aria-label]="'Come si paga la voce ' + (i + 1)" [ngModel]="cost.basis" (ngModelChange)="edit(cost.id, { basis: $event })">
              <option value="per_person">a testa</option>
              <option value="group">gruppo</option>
            </select>
            <span class="money">
              <input class="field" [name]="'amount-' + cost.id" inputmode="decimal" placeholder="0" [attr.aria-label]="'Importo in euro della voce ' + (i + 1)"
                [ngModel]="cost.amount" (ngModelChange)="edit(cost.id, { amount: $event })" />
              <span aria-hidden="true">€</span>
            </span>
            <button type="button" class="remove" (click)="remove(cost.id)" [attr.aria-label]="'Togli la voce ' + (cost.label || i + 1)"><odys-icon name="trash" [size]="18" /></button>
          </div>
        } @empty {
          <p class="hint empty">Nessuna voce ancora. Parti dall’alloggio e dai trasporti; ricorda anche le tue spese di viaggio, come voce per il gruppo.</p>
        }
        <button odysButton type="button" variant="secondary" size="sm" icon="plus" (click)="add()">Aggiungi una voce</button>
      </div>

      <label class="target">
        <span class="label">Compenso che vorresti a viaggio pieno (facoltativo)</span>
        <span class="money">
          <input class="field" name="target" inputmode="decimal" placeholder="Es. 1200" [ngModel]="target()" (ngModelChange)="target.set($event); dirty.set(true)" />
          <span aria-hidden="true">€</span>
        </span>
      </label>
      @if (suggested(); as price) {
        <div class="suggest">
          <p>Per guadagnare {{ money(targetCents()) }} con {{ capacityNumber() }} partecipanti la quota dovrebbe essere <strong>{{ money(price) }}</strong>.</p>
          @if (price !== priceCents()) {
            <button odysButton type="button" variant="secondary" size="sm" icon="check" (click)="usePrice.emit(price / 100)">Usa questa quota</button>
          }
        </div>
      }

      <dl class="sum">
        <div><dt>Costi per partecipante</dt><dd>{{ money(summary().perPersonCostsCents) }}</dd></div>
        <div><dt>Costi del gruppo</dt><dd>{{ money(summary().groupCostsCents) }}</dd></div>
        <div><dt>Servizio Odys ({{ ratePercent }}%, stima)</dt><dd>{{ priceCents() === undefined ? '—' : money(summary().serviceFeeCents) + ' a persona' }}</dd></div>
        <div><dt>Ti restano per partecipante</dt><dd [class.neg]="(summary().marginPerParticipantCents ?? 0) < 0">{{ summary().marginPerParticipantCents === null ? '—' : money(summary().marginPerParticipantCents!) }}</dd></div>
      </dl>

      <div class="kpis">
        <div class="kpi" [class.kpi--warn]="priceCents() !== undefined && !summary().breakEvenReachable">
          <span class="kpi__label">Punto di pareggio</span>
          <strong class="kpi__value">{{ breakEvenText() }}</strong>
          <span class="kpi__note">{{ breakEvenNote() }}</span>
        </div>
        <div class="kpi kpi--dark">
          <span class="kpi__label">Guadagno a viaggio pieno</span>
          <strong class="kpi__value" [class.neg]="(summary().earningsAtFullCents ?? 0) < 0">{{ summary().earningsAtFullCents === null ? '—' : money(summary().earningsAtFullCents!) }}</strong>
          <span class="kpi__note">{{ capacityNumber() ? capacityNumber() + ' partecipanti su ' + capacityNumber() : 'Indica i posti disponibili' }}</span>
        </div>
      </div>
      @if (seats().length) {
        <div class="seats" role="img" [attr.aria-label]="'Servono ' + summary().breakEven + ' partecipanti su ' + capacityNumber() + ' per coprire i costi'">
          @for (seat of seats(); track $index) {<span class="seat" [class.seat--cover]="seat"></span>}
        </div>
      }
      <p class="hint">Il servizio Odys è una stima provvisoria compresa nella quota: la commissione definitiva non è ancora decisa.</p>
    </section>
  `,
  styles: `
    :host { display: block; }
    .card { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); h2 { font-size: var(--text-lg); } }
    .hint { font-size: var(--text-sm); color: var(--color-text-muted); }
    .label { font-size: var(--text-sm); font-weight: 600; }
    .field { width: 100%; min-height: 44px; padding: 0 var(--space-3); border-radius: var(--radius-md); border: var(--border-width) solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); font: inherit; min-width: 0; }
    .costs { display: flex; flex-direction: column; gap: var(--space-3); > button { align-self: flex-start; } }
    .cost { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 44px; gap: var(--space-2); padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface-muted); }
    .cost__label { grid-column: 1 / -1; }
    .cost .money { grid-column: 1 / 3; }
    .remove { grid-row: 3; grid-column: 3; display: grid; place-items: center; min-height: 44px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-text-muted); cursor: pointer; &:hover { color: var(--color-danger-text); background: var(--color-danger-soft); } }
    .money { position: relative; display: block; input { padding-right: 32px; text-align: right; font-variant-numeric: tabular-nums; } span { position: absolute; right: 12px; top: 50%; translate: 0 -50%; color: var(--color-text-muted); font-weight: 600; } }
    .empty { padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface-muted); }
    .target { display: flex; flex-direction: column; gap: var(--space-1); max-width: 320px; }
    .suggest { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); background: var(--color-primary-soft); font-size: var(--text-sm); }
    .sum { display: grid; gap: var(--space-1); margin: 0; div { display: flex; justify-content: space-between; gap: var(--space-3); padding: 6px 0; border-bottom: var(--border-width) solid var(--color-border); font-size: var(--text-sm); }
      dt { color: var(--color-text-muted); } dd { margin: 0; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; } }
    .neg { color: var(--color-danger-text); }
    .kpis { display: grid; gap: var(--space-3); grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .kpi { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: var(--space-4); border-radius: var(--radius-lg); background: var(--color-accent-soft); color: var(--color-text); }
    .kpi--warn { background: var(--color-danger-soft); }
    .kpi--dark { background: var(--color-brand-panel); color: var(--color-on-brand); .kpi__note, .kpi__label { color: var(--color-on-brand-muted); } .neg { color: var(--odys-coral, #ff6b57); } }
    .kpi__label { font-size: var(--text-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted); }
    .kpi__value { font-family: var(--font-brand); font-size: clamp(1.25rem, 5.5vw, 1.75rem); overflow-wrap: anywhere; font-weight: 900; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .kpi__note { font-size: var(--text-xs); color: var(--color-text-muted); }
    .seats { display: grid; grid-template-columns: repeat(12, 1fr); gap: 4px; }
    .seat { height: 10px; border-radius: var(--radius-pill); background: var(--color-accent); }
    .seat--cover { background: var(--color-text); }
    @media (min-width: 640px) {
      .cost { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 44px; align-items: center; }
      .cost__label, .cost .money { grid-column: auto; }
      .remove { grid-row: auto; grid-column: auto; }
    }
  `,
})
export class PricingPanelComponent {
  private readonly api = inject(CatalogApi);

  readonly tripId = input.required<string>();
  /** Quota a persona in euro, come scritta nell'editor. */
  readonly price = input('');
  readonly capacity = input('');
  readonly currency = input('EUR');
  /** Il coordinatore sceglie la quota consigliata (in euro). */
  readonly usePrice = output<number>();

  protected readonly categories = COST_CATEGORIES;
  protected readonly categoryLabels = COST_CATEGORY_LABELS;
  protected readonly costs = signal<DraftCost[]>([]);
  protected readonly target = signal('');
  protected readonly error = signal('');
  readonly dirty = signal(false);
  private serviceRate = SERVICE_RATE;
  protected ratePercent = Math.round(SERVICE_RATE * 100);

  protected readonly priceCents = computed(() => euros(this.price()));
  protected readonly capacityNumber = computed(() => { const n = Number(this.capacity()); return Number.isInteger(n) && n > 0 ? n : undefined; });
  protected readonly targetCents = computed(() => euros(this.target()) ?? 0);
  private readonly items = computed<CostItem[]>(() => this.costs()
    .map((cost) => ({ id: cost.id, label: cost.label.trim(), category: cost.category, basis: cost.basis, amountCents: euros(cost.amount) ?? 0 })));
  protected readonly summary = computed(() => summarizePricing({ priceCents: this.priceCents(), capacity: this.capacityNumber(), costs: this.items(), serviceRate: this.serviceRate }));
  protected readonly suggested = computed(() => this.targetCents() > 0 ? suggestedPriceCents({ capacity: this.capacityNumber(), costs: this.items(), targetEarningsCents: this.targetCents(), serviceRate: this.serviceRate }) : null);
  protected readonly breakEvenText = computed(() => {
    const s = this.summary();
    if (this.priceCents() === undefined) return '—';
    if (s.breakEven === null) return 'Mai';
    return s.breakEven === 1 ? '1 partecipante' : `${s.breakEven} partecipanti`;
  });
  protected readonly breakEvenNote = computed(() => {
    const s = this.summary();
    const capacity = this.capacityNumber();
    if (this.priceCents() === undefined) return 'Indica la quota a persona';
    if (s.breakEven === null) return 'La quota non copre i costi a persona e il servizio';
    if (!capacity) return 'Indica i posti disponibili';
    return s.breakEvenReachable ? `su ${capacity} posti: da lì in poi guadagni` : `Oltre i ${capacity} posti: alza la quota o riduci i costi`;
  });
  /** Barra a 12 segmenti: scuri i posti che servono a coprire i costi. */
  protected readonly seats = computed(() => {
    const capacity = this.capacityNumber();
    const breakEven = this.summary().breakEven;
    if (!capacity || breakEven === null || !this.summary().breakEvenReachable) return [];
    return Array.from({ length: capacity }, (_, index) => index < breakEven);
  });

  constructor() {
    effect(() => {
      const id = this.tripId();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    try {
      const pricing = await this.api.pricing(id);
      this.serviceRate = pricing.serviceRate;
      this.ratePercent = Math.round(pricing.serviceRate * 100);
      this.costs.set(pricing.costs.map((cost) => ({ ...cost, amount: String(cost.amountCents / 100).replace('.', ',') })));
      this.target.set(pricing.targetEarningsCents !== null ? String(pricing.targetEarningsCents / 100) : '');
      this.dirty.set(false);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile leggere i costi del viaggio.'));
    }
  }

  protected add(): void {
    this.costs.update((list) => [...list, { id: `cost-${Date.now().toString(36)}`, label: '', category: list.length ? 'attivita' : 'alloggi', basis: 'per_person', amount: '' }]);
    this.dirty.set(true);
  }

  protected remove(id: string): void {
    this.costs.update((list) => list.filter((cost) => cost.id !== id));
    this.dirty.set(true);
  }

  protected edit(id: string, change: Partial<DraftCost>): void {
    this.costs.update((list) => list.map((cost) => (cost.id === id ? { ...cost, ...change } : cost)));
    this.dirty.set(true);
  }

  /** Salva le voci (le righe vuote si scartano). Lancia un errore leggibile se qualcosa non va. */
  async save(): Promise<void> {
    if (!this.dirty()) return;
    const filled = this.costs().filter((cost) => cost.label.trim() || cost.amount.trim());
    for (const cost of filled) {
      if (!cost.label.trim()) throw new Error('Dai un nome a ogni voce di costo.');
      if (euros(cost.amount) === undefined) throw new Error(`Indica l’importo di «${cost.label.trim()}».`);
    }
    const target = euros(this.target());
    if (this.target().trim() && target === undefined) throw new Error('Il compenso desiderato non è un importo valido.');
    const saved = await this.api.savePricing(this.tripId(), { costs: this.items().filter((item) => filled.some((cost) => cost.id === item.id)), targetEarningsCents: target ?? null });
    this.costs.set(saved.costs.map((cost) => ({ ...cost, amount: String(cost.amountCents / 100).replace('.', ',') })));
    this.dirty.set(false);
    this.error.set('');
  }

  protected money(cents: number): string {
    return formatPrice(cents, this.currency());
  }
}
