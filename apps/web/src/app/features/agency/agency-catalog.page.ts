import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { agencyCan } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { AgencyApi, type AgencyMember, type AgencyProposal, type CatalogTrip, type MyAgency } from '../../core/api/agency.api';
import { formatPrice, PUBLISHED_STATUS_LABELS } from '../../core/api/catalog.api';
import { ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';

interface Series { id: string; title: string; destination: string; departures: CatalogTrip[]; missing: number }

/**
 * Catalogo dell'agenzia (AG-03, AG-04, AG-11): viaggi con le loro partenze,
 * ciascuna con il suo coordinatore e i suoi posti; avviso per le partenze
 * senza coordinatore; copertura «ombrello» sui viaggi dei coordinatori del team.
 */
@Component({
  selector: 'odys-agency-catalog-page',
  imports: [DatePipe, FormsModule, RouterLink, ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="head">
        <div>
          <p class="eyebrow">{{ mine()?.agency?.displayName ?? 'Agenzia' }}</p>
          <h1>Catalogo</h1>
        </div>
        @if (mine(); as m) {
          <a odysButton variant="accent" icon="plus" routerLink="/coordinatore/nuovo" [queryParams]="{ agenzia: m.agency.id }">Nuovo viaggio</a>
        }
      </header>

      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
      @if (message()) {<odys-notice tone="success">{{ message() }}</odys-notice>}

      @if (loading()) {
        <p class="muted">Carico…</p>
      } @else if (!mine() || !can('team.view')) {
        <odys-empty-state icon="box" title="Catalogo non disponibile" description="Il catalogo lo gestiscono proprietario, amministratori e operatori dell’agenzia." />
      } @else {
        @if (proposals().length) {
          <section class="card proposals" aria-labelledby="prop-title">
            <h2 id="prop-title">Proposte da approvare · {{ proposals().length }}</h2>
            <p class="muted">Viaggi dei coordinatori coperti dall’agenzia. Approvare li pubblica a nome dell’agenzia.</p>
            @for (item of proposals(); track item.trip.id) {
              <article class="prop">
                <div class="prop__head">
                  <strong>{{ item.trip.title }}</strong>
                  <span class="muted">{{ item.trip.coordinator.displayName }}@if (item.trip.coordinator.rating) { · ★ {{ rating(item.trip.coordinator.rating) }} ({{ item.trip.coordinator.reviewsCount ?? 0 }})} · {{ item.trip.startDate ? (item.trip.startDate | date: 'd MMM y') : 'date da definire' }}</span>
                </div>
                <dl class="econ">
                  <div><dt>Quota</dt><dd>{{ item.trip.priceCents !== undefined ? money(item.trip.priceCents) : '—' }}</dd></div>
                  <div><dt>Margine a testa</dt><dd [class.neg]="(item.economics.marginPerParticipantCents ?? 0) < 0">{{ item.economics.marginPerParticipantCents === null ? '—' : money(item.economics.marginPerParticipantCents) }}@if (item.economics.marginPercent !== null) {<small> · {{ item.economics.marginPercent }}%</small>}</dd></div>
                  <div><dt>Pareggio</dt><dd [class.neg]="!item.economics.breakEvenReachable">{{ item.economics.breakEven === null ? 'mai' : item.economics.breakEven + ' su ' + (item.trip.capacity ?? '—') }}</dd></div>
                  <div><dt>A viaggio pieno</dt><dd>{{ item.economics.earningsAtFullCents === null ? '—' : money(item.economics.earningsAtFullCents) }}</dd></div>
                </dl>
                @if (!item.economics.hasCosts) {<p class="muted small">Il coordinatore non ha indicato i costi: margine e pareggio contano solo il servizio Odys.</p>}
                @if (rejecting() === item.trip.id) {
                  <label class="field-label">Cosa va cambiato
                    <textarea class="field area" rows="3" maxlength="600" [name]="'note-' + item.trip.id" [ngModel]="note()" (ngModelChange)="note.set($event)" placeholder="Es. alza la quota: con questi costi il pareggio è troppo alto."></textarea>
                  </label>
                }
                <div class="prop__actions">
                  <a class="open" [routerLink]="['/coordinatore', item.trip.id]">Apri<odys-icon name="chevron-right" [size]="16" /></a>
                  <span class="grow"></span>
                  @if (rejecting() === item.trip.id) {
                    <button odysButton type="button" variant="ghost" size="sm" (click)="rejecting.set('')">Annulla</button>
                    <button odysButton type="button" variant="secondary" size="sm" [loading]="busy() === item.trip.id" (click)="decide(item, false)">Invia la richiesta</button>
                  } @else {
                    <button odysButton type="button" variant="ghost" size="sm" (click)="rejecting.set(item.trip.id); note.set('')">Chiedi modifiche</button>
                    <button odysButton type="button" variant="accent" size="sm" icon="check" [loading]="busy() === item.trip.id" (click)="decide(item, true)">Approva e pubblica</button>
                  }
                </div>
              </article>
            }
          </section>
        }

        @if (missingTotal()) {
          <p class="warn" role="status"><odys-icon name="alert-triangle" [size]="18" /> {{ missingTotal() }} {{ missingTotal() === 1 ? 'partenza senza coordinatore' : 'partenze senza coordinatore' }}: non si possono pubblicare finché non ne assegni uno.</p>
        }

        @for (item of series(); track item.id) {
          <section class="series" [attr.aria-label]="item.title">
            <div class="series__head">
              <div>
                <h2>{{ item.title }}</h2>
                <p class="muted">{{ item.destination }} · {{ item.departures.length }} {{ item.departures.length === 1 ? 'partenza' : 'partenze' }}</p>
              </div>
            </div>
            <ul class="deps">
              @for (dep of item.departures; track dep.id) {
                <li class="dep" [class.dep--missing]="!dep.coordinator.id">
                  <div class="dep__main">
                    <strong>{{ dep.startDate ? (dep.startDate | date: 'd MMM') : 'Date da definire' }}@if (dep.endDate) { – {{ dep.endDate | date: 'd MMM y' }}}</strong>
                    <span class="status status--{{ dep.effectiveStatus }}">{{ statusLabel(dep.effectiveStatus) }}</span>
                    <span class="muted">{{ dep.seatsTaken }}/{{ dep.capacity ?? '—' }} posti</span>
                  </div>
                  <div class="dep__row">
                    <label class="coord">
                      <span class="sr-only">Coordinatore della partenza del {{ dep.startDate | date: 'd MMM' }}</span>
                      <select class="field" [name]="'coord-' + dep.id" [ngModel]="dep.coordinator.id" (ngModelChange)="assign(dep, $event)" [disabled]="busy() === dep.id">
                        <option value="">Coordinatore da assegnare</option>
                        @for (c of coordinators(); track c.userId) {<option [value]="c.userId">{{ c.firstName }} {{ c.lastName }}{{ c.licensed ? ' · con licenza' : '' }}</option>}
                      </select>
                    </label>
                    <a class="open" [routerLink]="['/coordinatore', dep.id]">Apri<odys-icon name="chevron-right" [size]="16" /></a>
                  </div>
                  @if (!dep.coordinator.id) {<p class="dep__warn"><odys-icon name="alert-triangle" [size]="14" /> Senza coordinatore</p>}
                </li>
              }
            </ul>
            <form class="add" (submit)="$event.preventDefault(); addDeparture(item)" novalidate>
              <span class="add__label">Nuova partenza</span>
              <input class="field" type="date" [name]="'start-' + item.id" aria-label="Partenza" [ngModel]="draftStart()[item.id] ?? ''" (ngModelChange)="setDraft('start', item.id, $event)" />
              <input class="field" type="date" [name]="'end-' + item.id" aria-label="Rientro" [ngModel]="draftEnd()[item.id] ?? ''" (ngModelChange)="setDraft('end', item.id, $event)" />
              <button odysButton type="submit" variant="secondary" size="sm" icon="plus" [loading]="busy() === 'add-' + item.id">Aggiungi</button>
            </form>
          </section>
        } @empty {
          <odys-empty-state icon="box" title="Ancora nessun viaggio" description="Crea il primo viaggio del catalogo: poi aggiungi le partenze e assegna a ognuna un coordinatore del team." />
        }

        @if (can('licenses.assign')) {
          <section class="card" aria-labelledby="umbrella-title">
            <h2 id="umbrella-title">Viaggi dei coordinatori · ombrello</h2>
            <p class="muted">Con la copertura, l’agenzia è organizzatore responsabile: contratto, incassi e garanzie a nome dell’agenzia, e la pubblicazione passa da voi. Non si cambia su un viaggio con pagamenti già confermati.</p>
            <ul class="umb">
              @for (trip of coordinatorTrips(); track trip.id) {
                <li class="umb__row">
                  <span class="umb__main">
                    <strong>{{ trip.title }}</strong>
                    <span class="muted">{{ trip.coordinator.displayName }} · {{ trip.startDate ? (trip.startDate | date: 'd MMM y') : 'date da definire' }} · {{ statusLabel(trip.effectiveStatus) }}</span>
                  </span>
                  <label class="switch">
                    <input type="checkbox" role="switch" [checked]="trip.organizer === 'agency'" [disabled]="busy() === trip.id" (change)="toggleUmbrella(trip, $any($event.target))" />
                    <span>Copertura</span>
                  </label>
                </li>
              } @empty {
                <li class="muted">I viaggi dei coordinatori del team compariranno qui.</li>
              }
            </ul>
          </section>
        }
      }
    </div>
  `,
  styles: `
    .head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-5); h1 { font-size: var(--text-3xl); } }
    odys-notice { display: block; margin-bottom: var(--space-4); }
    .warn { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-4); padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); background: var(--color-danger-soft); color: var(--color-danger-text); font-size: var(--text-sm); font-weight: 700; }
    .series, .card { display: flex; flex-direction: column; gap: var(--space-3); max-width: 760px; margin-bottom: var(--space-4); padding: var(--space-5); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); h2 { font-size: var(--text-lg); } }
    .deps, .umb { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .dep { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface-muted); }
    .dep--missing { box-shadow: inset 4px 0 0 var(--odys-coral); }
    .dep__main { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
    .dep__row { display: flex; align-items: center; gap: var(--space-2); }
    .coord { flex: 1; min-width: 0; }
    .dep__warn { display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-xs); font-weight: 800; color: var(--color-danger-text); }
    .status { padding: 2px 10px; border-radius: var(--radius-pill); background: var(--color-surface); font-size: var(--text-xs); font-weight: 700; }
    .status--published, .status--active { background: var(--color-accent); color: var(--color-on-accent); }
    .status--scheduled { background: var(--color-primary-soft); color: var(--color-link); }
    .field { width: 100%; min-height: 44px; padding: 0 var(--space-3); border-radius: var(--radius-md); border: var(--border-width) solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); font: inherit; min-width: 0; }
    .open { display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; min-height: 44px; padding: 0 var(--space-3); border-radius: var(--radius-pill); background: var(--odys-ink); color: #fff; font-size: var(--text-sm); font-weight: 800; text-decoration: none; }
    .add { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); align-items: end; padding-top: var(--space-3); border-top: var(--border-width) solid var(--color-border);
      > button { grid-column: 1 / -1; justify-self: start; } }
    .add__label { grid-column: 1 / -1; font-size: var(--text-sm); font-weight: 700; }
    @media (min-width: 640px) { .add { grid-template-columns: auto 1fr 1fr auto; .add__label, > button { grid-column: auto; } } }
    .umb__row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface-muted); }
    .umb__main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; .muted { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
    .switch { display: inline-flex; align-items: center; gap: var(--space-2); min-height: 44px; font-size: var(--text-sm); font-weight: 700; cursor: pointer;
      input { appearance: none; position: relative; width: 44px; height: 26px; margin: 0; border-radius: var(--radius-pill); background: var(--color-border-strong); cursor: pointer; transition: background-color var(--duration-fast);
        &::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: translate var(--duration-fast) var(--ease-out); }
        &:checked { background: var(--odys-blue); &::after { translate: 18px 0; } }
        &:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px; }
        &:disabled { opacity: 0.5; } } }
    .proposals { border-color: var(--odys-blue); box-shadow: inset 0 4px 0 var(--odys-blue); }
    .prop { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); border-radius: var(--radius-md); background: var(--color-surface-muted); }
    .prop__head { display: flex; flex-direction: column; gap: 2px; }
    .econ { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); margin: 0;
      div { padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); background: var(--color-surface); }
      dt { font-size: var(--text-xs); color: var(--color-text-muted); } dd { margin: 2px 0 0; font-weight: 800; font-variant-numeric: tabular-nums; small { font-weight: 600; color: var(--color-text-muted); } } }
    @media (min-width: 640px) { .econ { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    .neg { color: var(--color-danger-text); }
    .prop__actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
    .grow { flex: 1; }
    .field-label { display: flex; flex-direction: column; gap: 4px; font-size: var(--text-sm); font-weight: 600; }
    .area { min-height: 72px; padding-block: var(--space-2); resize: vertical; }
    .small { font-size: var(--text-xs); }
    .muted { color: var(--color-text-muted); font-size: var(--text-sm); }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  `,
})
export default class AgencyCatalogPage implements OnInit {
  private readonly api = inject(AgencyApi);
  protected readonly mine = signal<MyAgency | null>(null);
  protected readonly trips = signal<CatalogTrip[]>([]);
  protected readonly coordinatorTrips = signal<CatalogTrip[]>([]);
  protected readonly team = signal<AgencyMember[]>([]);
  protected readonly proposals = signal<AgencyProposal[]>([]);
  protected readonly rejecting = signal('');
  protected readonly note = signal('');
  protected readonly loading = signal(true);
  protected readonly busy = signal('');
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly draftStart = signal<Record<string, string | undefined>>({});
  protected readonly draftEnd = signal<Record<string, string | undefined>>({});

  protected readonly coordinators = computed(() => this.team().filter((member) => member.role === 'coordinator' && member.status === 'active' && member.isCoordinator));
  /** Partenze raggruppate per viaggio (serie), in ordine di data. */
  protected readonly series = computed<Series[]>(() => {
    const groups = new Map<string, CatalogTrip[]>();
    for (const trip of this.trips()) {
      const key = trip.seriesId ?? trip.id;
      groups.set(key, [...(groups.get(key) ?? []), trip]);
    }
    return [...groups.entries()].map(([id, departures]) => {
      const sorted = [...departures].sort((a, b) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999'));
      return { id, title: sorted[0].title, destination: sorted[0].destination, departures: sorted, missing: sorted.filter((dep) => !dep.coordinator.id).length };
    });
  });
  protected readonly missingTotal = computed(() => this.series().reduce((total, item) => total + item.missing, 0));

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
    const [catalog, team, proposals] = await Promise.all([this.api.catalog(mine.agency.id), this.api.team(mine.agency.id), this.api.proposals(mine.agency.id).catch(() => [])]);
    this.proposals.set(proposals);
    this.trips.set(catalog.trips);
    this.coordinatorTrips.set(catalog.coordinatorTrips);
    this.team.set(team);
  }

  protected can(action: Parameters<typeof agencyCan>[1]): boolean {
    return agencyCan(this.mine()?.role, action);
  }

  /** Proposta (AG-05): approvare pubblica; chiedere modifiche richiede una nota. */
  protected async decide(item: AgencyProposal, approve: boolean): Promise<void> {
    if (!approve && this.note().trim().length < 5) { this.error.set('Scrivi al coordinatore cosa va cambiato (almeno 5 caratteri).'); return; }
    await this.run(item.trip.id, async () => {
      await this.api.decideProposal(item.trip.id, approve, approve ? undefined : this.note().trim());
      this.rejecting.set('');
      await this.reload();
      return approve ? `«${item.trip.title}» è approvato e pubblicato.` : `Richiesta di modifiche inviata: ${item.trip.coordinator.displayName} la legge nell’editor del viaggio.`;
    });
  }

  protected money(cents: number): string {
    return formatPrice(cents, 'EUR');
  }

  protected rating(value: number): string {
    return value.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  protected statusLabel(status: CatalogTrip['effectiveStatus']): string {
    return PUBLISHED_STATUS_LABELS[status];
  }

  protected setDraft(which: 'start' | 'end', seriesId: string, value: string): void {
    (which === 'start' ? this.draftStart : this.draftEnd).update((drafts) => ({ ...drafts, [seriesId]: value }));
  }

  protected async addDeparture(item: Series): Promise<void> {
    const start = this.draftStart()[item.id];
    const end = this.draftEnd()[item.id];
    if (!start || !end) { this.error.set('Indica partenza e rientro della nuova partenza.'); return; }
    await this.run(`add-${item.id}`, async () => {
      await this.api.addDeparture(item.departures[0].id, start, end);
      this.setDraft('start', item.id, '');
      this.setDraft('end', item.id, '');
      await this.reload();
      return 'Partenza aggiunta in bozza: assegna il coordinatore e pubblicala.';
    });
  }

  protected async assign(dep: CatalogTrip, userId: string): Promise<void> {
    await this.run(dep.id, async () => {
      await this.api.assignCoordinator(dep.id, userId || null);
      await this.reload();
      return userId ? 'Coordinatore assegnato.' : 'Coordinatore tolto dalla partenza.';
    });
  }

  protected async toggleUmbrella(trip: CatalogTrip, input: HTMLInputElement): Promise<void> {
    const mine = this.mine();
    if (!mine) return;
    const on = input.checked;
    await this.run(trip.id, async () => {
      await this.api.setUmbrella(mine.agency.id, trip.id, on);
      return on ? `«${trip.title}» ora è coperto dall’agenzia.` : `«${trip.title}» torna sotto la responsabilità del coordinatore.`;
    });
    // In ogni caso si rilegge, e la casella torna allo stato vero: se il server ha rifiutato,
    // il valore legato non cambia e Angular da solo non la riaggiornerebbe.
    await this.reload().catch(() => undefined);
    input.checked = this.coordinatorTrips().find((item) => item.id === trip.id)?.organizer === 'agency';
  }

  private async run(key: string, action: () => Promise<string>): Promise<void> {
    this.busy.set(key);
    this.error.set('');
    this.message.set('');
    try {
      this.message.set(await action());
    } catch (error) {
      this.error.set(apiErrorMessage(error));
      await this.reload().catch(() => undefined);
    } finally {
      this.busy.set('');
    }
  }
}
