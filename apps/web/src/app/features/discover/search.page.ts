import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TRIP_INTERESTS } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, type CatalogQuery, type PlaceSuggestion, type PublishedTripSummary } from '../../core/api/catalog.api';
import { AuthStore } from '../../core/auth/auth.store';
import { AccountStore } from '../../core/state/account.store';
import { PublishedTripCardComponent } from '../../shared/travel/published-trip-card.component';
import { ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';

const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const MONTH_NAMES = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const DURATIONS = [
  { id: 'weekend', label: 'Weekend', minDays: undefined, maxDays: 3 },
  { id: '3-5', label: '3-5 gg', minDays: 3, maxDays: 5 },
  { id: '7', label: '7 gg', minDays: 6, maxDays: 8 },
  { id: 'lungo', label: '>7 gg', minDays: 9, maxDays: undefined },
] as const;
const SORTS = [
  { id: 'affinita', label: 'Più affini', sort: 'affinity' },
  { id: 'data', label: 'Più vicini', sort: 'upcoming' },
  { id: 'prezzo', label: 'Prezzo più basso', sort: 'price' },
] as const;
/** Un parametro assente nell'indirizzo arriva come undefined. */
const text = (value: string | undefined): string => value ?? '';
const KIND_LABELS: Record<PlaceSuggestion['kind'], string> = { country: 'Paese', region: 'Regione', city: 'Città' };

/**
 * Risultati per intento (TB-02, TB-03): campo libero con suggerimenti di paese,
 * regione e città, filtri (interessi, mese, durata, budget, posti liberi),
 * ordinamento e «Chi cerca X guarda anche». Ricerca e filtri stanno
 * nell'indirizzo, così un risultato si può condividere e il tasto indietro funziona.
 */
@Component({
  selector: 'odys-search-page',
  imports: [FormsModule, RouterLink, PublishedTripCardComponent, ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page results">
      <div class="bar">
        <a routerLink="/" class="round" aria-label="Torna a Esplora"><odys-icon name="chevron-left" [size]="22" /></a>
        <form class="search" role="search" (submit)="$event.preventDefault(); apply({ q: draft().trim() || null })">
          <odys-icon name="search" [size]="20" />
          <label class="visually-hidden" for="results-search">Cerca una meta: paese, regione o città</label>
          <input id="results-search" type="search" name="q" autocomplete="off" placeholder="Paese, regione o città"
            role="combobox" aria-autocomplete="list" aria-controls="results-suggestions" [attr.aria-expanded]="suggestions().length > 0"
            [ngModel]="draft()" (ngModelChange)="onDraft($event)" (keydown.escape)="suggestions.set([])" (blur)="closeSuggestionsSoon()" />
          @if (draft()) {<button type="button" class="clear" aria-label="Cancella la ricerca" (click)="draft.set(''); apply({ q: null })"><odys-icon name="x" [size]="18" /></button>}
        </form>
        @if (suggestions().length) {
          <ul class="suggestions" id="results-suggestions" role="listbox" aria-label="Mete suggerite">
            @for (item of suggestions(); track item.kind + item.label) {
              <li role="option" [attr.aria-selected]="false">
                <button type="button" (mousedown)="$event.preventDefault()" (click)="pick(item)">
                  <odys-icon name="map-pin" [size]="18" />
                  <span><strong>{{ item.label }}</strong><span class="muted">{{ kindLabels[item.kind] }}@if (item.context) { · {{ item.context }}}</span></span>
                  <span class="meta-line">{{ item.trips }} {{ item.trips === 1 ? 'viaggio' : 'viaggi' }}</span>
                </button>
              </li>
            }
          </ul>
        }
      </div>

      <div class="chips">
        <button type="button" class="filter-toggle" [class.is-on]="activeFilters() > 0" [attr.aria-expanded]="filtersOpen()" aria-controls="results-filters" (click)="filtersOpen.set(!filtersOpen())">
          <odys-icon name="sliders" [size]="18" /> Filtri@if (activeFilters()) { · {{ activeFilters() }}}
        </button>
        <button odysChip [selected]="liberi() === '1'" (click)="apply({ liberi: liberi() === '1' ? null : '1' })">Partenze disponibili</button>
        @for (chip of activeChips(); track chip.label) {
          <button type="button" class="applied" (click)="apply(chip.remove)" [attr.aria-label]="'Togli il filtro ' + chip.label">{{ chip.label }} <odys-icon name="x" [size]="14" /></button>
        }
      </div>

      @if (filtersOpen()) {
        <section class="panel" id="results-filters" aria-label="Filtri">
          <fieldset>
            <legend>Interessi</legend>
            <div class="options">
              @for (item of interestOptions; track item) {
                <button odysChip [selected]="selectedInterests().includes(item)" (click)="toggleInterest(item)">{{ item }}</button>
              }
            </div>
          </fieldset>
          <fieldset>
            <legend>Mese di partenza</legend>
            <div class="options options--months">
              @for (month of months; track month; let index = $index) {
                <button odysChip [selected]="mese() === '' + (index + 1)" (click)="apply({ mese: mese() === '' + (index + 1) ? null : '' + (index + 1) })">{{ month }}</button>
              }
            </div>
          </fieldset>
          <fieldset>
            <legend>Durata</legend>
            <div class="options">
              @for (item of durations; track item.id) {
                <button odysChip [selected]="durata() === item.id" (click)="apply({ durata: durata() === item.id ? null : item.id })">{{ item.label }}</button>
              }
            </div>
          </fieldset>
          <div class="budget">
            <label for="results-budget">Budget a persona</label>
            <output for="results-budget" class="numeric">{{ budgetDraft() >= budgetMax ? 'Senza limite' : 'fino a €' + budgetDraft().toLocaleString('it-IT') }}</output>
            <input id="results-budget" type="range" min="200" [max]="budgetMax" step="50" [ngModel]="budgetDraft()" (ngModelChange)="budgetDraft.set(+$event)" (change)="apply({ budget: budgetDraft() >= budgetMax ? null : '' + budgetDraft() })" />
          </div>
          @if (activeFilters()) {<button type="button" class="reset" (click)="apply({ interessi: null, mese: null, durata: null, budget: null, liberi: null })">Azzera i filtri</button>}
        </section>
      }

      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}

      <div class="summary" aria-live="polite">
        <h1>
          @if (loading() && !trips().length) { Cerco i viaggi… }
          @else if (q()) { {{ trips().length }} {{ trips().length === 1 ? 'viaggio' : 'viaggi' }} per <span>{{ q() }}</span> }
          @else { {{ trips().length }} {{ trips().length === 1 ? 'viaggio in partenza' : 'viaggi in partenza' }} }
        </h1>
        <label class="sort">
          <span class="visually-hidden">Ordina per</span>
          <select [ngModel]="sortId()" (ngModelChange)="apply({ ordine: $event === defaultSort() ? null : $event })">
            @for (item of sorts; track item.id) {<option [value]="item.id">{{ item.label }}</option>}
          </select>
          <odys-icon name="arrow-down" [size]="16" />
        </label>
      </div>

      @if (loading() && !trips().length) {
        <div class="skeleton" aria-busy="true"></div>
      } @else if (trips().length) {
        <div class="list" [class.is-refreshing]="loading()">
          @for (trip of trips(); track trip.id; let first = $first) {
            <odys-published-trip-card [class.wide]="first" [size]="first ? 'lg' : 'sm'" [trip]="trip" [saved]="account.savedTrips().has(trip.id)" (toggleSave)="toggleSaved($event)" />
          }
        </div>
      } @else if (!error()) {
        <odys-empty-state icon="search" title="Nessun viaggio trovato"
          [description]="activeFilters() ? 'Nessuna partenza con questi filtri. Prova ad allargare la ricerca.' : 'Nessun viaggio corrisponde a «' + q() + '». Prova con un’altra meta.'"
          [actionLabel]="activeFilters() ? 'Azzera i filtri' : 'Vedi tutti i viaggi'" (action)="apply({ q: activeFilters() ? q() || null : null, interessi: null, mese: null, durata: null, budget: null, liberi: null })" />
      }

      @if (similar().length) {
        <section class="similar" aria-labelledby="similar-title">
          <h2 id="similar-title" class="meta-line">Chi cerca {{ q() }} guarda anche</h2>
          <div class="options">
            @for (item of similar(); track item.label) {
              <a class="place" routerLink="/cerca" [queryParams]="{ q: item.label }">{{ item.label }}</a>
            }
          </div>
        </section>
      }
    </div>
  `,
  styles: `
    .results { display: flex; flex-direction: column; gap: var(--space-4); max-width: 760px; }
    .bar { position: relative; display: flex; align-items: center; gap: var(--space-3); }
    .round { display: grid; place-items: center; flex-shrink: 0; width: 48px; height: 48px; border-radius: 50%; background: var(--color-surface); border: var(--border-width) solid var(--color-border); color: var(--color-text); }
    .search { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-2); min-height: 56px; padding: 0 var(--space-2) 0 var(--space-4); border-radius: var(--radius-pill); background: var(--color-surface); border: 2px solid var(--color-text); }
    .search input { flex: 1; min-width: 0; height: 44px; border: 0; outline: 0; background: transparent; color: var(--color-text); font-size: var(--text-lg); font-weight: 800; }
    .search input::placeholder { color: var(--color-text-muted); font-weight: 500; opacity: 1; }
    .search input::-webkit-search-cancel-button { display: none; }
    .clear { display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent; color: var(--color-text-muted); cursor: pointer; }
    .clear:hover { color: var(--color-text); background: var(--color-surface-muted); }

    .suggestions { position: absolute; z-index: 15; top: calc(100% + 8px); left: 60px; right: 0; margin: 0; padding: var(--space-2); list-style: none; border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); box-shadow: var(--shadow-lg); }
    .suggestions button { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--space-3); width: 100%; min-height: 52px; padding: var(--space-2) var(--space-3); border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-text); text-align: left; cursor: pointer; }
    .suggestions button:hover, .suggestions button:focus-visible { background: var(--color-surface-muted); }
    .suggestions button > span:nth-child(2) { display: flex; flex-direction: column; line-height: 1.3; min-width: 0; .muted { font-size: var(--text-sm); } }
    .suggestions .meta-line { color: var(--color-text-muted); white-space: nowrap; }

    .chips, .options { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .chips { flex-wrap: nowrap; overflow-x: auto; margin-inline: calc(-1 * var(--layout-gutter)); padding: 2px var(--layout-gutter); scrollbar-width: none; }
    .chips::-webkit-scrollbar { display: none; }
    .chips > * { flex-shrink: 0; }
    .filter-toggle, .applied { display: inline-flex; align-items: center; gap: var(--space-2); min-height: 44px; padding: 0 var(--space-4); border-radius: var(--radius-pill); font-weight: 800; font-size: var(--text-sm); cursor: pointer; white-space: nowrap; }
    .filter-toggle { border: 0; background: var(--color-nav); color: #fff; ::ng-deep svg { color: var(--odys-lime); } }
    .applied { border: var(--border-width) solid var(--odys-ink); background: var(--odys-lime); color: var(--odys-ink); }

    .panel { display: flex; flex-direction: column; gap: var(--space-5); padding: var(--space-5); border-radius: var(--radius-xl); background: var(--color-surface); border: var(--border-width) solid var(--color-border); }
    fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
    legend, .budget label { padding: 0; margin-bottom: var(--space-3); font-weight: 800; }
    .options--months { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); button { padding: 0; justify-content: center; } }
    .budget { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 0 var(--space-3);
      output { font-weight: 900; font-size: var(--text-lg); color: var(--color-link); }
      input { grid-column: 1 / -1; width: 100%; height: 44px; accent-color: var(--color-primary); } }
    .reset { align-self: flex-start; min-height: 44px; padding: 0; border: 0; background: transparent; color: var(--color-link); font-weight: 800; text-decoration: underline; cursor: pointer; }

    .summary { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; margin-top: var(--space-2);
      h1 { font-size: var(--text-2xl); span { color: var(--color-link); } } }
    .sort { position: relative; display: inline-flex; align-items: center; color: var(--color-text-muted);
      select { appearance: none; field-sizing: content; min-height: 44px; padding: 0 22px 0 0; border: 0; background: transparent; color: inherit; font-weight: 800; cursor: pointer; }
      odys-icon { position: absolute; right: 0; pointer-events: none; } }

    .list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); transition: opacity var(--duration-base) var(--ease-out); }
    .list.is-refreshing { opacity: 0.55; }
    .wide { grid-column: 1 / -1; }
    .wide ::ng-deep .card { min-height: 320px; }
    .skeleton { min-height: 320px; border-radius: var(--radius-xl); background: var(--color-surface-muted); animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: 0.55; } }

    .similar { margin-top: var(--space-4); h2 { color: var(--color-text-muted); font-weight: 500; margin-bottom: var(--space-3); } }
    .place { display: inline-flex; align-items: center; min-height: 44px; padding: 0 var(--space-5); border-radius: var(--radius-pill); background: var(--color-surface); border: var(--border-width) solid var(--color-border); color: var(--color-text); font-weight: 800; text-decoration: none; }
    .place:hover { border-color: var(--color-text); }

    @media (min-width: 900px) {
      .results { max-width: var(--layout-max); }
      .bar { max-width: 720px; }
      .list { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .wide { grid-column: span 2; grid-row: span 2; }
      .panel { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `,
})
export default class SearchPage {
  private readonly catalog = inject(CatalogApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  protected readonly account = inject(AccountStore);

  // Parametri dell'indirizzo (withComponentInputBinding).
  readonly q = input('', { transform: text });
  readonly interessi = input('', { transform: text });
  readonly mese = input('', { transform: text });
  readonly durata = input('', { transform: text });
  readonly budget = input('', { transform: text });
  readonly liberi = input('', { transform: text });
  readonly ordine = input('', { transform: text });

  protected readonly interestOptions = TRIP_INTERESTS;
  protected readonly months = MONTHS;
  protected readonly durations = DURATIONS;
  protected readonly sorts = SORTS;
  protected readonly kindLabels = KIND_LABELS;
  protected readonly budgetMax = 3000;

  protected readonly trips = signal<PublishedTripSummary[]>([]);
  protected readonly similar = signal<Array<{ label: string; trips: number }>>([]);
  protected readonly suggestions = signal<PlaceSuggestion[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly draft = signal('');
  protected readonly budgetDraft = signal(this.budgetMax);
  protected readonly filtersOpen = signal(false);
  private suggestTimer: ReturnType<typeof setTimeout> | undefined;
  private request = 0;

  protected readonly selectedInterests = computed(() => this.interessi().split(',').map((item) => item.trim()).filter(Boolean));
  /** Con l'accesso l'ordinamento predefinito è l'affinità, altrimenti la data. */
  protected readonly defaultSort = computed(() => (this.account.profile()?.interests.length ? 'affinita' : 'data'));
  protected readonly sortId = computed(() => SORTS.find((item) => item.id === this.ordine())?.id ?? this.defaultSort());
  protected readonly activeChips = computed(() => {
    const chips: Array<{ label: string; remove: Record<string, string | null> }> = [];
    for (const interest of this.selectedInterests()) chips.push({ label: interest, remove: { interessi: this.selectedInterests().filter((item) => item !== interest).join(',') || null } });
    const month = Number(this.mese());
    if (month >= 1 && month <= 12) chips.push({ label: `Partenza a ${MONTH_NAMES[month - 1]}`, remove: { mese: null } });
    const duration = DURATIONS.find((item) => item.id === this.durata());
    if (duration) chips.push({ label: duration.label, remove: { durata: null } });
    if (Number(this.budget()) > 0) chips.push({ label: `Fino a €${Number(this.budget()).toLocaleString('it-IT')}`, remove: { budget: null } });
    return chips;
  });
  protected readonly activeFilters = computed(() => this.activeChips().length + (this.liberi() === '1' ? 1 : 0));

  constructor() {
    effect(() => {
      const query = this.currentQuery();
      const q = this.q();
      untracked(() => {
        this.draft.set(q);
        this.budgetDraft.set(Number(this.budget()) > 0 ? Number(this.budget()) : this.budgetMax);
        void this.load(query, q);
      });
    });
  }

  private currentQuery(): CatalogQuery {
    const duration = DURATIONS.find((item) => item.id === this.durata());
    const month = Number(this.mese());
    const budget = Number(this.budget());
    return {
      q: this.q() || undefined,
      interests: this.selectedInterests(),
      month: month >= 1 && month <= 12 ? month : undefined,
      minDays: duration?.minDays,
      maxDays: duration?.maxDays,
      maxPrice: budget > 0 ? budget : undefined,
      onlyAvailable: this.liberi() === '1',
      sort: SORTS.find((item) => item.id === this.sortId())?.sort,
    };
  }

  private async load(query: CatalogQuery, q: string): Promise<void> {
    const request = ++this.request;
    this.loading.set(true);
    this.error.set('');
    this.suggestions.set([]);
    try {
      // Con l'accesso il server aggiunge l'affinità: prima si aspetta la sessione.
      await this.auth.start();
      const [trips, similar] = await Promise.all([this.catalog.list(query), q ? this.catalog.similar(q).catch(() => []) : Promise.resolve([])]);
      if (request !== this.request) return;
      this.trips.set(trips);
      this.similar.set(similar);
    } catch (error) {
      if (request !== this.request) return;
      this.trips.set([]);
      this.error.set(apiErrorMessage(error, 'Non è stato possibile caricare i viaggi.'));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }

  /** Aggiorna l'indirizzo: è lui la fonte di ricerca e filtri. */
  protected apply(changes: Record<string, string | null>): void {
    void this.router.navigate([], { queryParams: changes, queryParamsHandling: 'merge' });
  }

  protected onDraft(value: string): void {
    this.draft.set(value);
    clearTimeout(this.suggestTimer);
    if (value.trim().length < 2) { this.suggestions.set([]); return; }
    this.suggestTimer = setTimeout(async () => {
      const found = await this.catalog.suggest(value.trim()).catch(() => []);
      if (this.draft() === value) this.suggestions.set(found);
    }, 220);
  }

  protected pick(item: PlaceSuggestion): void {
    this.suggestions.set([]);
    this.apply({ q: item.label });
  }

  protected closeSuggestionsSoon(): void {
    setTimeout(() => this.suggestions.set([]), 150);
  }

  protected toggleInterest(item: string): void {
    const current = this.selectedInterests();
    const next = current.includes(item) ? current.filter((value) => value !== item) : [...current, item];
    this.apply({ interessi: next.join(',') || null });
  }

  protected async toggleSaved(id: string): Promise<void> {
    await this.account.toggleSavedTripWithLogin(id, this.router.url).catch((error) => this.error.set(apiErrorMessage(error, 'Non è stato possibile salvare il viaggio.')));
  }
}
