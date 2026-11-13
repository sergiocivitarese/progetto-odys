import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SPLIT_CATEGORY_LABELS, type SplitCategory, type SplitExpense } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { formatAmount } from '../../core/api/catalog.api';
import { SplitApi, type SplitGroup, type SplitView } from '../../core/api/split.api';
import { AuthStore } from '../../core/auth/auth.store';
import { EmptyStateComponent, IconComponent, NoticeComponent, type IconName } from '../../shared/ui';

const COLORS: Partial<Record<SplitCategory, string>> = { food: 'var(--odys-lime)', transport: 'var(--odys-blue)', activities: 'var(--odys-coral)', lodging: '#b7a6ff', other: '#9a988f' };
const ICONS: Record<SplitCategory, IconName> = { food: 'star', transport: 'bus', activities: 'compass', lodging: 'home', other: 'list', settlement: 'refresh' };
const ADDABLE: SplitCategory[] = ['food', 'transport', 'activities', 'lodging', 'other'];

/**
 * Cassa comune (TP-09): speso dal gruppo, la tua quota, grafico per categoria,
 * «Devi a» / «Ti devono» con «Salda ora», saldo semplificato e ultime spese.
 * Calcoli e quote arrivano dal server.
 */
@Component({
  selector: 'odys-split-page',
  imports: [FormsModule, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page split">
      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}

      @if (loading()) {
        <div class="skeleton" aria-busy="true"></div>
      } @else if (!groups().length) {
        <h1>Cassa comune</h1>
        <odys-empty-state icon="chart-pie" title="Nessun gruppo di viaggio" description="La cassa comune si apre quando il tuo posto in un viaggio di gruppo è confermato: lì dividi le spese con gli altri partecipanti." actionLabel="Trova un viaggio" (action)="router.navigate(['/'])" />
      } @else if (view(); as v) {
        <header class="head">
          <div>
            <p class="meta-line kicker">{{ v.trip?.destination || current()?.destination }} <span class="premium-badge"><odys-icon name="star" [size]="12" /> Premium</span></p>
            <h1>Cassa comune</h1>
          </div>
          <span class="faces" [attr.aria-label]="v.members.length + ' persone nel gruppo'">
            @for (member of v.members.slice(0, 2); track member.userId) {<span class="face" [class.face--blue]="$first">{{ member.initials }}</span>}
            @if (v.members.length > 2) {<span class="face face--more">+{{ v.members.length - 2 }}</span>}
          </span>
        </header>

        @if (groups().length > 1) {
          <label class="group-pick">
            <span class="visually-hidden">Viaggio</span>
            <select [ngModel]="current()?.tripId" (ngModelChange)="open($event)">
              @for (group of groups(); track group.tripId) {<option [value]="group.tripId">{{ group.title }}</option>}
            </select>
          </label>
        }

        <section class="board">
          <div class="board__top">
            <div>
              <p class="muted-inverse">Speso dal gruppo</p>
              <p class="total"><strong>{{ euros(v.summary.totalCents) }}</strong><span>{{ cents(v.summary.totalCents) }}</span></p>
              <p class="muted-inverse">La tua quota <strong>{{ money(v.summary.myShareCents) }}</strong></p>
            </div>
            @if (v.summary.categories.length) {
              <svg class="donut" viewBox="0 0 42 42" role="img" [attr.aria-label]="donutLabel()">
                @for (slice of slices(); track slice.category) {
                  <circle cx="21" cy="21" r="15.9" fill="none" [attr.stroke]="slice.color" stroke-width="6" [attr.stroke-dasharray]="slice.dash" [attr.stroke-dashoffset]="slice.offset" />
                }
              </svg>
            }
          </div>
          @if (v.summary.categories.length) {
            <ul class="legend">
              @for (item of v.summary.categories; track item.category) {
                <li><span class="dot" [style.background]="color(item.category)"></span>{{ label(item.category) }} {{ item.percent }}%</li>
              }
            </ul>
          }
          @for (debt of myDebts(); track debt.to) {
            <div class="owe">
              <p><span>Devi a {{ name(debt.to) }}</span><strong>{{ money(debt.amountCents) }}</strong></p>
              <button type="button" [disabled]="busy()" (click)="settle(debt.to, debt.amountCents)">Salda ora</button>
            </div>
          }
          @for (credit of myCredits(); track credit.from) {
            <div class="owe owe--in"><p><span>{{ name(credit.from) }} ti deve</span><strong>{{ money(credit.amountCents) }}</strong></p></div>
          }
          @if (!myDebts().length && !myCredits().length && v.expenses.length) {
            <p class="even"><odys-icon name="check" [size]="18" /> Sei in pari con il gruppo.</p>
          }
        </section>

        @if (v.summary.transfers.length) {
          <p class="settle-tip">
            <span class="settle-tip__ring" aria-hidden="true"></span>
            <span><strong>Saldo semplificato:</strong> {{ v.summary.transfers.length === 1 ? 'basta un pagamento' : 'bastano ' + v.summary.transfers.length + ' pagamenti' }}@if (v.summary.naiveTransfers > v.summary.transfers.length) { invece di {{ v.summary.naiveTransfers }}} per chiudere tutti i conti.</span>
          </p>
        }

        <section aria-labelledby="latest-title">
          <h2 id="latest-title">Ultime spese</h2>
          <ul class="expenses">
            @for (expense of v.expenses; track expense.id) {
              <li class="expense" [class.expense--settlement]="expense.category === 'settlement'">
                <span class="expense__icon" [style.--tint]="color(expense.category)"><odys-icon [name]="icon(expense.category)" [size]="20" /></span>
                <span class="expense__text">
                  <strong>{{ expense.category === 'settlement' ? name(expense.paidBy) + ' ha rimborsato ' + name(expense.shares[0].userId) : expense.description }}</strong>
                  <span>Pagato da {{ expense.paidBy === me() ? 'te' : name(expense.paidBy) }}@if (expense.category !== 'settlement') { · diviso in {{ expense.shares.length }}}</span>
                </span>
                <span class="expense__amounts">
                  <strong>{{ money(expense.amountCents) }}</strong>
                  @if (impact(expense); as delta) {<span [class.plus]="delta > 0" [class.minus]="delta < 0">{{ delta > 0 ? '+' : '−' }}{{ money(abs(delta)) }}</span>}
                </span>
                @if (expense.paidBy === me()) {
                  <button type="button" class="remove" [attr.aria-label]="'Elimina ' + expense.description" (click)="remove(expense)"><odys-icon name="trash" [size]="16" /></button>
                }
              </li>
            } @empty {
              <li class="muted">Nessuna spesa per ora: aggiungi la prima.</li>
            }
          </ul>
        </section>

        @if (adding()) {
          <form class="sheet" (submit)="$event.preventDefault(); add()" aria-labelledby="new-expense-title">
            <h2 id="new-expense-title">Nuova spesa</h2>
            <label>Descrizione<input name="description" maxlength="120" required [ngModel]="description()" (ngModelChange)="description.set($event)" placeholder="Es. Cena da Lucia" /></label>
            <label>Importo (€)<input name="amount" inputmode="decimal" required [ngModel]="amount()" (ngModelChange)="amount.set($event)" placeholder="Es. 216,00" /></label>
            <fieldset><legend>Categoria</legend>
              <div class="chips">
                @for (item of categories; track item) {
                  <button type="button" class="chip" [class.is-on]="category() === item" [attr.aria-pressed]="category() === item" (click)="category.set(item)">{{ label(item) }}</button>
                }
              </div>
            </fieldset>
            <label>Ha pagato
              <select name="paidBy" [ngModel]="paidBy()" (ngModelChange)="paidBy.set($event)">
                @for (member of v.members; track member.userId) {<option [value]="member.userId">{{ member.userId === me() ? 'Io' : member.displayName }}</option>}
              </select>
            </label>
            <fieldset><legend>Dividi tra</legend>
              <div class="chips">
                @for (member of v.members; track member.userId) {
                  <button type="button" class="chip" [class.is-on]="among().includes(member.userId)" [attr.aria-pressed]="among().includes(member.userId)" (click)="toggleAmong(member.userId)">{{ member.userId === me() ? 'Io' : member.displayName }}</button>
                }
              </div>
            </fieldset>
            <div class="sheet__actions">
              <button type="button" class="ghost" (click)="adding.set(false)">Annulla</button>
              <button type="submit" class="primary" [disabled]="busy() || !description().trim() || !amount() || !among().length">Aggiungi</button>
            </div>
          </form>
        } @else {
          <button type="button" class="fab" (click)="startAdding()"><odys-icon name="plus" [size]="20" [strokeWidth]="2.6" /> Spesa</button>
        }
      }
    </div>
  `,
  styleUrl: './split.page.scss',
})
export default class SplitPage {
  private readonly api = inject(SplitApi);
  private readonly auth = inject(AuthStore);
  protected readonly router = inject(Router);
  /** `?viaggio=` sceglie la cassa da aprire. */
  readonly viaggio = input<string>();

  protected readonly groups = signal<SplitGroup[]>([]);
  protected readonly view = signal<SplitView | null>(null);
  protected readonly current = signal<SplitGroup | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly adding = signal(false);
  protected readonly description = signal('');
  protected readonly amount = signal('');
  protected readonly category = signal<SplitCategory>('food');
  protected readonly paidBy = signal('');
  protected readonly among = signal<string[]>([]);
  protected readonly categories = ADDABLE;
  protected readonly me = computed(() => this.auth.user()?.id ?? '');

  protected readonly myDebts = computed(() => this.view()?.summary.transfers.filter((t) => t.from === this.me()) ?? []);
  protected readonly myCredits = computed(() => this.view()?.summary.transfers.filter((t) => t.to === this.me()) ?? []);
  /** Spicchi della ciambella (circonferenza 100 con r = 15.9). */
  protected readonly slices = computed(() => {
    let start = 0;
    return (this.view()?.summary.categories ?? []).map((item) => {
      const slice = { category: item.category, color: COLORS[item.category] ?? '#9a988f', dash: `${Math.max(item.percent - 1.5, 0.5)} ${100 - Math.max(item.percent - 1.5, 0.5)}`, offset: String(25 - start) };
      start += item.percent;
      return slice;
    });
  });
  protected readonly donutLabel = computed(() => (this.view()?.summary.categories ?? []).map((item) => `${this.label(item.category)} ${item.percent}%`).join(', '));

  constructor() {
    effect(() => {
      const wanted = this.viaggio();
      untracked(() => void this.load(wanted));
    });
  }

  private async load(wanted?: string): Promise<void> {
    this.loading.set(true);
    try {
      await this.auth.start();
      const groups = await this.api.groups();
      this.groups.set(groups);
      const group = groups.find((item) => item.tripId === wanted) ?? groups[0];
      if (group) await this.show(group);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Cassa comune non disponibile.'));
    } finally {
      this.loading.set(false);
    }
  }

  private async show(group: SplitGroup): Promise<void> {
    this.current.set(group);
    this.view.set(await this.api.view(group.tripId));
  }

  protected open(tripId: string): void {
    void this.router.navigate([], { queryParams: { viaggio: tripId } });
  }

  protected money(cents: number): string { return formatAmount(cents); }
  protected euros(cents: number): string { return `€${Math.floor(cents / 100).toLocaleString('it-IT')}`; }
  protected cents(cents: number): string { return `,${String(cents % 100).padStart(2, '0')}`; }
  protected abs(value: number): number { return Math.abs(value); }
  protected label(category: SplitCategory): string { return SPLIT_CATEGORY_LABELS[category]; }
  protected color(category: SplitCategory): string { return COLORS[category] ?? 'var(--color-surface-muted)'; }
  protected icon(category: SplitCategory): IconName { return ICONS[category]; }
  protected name(userId: string): string {
    if (userId === this.me()) return 'te';
    return this.view()?.members.find((member) => member.userId === userId)?.displayName ?? 'un ex membro';
  }

  /** Effetto della spesa sul mio saldo: + se ho anticipato per altri, − se devo la mia quota. */
  protected impact(expense: SplitExpense): number {
    const mine = expense.shares.find((share) => share.userId === this.me())?.amountCents ?? 0;
    return (expense.paidBy === this.me() ? expense.amountCents : 0) - mine;
  }

  protected startAdding(): void {
    this.description.set('');
    this.amount.set('');
    this.category.set('food');
    this.paidBy.set(this.me());
    this.among.set(this.view()?.members.map((member) => member.userId) ?? []);
    this.adding.set(true);
  }

  protected toggleAmong(userId: string): void {
    this.among.update((list) => (list.includes(userId) ? list.filter((id) => id !== userId) : [...list, userId]));
  }

  protected async add(): Promise<void> {
    const group = this.current();
    if (!group) return;
    await this.run(async () => {
      this.view.set(await this.api.add(group.tripId, { description: this.description().trim(), category: this.category(), amount: Number(this.amount().replace(',', '.')), paidBy: this.paidBy(), among: this.among() }));
      this.adding.set(false);
    });
  }

  protected async settle(to: string, amountCents: number): Promise<void> {
    const group = this.current();
    if (!group || !confirm(`Registri di aver restituito ${this.money(amountCents)} a ${this.name(to)}? Il pagamento lo fate fuori da Odys.`)) return;
    await this.run(async () => this.view.set(await this.api.settle(group.tripId, to, amountCents / 100)));
  }

  protected async remove(expense: SplitExpense): Promise<void> {
    const group = this.current();
    if (!group || !confirm(`Eliminare «${expense.description}»?`)) return;
    await this.run(async () => {
      await this.api.remove(expense.id);
      this.view.set(await this.api.view(group.tripId));
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await action();
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Operazione non riuscita.'));
    } finally {
      this.busy.set(false);
    }
  }
}
