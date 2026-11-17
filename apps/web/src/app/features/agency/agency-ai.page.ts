import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { agencyCan } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { AgencyApi, type AgencyAiGeneration, type MyAgency } from '../../core/api/agency.api';
import { formatPrice } from '../../core/api/catalog.api';
import { ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';

/**
 * AI per i coordinatori (AG-06): l'agenzia offre il generatore ai coordinatori
 * del team, con i fornitori convenzionati da usare per primi e un margine minimo
 * sotto il quale la pubblicazione richiede l'approvazione. Storico con stato.
 */
@Component({
  selector: 'odys-agency-ai-page',
  imports: [DatePipe, FormsModule, RouterLink, ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="head">
        <p class="eyebrow">{{ mine()?.agency?.displayName ?? 'Agenzia' }}</p>
        <h1>AI per i coordinatori</h1>
      </header>

      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
      @if (message()) {<odys-notice tone="success">{{ message() }}</odys-notice>}

      @if (loading()) {
        <p class="muted">Carico…</p>
      } @else if (!mine() || !can('team.view')) {
        <odys-empty-state icon="sparkles" title="Non disponibile" description="L’AI dell’agenzia la gestiscono proprietario, amministratori e operatori." />
      } @else {
        <form class="card" (submit)="$event.preventDefault(); save()" novalidate>
          <div class="row">
            <div>
              <h2>Generatore per il team</h2>
              <p class="muted">I coordinatori del team generano itinerari con l’AI dell’agenzia, dentro le vostre regole.</p>
            </div>
            <label class="switch">
              <input type="checkbox" role="switch" name="enabled" [ngModel]="enabled()" (ngModelChange)="enabled.set($event)" [disabled]="!canEdit()" />
              <span>{{ enabled() ? 'Attiva' : 'Spenta' }}</span>
            </label>
          </div>
          <label class="field-label">Margine minimo senza approvazione (%)
            <input class="field narrow" type="number" inputmode="numeric" min="0" max="90" name="min" placeholder="Es. 30" [ngModel]="minMargin()" (ngModelChange)="minMargin.set($event)" [disabled]="!canEdit()" />
          </label>
          <p class="hint">Sotto questo margine (quota meno servizio Odys e costi a testa, sulla quota) un viaggio generato si pubblica solo dopo la vostra approvazione. Vuoto: nessun limite.</p>
          <div>
            <p class="field-label">Fornitori convenzionati, da usare per primi</p>
            <ul class="chips">
              @for (item of suppliers(); track item) {
                <li>{{ item }}@if (canEdit()) {<button type="button" (click)="removeSupplier(item)" [attr.aria-label]="'Togli ' + item"><odys-icon name="x" [size]="14" /></button>}</li>
              } @empty {<li class="muted">Nessun fornitore indicato.</li>}
            </ul>
            @if (canEdit()) {
              <div class="add">
                <input class="field" name="supplier" maxlength="80" placeholder="Es. Masseria Lupo" [ngModel]="supplier()" (ngModelChange)="supplier.set($event)" (keydown.enter)="$event.preventDefault(); addSupplier()" />
                <button odysButton type="button" variant="secondary" size="sm" icon="plus" (click)="addSupplier()">Aggiungi</button>
              </div>
            }
            <p class="hint">Finiscono nelle indicazioni dell’itinerario generato. Il motore locale di Odys non prenota dai fornitori: li segnala al coordinatore.</p>
          </div>
          @if (canEdit()) {<button odysButton type="submit" variant="accent" icon="check" [loading]="busy() === 'save'">Salva le regole</button>}
        </form>

        <section class="card" aria-labelledby="history-title">
          <h2 id="history-title">Storico delle generazioni · {{ generations().length }}</h2>
          <ul class="history">
            @for (item of generations(); track item.id) {
              <li class="gen">
                <div class="gen__main">
                  <strong>{{ item.title }}</strong>
                  <span class="muted">{{ item.coordinatorName ?? 'Coordinatore' }} · {{ item.createdAt | date: 'd MMM y, HH:mm' }} · {{ item.days }} giorni@if (item.totalCents) { · stima {{ money(item.totalCents) }}}@if (item.budgetCents) { su {{ money(item.budgetCents) }} a persona}</span>
                  <span class="tags">
                    <span class="tag" [class.tag--wait]="item.status === 'to_review'" [class.tag--ok]="item.status === 'approved'">{{ item.status === 'to_review' ? 'Da revisionare' : 'Approvata' }}</span>
                    @if (item.publishedTripId) {<a class="tag tag--link" [routerLink]="['/coordinatore', item.publishedTripId]">Convertita in viaggio<odys-icon name="chevron-right" [size]="12" /></a>}
                  </span>
                </div>
                @if (item.status === 'to_review' && canEdit()) {
                  <button odysButton type="button" variant="secondary" size="sm" icon="check" [loading]="busy() === item.id" (click)="review(item)">Approva</button>
                }
              </li>
            } @empty {
              <li class="muted">Ancora nessuna generazione: compariranno qui quando i coordinatori useranno l’AI dell’agenzia.</li>
            }
          </ul>
        </section>
      }
    </div>
  `,
  styles: `
    .head { margin-bottom: var(--space-5); h1 { font-size: var(--text-3xl); } }
    odys-notice { display: block; margin-bottom: var(--space-4); }
    .card { display: flex; flex-direction: column; gap: var(--space-3); max-width: 760px; margin-bottom: var(--space-4); padding: var(--space-5); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); h2 { font-size: var(--text-lg); } > button { align-self: flex-start; } }
    .row { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
    .switch { display: inline-flex; align-items: center; gap: var(--space-2); min-height: 44px; font-size: var(--text-sm); font-weight: 800; cursor: pointer; flex-shrink: 0;
      input { appearance: none; position: relative; width: 44px; height: 26px; margin: 0; border-radius: var(--radius-pill); background: var(--color-border-strong); cursor: pointer; transition: background-color var(--duration-fast);
        &::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: translate var(--duration-fast) var(--ease-out); }
        &:checked { background: var(--odys-blue); &::after { translate: 18px 0; } }
        &:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px; } } }
    .field-label { display: flex; flex-direction: column; gap: 4px; font-size: var(--text-sm); font-weight: 600; }
    .field { min-height: 44px; padding: 0 var(--space-3); border-radius: var(--radius-md); border: var(--border-width) solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); font: inherit; font-weight: 400; min-width: 0; }
    .narrow { width: 120px; }
    .chips { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-2) 0; padding: 0; list-style: none;
      li:not(.muted) { display: inline-flex; align-items: center; gap: 4px; padding: 4px 6px 4px 12px; border-radius: var(--radius-pill); background: var(--color-primary-soft); color: var(--color-link); font-size: var(--text-sm); font-weight: 700; }
      button { display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; } }
    .add { display: flex; gap: var(--space-2); .field { flex: 1; } }
    .history { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .gen { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface-muted); }
    .gen__main { display: flex; flex-direction: column; gap: 4px; flex: 1 1 220px; min-width: 0; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .tag { display: inline-flex; align-items: center; gap: 2px; padding: 2px 10px; border-radius: var(--radius-pill); background: var(--color-surface); font-size: var(--text-xs); font-weight: 800; text-decoration: none; color: var(--color-text); }
    .tag--wait { background: var(--color-accent-soft); }
    .tag--ok { background: var(--odys-blue); color: #fff; }
    .tag--link { color: var(--color-link); }
    .hint, .muted { font-size: var(--text-sm); color: var(--color-text-muted); }
  `,
})
export default class AgencyAiPage implements OnInit {
  private readonly api = inject(AgencyApi);
  protected readonly mine = signal<MyAgency | null>(null);
  protected readonly generations = signal<AgencyAiGeneration[]>([]);
  protected readonly enabled = signal(false);
  protected readonly minMargin = signal<string | number>('');
  protected readonly suppliers = signal<string[]>([]);
  protected readonly supplier = signal('');
  protected readonly loading = signal(true);
  protected readonly busy = signal('');
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly canEdit = computed(() => agencyCan(this.mine()?.role, 'profile.edit'));

  async ngOnInit(): Promise<void> {
    try {
      const mine = await this.api.mine();
      this.mine.set(mine);
      if (mine && agencyCan(mine.role, 'team.view')) await this.reload();
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private async reload(): Promise<void> {
    const mine = this.mine();
    if (!mine) return;
    const result = await this.api.ai(mine.agency.id);
    this.enabled.set(result.settings.enabled);
    this.minMargin.set(result.settings.minMarginPercent ?? '');
    this.suppliers.set(result.settings.suppliers);
    this.generations.set(result.generations);
  }

  protected can(action: Parameters<typeof agencyCan>[1]): boolean {
    return agencyCan(this.mine()?.role, action);
  }

  protected addSupplier(): void {
    const name = this.supplier().trim();
    if (!name || this.suppliers().includes(name) || this.suppliers().length >= 20) return;
    this.suppliers.update((list) => [...list, name]);
    this.supplier.set('');
  }

  protected removeSupplier(name: string): void {
    this.suppliers.update((list) => list.filter((item) => item !== name));
  }

  protected async save(): Promise<void> {
    const mine = this.mine();
    if (!mine) return;
    const raw = String(this.minMargin()).trim();
    await this.run('save', async () => {
      await this.api.setAi(mine.agency.id, { enabled: this.enabled(), minMarginPercent: raw === '' ? null : Number(raw), suppliers: this.suppliers() });
      await this.reload();
      return this.enabled() ? 'Regole salvate: i coordinatori del team trovano l’AI dell’agenzia nel generatore.' : 'Regole salvate: l’AI dell’agenzia è spenta.';
    });
  }

  protected async review(item: AgencyAiGeneration): Promise<void> {
    await this.run(item.id, async () => {
      await this.api.reviewGeneration(item.id);
      await this.reload();
      return `«${item.title}» approvata: si può pubblicare anche sotto il margine minimo.`;
    });
  }

  protected money(cents: number): string {
    return formatPrice(cents, 'EUR');
  }

  private async run(key: string, action: () => Promise<string>): Promise<void> {
    this.busy.set(key);
    this.error.set('');
    this.message.set('');
    try {
      this.message.set(await action());
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.busy.set('');
    }
  }
}
