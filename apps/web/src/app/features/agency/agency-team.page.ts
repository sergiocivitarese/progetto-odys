import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AGENCY_LINK_LABELS, AGENCY_ROLE_LABELS, agencyCan, ANNUAL_MONTHS_CHARGED, INVITABLE_ROLES, LICENSE_TIERS, licenseQuote, MAX_LICENSE_SEATS,
  type AgencyRole, type BillingCycle,
} from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { AgencyApi, type AgencyMember, type MyAgency } from '../../core/api/agency.api';
import { formatPrice } from '../../core/api/catalog.api';
import { ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';

/**
 * Team e licenze dell'agenzia (AG-02, AG-05, AG-09, AG-10): inviti, ruoli,
 * legame dei coordinatori, licenze usate e libere, scaglione e costo.
 */
@Component({
  selector: 'odys-agency-team-page',
  imports: [FormsModule, RouterLink, ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a routerLink="/agenzia" class="back"><odys-icon name="arrow-left" [size]="16" /> Impostazioni agenzia</a>
      <header class="head">
        <p class="eyebrow">{{ mine()?.agency?.displayName ?? 'Agenzia' }}</p>
        <h1>Team e licenze</h1>
      </header>

      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
      @if (message()) {<odys-notice tone="success">{{ message() }}</odys-notice>}

      @if (loading()) {
        <p class="muted">Carico…</p>
      } @else if (!mine()) {
        <odys-empty-state icon="users" title="Nessuna agenzia" description="Crea prima il profilo dell’agenzia." actionLabel="Impostazioni agenzia" (action)="goSettings()" />
      } @else if (!can('team.view')) {
        <odys-notice tone="info">Il team lo vedono proprietario, amministratori e operatori.</odys-notice>
      } @else if (mine(); as m) {
        <!-- Licenze (AG-09, AG-10) -->
        <section class="lic" aria-labelledby="lic-title">
          <div class="lic__top">
            <div>
              <p class="lic__label" id="lic-title">Licenze Coordinatore Premium</p>
              <p class="lic__value">{{ used() }}<small> / {{ m.agency.licenseSeats }} usate</small></p>
              <p class="lic__sub">{{ free() }} {{ free() === 1 ? 'libera' : 'libere' }} · chi ha una licenza ottiene subito i diritti del Coordinatore Premium</p>
            </div>
          </div>
          <div class="lic__seats" role="img" [attr.aria-label]="used() + ' licenze usate su ' + m.agency.licenseSeats">
            @for (seat of seatBar(); track $index) {<span class="lic__seat" [class.is-used]="seat"></span>}
          </div>
          <dl class="lic__quote">
            <div><dt>Scaglione</dt><dd>{{ quote().tier ? tierLabel(quote().tier!) : '—' }}</dd></div>
            <div><dt>Per licenza</dt><dd>{{ money(quote().perLicenseMonthlyCents) }}/mese</dd></div>
            <div><dt>Totale {{ quote().cycle === 'annual' ? 'annuo' : 'mensile' }}</dt><dd>{{ money(quote().totalCents) }}</dd></div>
          </dl>
          @if (quote().next; as next) {<p class="lic__next">Con {{ next.missing }} {{ next.missing === 1 ? 'licenza' : 'licenze' }} in più passi a {{ money(next.tier.monthlyCents) }} per licenza.</p>}

          @if (can('licenses.seats')) {
            <form class="lic__form" (submit)="$event.preventDefault(); saveSeats()" novalidate>
              <label class="lic__field">Licenze
                <span class="stepper">
                  <button type="button" (click)="bump(-1)" [disabled]="seats() <= used()" aria-label="Una licenza in meno"><odys-icon name="minus" [size]="16" /></button>
                  <input type="number" inputmode="numeric" min="0" [max]="maxSeats" name="seats" [ngModel]="seats()" (ngModelChange)="seats.set(+$event || 0)" />
                  <button type="button" (click)="bump(1)" [disabled]="seats() >= maxSeats" aria-label="Una licenza in più"><odys-icon name="plus" [size]="16" /></button>
                </span>
              </label>
              <span class="cycle" role="radiogroup" aria-label="Fatturazione">
                <button type="button" role="radio" [attr.aria-checked]="cycle() === 'monthly'" [class.is-on]="cycle() === 'monthly'" (click)="cycle.set('monthly')">Mensile</button>
                <button type="button" role="radio" [attr.aria-checked]="cycle() === 'annual'" [class.is-on]="cycle() === 'annual'" (click)="cycle.set('annual')">Annuale</button>
              </span>
              @if (seats() !== m.agency.licenseSeats || cycle() !== m.agency.billingCycle) {
                <p class="lic__preview">Nuovo totale: <strong>{{ money(preview().totalCents) }}</strong> {{ cycle() === 'annual' ? 'l’anno' : 'al mese' }}</p>
              }
              <button odysButton type="submit" variant="accent" [loading]="busy() === 'seats'" [disabled]="seats() === m.agency.licenseSeats && cycle() === m.agency.billingCycle">Aggiorna licenze</button>
            </form>
          }
          <details class="tiers">
            <summary>Scaglioni di prezzo</summary>
            <table>
              <thead><tr><th scope="col">Licenze attive</th><th scope="col">Per licenza al mese</th></tr></thead>
              <tbody>
                @for (tier of tiers; track tier.from) {
                  <tr [class.is-current]="quote().tier?.from === tier.from"><td>{{ tierLabel(tier) }}</td><td>{{ money(tier.monthlyCents) }}</td></tr>
                }
              </tbody>
            </table>
            <p class="muted small">Prezzi d’esempio, da confermare. Annuale: {{ annualMonths }} mesi su 12. Acquisto simulato: nessun addebito.</p>
          </details>
        </section>

        <!-- Invito (AG-05) -->
        @if (can('team.invite')) {
          <form class="card invite" (submit)="$event.preventDefault(); invite()" novalidate>
            <h2>Invita nel team</h2>
            <p class="hint">Inserisci l’email di un account Odys. L’invito compare nel suo profilo: entra quando lo accetta.</p>
            <p class="seats-line">Membri {{ memberCount() }}@if (maxMembers() !== null) {/{{ maxMembers() }}} · piano {{ m.modules.label }}</p>
            @if (teamFull()) {
              <odys-notice tone="warning">Il team ha raggiunto il limite del piano {{ m.modules.label }}. <a routerLink="/agenzia">Passa a un piano superiore</a> per invitare altre persone.</odys-notice>
            }
            <div class="invite__row">
              <label class="field-label grow">Email<input class="field" type="email" name="email" autocomplete="off" placeholder="nome@esempio.it" [ngModel]="email()" (ngModelChange)="email.set($event)" /></label>
              <label class="field-label">Ruolo
                <select class="field" name="role" [ngModel]="role()" (ngModelChange)="role.set($event)">
                  @for (item of invitable; track item) {<option [value]="item">{{ roleLabels[item] }}</option>}
                </select>
              </label>
            </div>
            <p class="hint">{{ roleHint() }}</p>
            <button odysButton type="submit" variant="secondary" icon="plus" [loading]="busy() === 'invite'" [disabled]="teamFull()">Invia l’invito</button>
          </form>
        }

        <!-- Team (AG-05) -->
        <section class="card" aria-labelledby="team-title">
          <h2 id="team-title">Team · {{ activeCount() }}</h2>
          <ul class="team">
            @for (member of team(); track member.id) {
              <li class="member">
                <span class="member__avatar" [class.member__avatar--licensed]="member.licensed" aria-hidden="true">{{ initials(member) }}</span>
                <span class="member__main">
                  <strong>{{ member.firstName }} {{ member.lastName }}</strong>
                  <span class="muted small">{{ member.email }}</span>
                  <span class="tags">
                    <span class="tag tag--role">{{ roleLabels[member.role] }}</span>
                    @if (member.linkType) {<span class="tag" [class.tag--licensed]="member.licensed">{{ linkLabels[member.linkType] }}</span>}
                    @if (member.status === 'invited') {<span class="tag tag--wait">Invito in attesa</span>}
                    @if (member.role === 'coordinator' && member.status === 'active') {
                      @if (member.tripsRunning) {<span class="tag tag--go">In viaggio</span>}
                      @if (member.tripsOnSale) {<span class="tag">In vendita · {{ member.tripsOnSale }}</span>}
                      @if (!member.verified) {<span class="tag tag--warn">Documenti da verificare</span>}
                    }
                  </span>
                </span>
                <span class="member__actions">
                  @if (member.role === 'coordinator' && member.status === 'active' && can('licenses.assign')) {
                    @if (member.licensed) {
                      <button type="button" class="act" [disabled]="busy() === member.id" (click)="revoke(member)">Revoca licenza</button>
                    } @else {
                      <button type="button" class="act act--primary" [disabled]="busy() === member.id || free() === 0" [attr.title]="free() === 0 ? 'Nessuna licenza libera' : null" (click)="assign(member)">Assegna licenza</button>
                    }
                  }
                  @if (member.role === 'coordinator' && member.status === 'active' && can('licenses.assign')) {
                    <label class="umbrella" [attr.title]="'I viaggi nuovi di ' + member.firstName + ' nascono coperti dall’agenzia'">
                      <input type="checkbox" role="switch" [checked]="member.umbrellaDefault" [disabled]="busy() === member.id" (change)="toggleUmbrellaDefault(member, $any($event.target).checked)" />
                      Ombrello predefinito
                    </label>
                  }
                  @if (member.role !== 'owner' && can('team.remove')) {
                    <button type="button" class="act act--ghost" [disabled]="busy() === member.id" (click)="remove(member)">{{ confirming() === member.id ? 'Conferma' : (member.status === 'invited' ? 'Annulla invito' : 'Rimuovi') }}</button>
                  }
                </span>
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
  styles: `
    .back { display: inline-flex; align-items: center; gap: 6px; margin-bottom: var(--space-4); color: var(--color-text-muted); font-size: var(--text-sm); font-weight: 600; text-decoration: none; }
    .head { margin-bottom: var(--space-5); h1 { font-size: var(--text-3xl); } }
    odys-notice { display: block; margin-bottom: var(--space-4); }
    .lic { display: flex; flex-direction: column; gap: var(--space-3); max-width: 760px; margin-bottom: var(--space-4); padding: var(--space-5); border-radius: var(--radius-xl, 28px); background: var(--odys-blue); color: #fff; }
    .lic__label { font-size: var(--text-sm); font-weight: 700; opacity: 0.85; }
    .lic__value { font-family: var(--font-brand); font-weight: 900; font-size: clamp(2.25rem, 10vw, 3rem); line-height: 1; small { font-size: 0.4em; font-weight: 700; opacity: 0.85; } }
    .lic__sub, .lic__next { font-size: var(--text-sm); opacity: 0.9; }
    .lic__seats { display: flex; flex-wrap: wrap; gap: 4px; }
    .lic__seat { width: 18px; height: 10px; border-radius: var(--radius-pill); background: rgb(255 255 255 / 0.25); }
    .lic__seat.is-used { background: var(--odys-lime); }
    .lic__quote { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); margin: 0;
      div { padding: var(--space-3); border-radius: var(--radius-md); background: rgb(255 255 255 / 0.12); }
      dt { font-size: var(--text-xs); opacity: 0.85; } dd { margin: 2px 0 0; font-weight: 800; font-variant-numeric: tabular-nums; } }
    .lic__form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-3); padding-top: var(--space-3); border-top: 1px solid rgb(255 255 255 / 0.2);
      button[odysButton] { margin-left: auto; } }
    .lic__field { display: flex; flex-direction: column; gap: 4px; font-size: var(--text-xs); font-weight: 700; }
    .stepper { display: inline-flex; align-items: center; border-radius: var(--radius-pill); background: #fff; color: var(--odys-ink); overflow: hidden;
      button { display: grid; place-items: center; width: 44px; height: 44px; border: 0; background: transparent; color: inherit; cursor: pointer; &:disabled { opacity: 0.3; cursor: default; } }
      input { width: 56px; height: 44px; border: 0; text-align: center; font: inherit; font-weight: 800; font-variant-numeric: tabular-nums; background: transparent; color: inherit; -moz-appearance: textfield; &::-webkit-inner-spin-button { -webkit-appearance: none; } } }
    .cycle { display: inline-flex; padding: 4px; border-radius: var(--radius-pill); background: rgb(255 255 255 / 0.15);
      button { min-height: 36px; padding: 0 var(--space-3); border: 0; border-radius: var(--radius-pill); background: transparent; color: #fff; font: inherit; font-size: var(--text-sm); font-weight: 800; cursor: pointer; }
      button.is-on { background: #fff; color: var(--odys-ink); } }
    .lic__preview { flex-basis: 100%; font-size: var(--text-sm); }
    .tiers { font-size: var(--text-sm);
      summary { cursor: pointer; font-weight: 700; min-height: 32px; }
      table { width: 100%; margin-top: var(--space-2); border-collapse: collapse; }
      th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid rgb(255 255 255 / 0.2); font-variant-numeric: tabular-nums; }
      th { font-size: var(--text-xs); opacity: 0.85; }
      tr.is-current td { background: rgb(255 255 255 / 0.15); font-weight: 800; } }
    .tiers .muted { color: inherit; opacity: 0.8; }
    .card { display: flex; flex-direction: column; gap: var(--space-3); max-width: 760px; margin-bottom: var(--space-4); padding: var(--space-5); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border);
      h2 { font-size: var(--text-lg); } > button { align-self: flex-start; } }
    .seats-line { font-size: var(--text-sm); font-weight: 700; }
    .invite__row { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    .grow { flex: 1 1 220px; }
    .field-label { display: flex; flex-direction: column; gap: 4px; font-size: var(--text-sm); font-weight: 600; }
    .field { min-height: 48px; padding: 0 var(--space-3); border-radius: var(--radius-md); border: var(--border-width) solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); font: inherit; font-weight: 400; }
    .team { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .member { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface-muted); }
    .member__avatar { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; border-radius: 50%; background: var(--odys-ink); color: #fff; font-weight: 900; font-size: var(--text-sm); }
    .member__avatar--licensed { background: var(--odys-blue); box-shadow: 0 0 0 3px var(--odys-lime); }
    .member__main { display: flex; flex-direction: column; gap: 2px; flex: 1 1 200px; min-width: 0; strong, .small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .tag { padding: 2px 8px; border-radius: var(--radius-pill); background: var(--color-surface); font-size: var(--text-xs); font-weight: 700; }
    .tag--role { background: var(--odys-ink); color: #fff; }
    .tag--licensed { background: var(--odys-blue); color: #fff; }
    .tag--wait { background: var(--color-accent-soft); }
    .tag--go { background: var(--odys-lime); color: var(--odys-ink); }
    .tag--warn { background: var(--color-danger-soft); color: var(--color-danger-text); }
    .member__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-left: auto; }
    .umbrella { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; font-size: var(--text-xs); font-weight: 700; cursor: pointer;
      input { width: 18px; height: 18px; accent-color: var(--odys-blue); } }
    .act { min-height: 40px; padding: 0 var(--space-3); border-radius: var(--radius-pill); border: var(--border-width) solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); font: inherit; font-size: var(--text-sm); font-weight: 800; cursor: pointer;
      &:disabled { opacity: 0.45; cursor: default; } }
    .act--primary { border-color: var(--odys-blue); background: var(--odys-blue); color: #fff; }
    .act--ghost { border-color: transparent; background: transparent; color: var(--color-text-muted); }
    .hint, .muted { font-size: var(--text-sm); color: var(--color-text-muted); }
    .small { font-size: var(--text-xs); }
  `,
})
export default class AgencyTeamPage implements OnInit {
  private readonly api = inject(AgencyApi);
  protected readonly mine = signal<MyAgency | null>(null);
  protected readonly team = signal<AgencyMember[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal('');
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly confirming = signal('');
  protected readonly email = signal('');
  protected readonly role = signal<AgencyRole>('coordinator');
  protected readonly seats = signal(0);
  protected readonly cycle = signal<BillingCycle>('monthly');
  protected readonly roleLabels = AGENCY_ROLE_LABELS;
  protected readonly linkLabels = AGENCY_LINK_LABELS;
  protected readonly invitable = INVITABLE_ROLES;
  protected readonly tiers = LICENSE_TIERS;
  protected readonly maxSeats = MAX_LICENSE_SEATS;
  protected readonly annualMonths = ANNUAL_MONTHS_CHARGED;

  protected readonly used = computed(() => this.team().filter((member) => member.licensed).length);
  protected readonly free = computed(() => Math.max(0, (this.mine()?.agency.licenseSeats ?? 0) - this.used()));
  /** Membri oltre al proprietario (inviti compresi) e limite del piano (AG-08). */
  protected readonly memberCount = computed(() => this.team().filter((member) => member.role !== 'owner').length);
  protected readonly maxMembers = computed(() => this.mine()?.modules.maxMembers ?? null);
  protected readonly teamFull = computed(() => this.maxMembers() !== null && this.memberCount() >= this.maxMembers()!);
  protected readonly activeCount = computed(() => this.team().filter((member) => member.status === 'active').length);
  protected readonly quote = computed(() => licenseQuote(this.mine()?.agency.licenseSeats ?? 0, this.mine()?.agency.billingCycle ?? 'monthly'));
  protected readonly preview = computed(() => licenseQuote(this.seats(), this.cycle()));
  protected readonly seatBar = computed(() => Array.from({ length: Math.min(60, this.mine()?.agency.licenseSeats ?? 0) }, (_, index) => index < this.used()));
  protected readonly roleHint = computed(() => ({
    coordinator: 'Coordinatore associato: resta indipendente. Puoi assegnargli una licenza Coordinatore Premium quando accetta.',
    operator: 'Operatore: vede il team e lavora sul catalogo, senza gestire inviti e licenze.',
    admin: 'Amministratore: gestisce profilo, inviti e licenze assegnate. Comprare licenze resta al proprietario.',
    owner: '',
  })[this.role()]);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  protected can(action: Parameters<typeof agencyCan>[1]): boolean {
    return agencyCan(this.mine()?.role, action);
  }

  private async load(): Promise<void> {
    try {
      const mine = await this.api.mine();
      this.mine.set(mine);
      if (mine) {
        this.seats.set(mine.agency.licenseSeats);
        this.cycle.set(mine.agency.billingCycle);
        if (agencyCan(mine.role, 'team.view')) this.team.set(await this.api.team(mine.agency.id));
      }
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private async refreshTeam(): Promise<void> {
    const mine = this.mine();
    if (mine) this.team.set(await this.api.team(mine.agency.id));
  }

  protected bump(delta: number): void {
    this.seats.update((value) => Math.min(this.maxSeats, Math.max(this.used(), value + delta)));
  }

  protected async saveSeats(): Promise<void> {
    const mine = this.mine();
    if (!mine) return;
    await this.run('seats', async () => {
      const result = await this.api.setLicenses(mine.agency.id, this.seats(), this.cycle());
      this.mine.set({ ...mine, agency: result.agency, quote: result.quote });
      return `Licenze aggiornate: ${result.agency.licenseSeats}, fatturazione ${result.agency.billingCycle === 'annual' ? 'annuale' : 'mensile'}.`;
    });
  }

  protected async invite(): Promise<void> {
    const mine = this.mine();
    if (!mine) return;
    await this.run('invite', async () => {
      await this.api.invite(mine.agency.id, this.email().trim(), this.role());
      this.email.set('');
      await this.refreshTeam();
      return 'Invito inviato: lo trova nel suo account.';
    });
  }

  protected async assign(member: AgencyMember): Promise<void> {
    await this.run(member.id, async () => {
      await this.api.assignLicense(member.id);
      await this.refreshTeam();
      return `${member.firstName} ha ora una licenza Coordinatore Premium.`;
    });
  }

  protected async revoke(member: AgencyMember): Promise<void> {
    await this.run(member.id, async () => {
      await this.api.revokeLicense(member.id);
      await this.refreshTeam();
      return `Licenza revocata: ${member.firstName} resta nel team come associato.`;
    });
  }

  protected async toggleUmbrellaDefault(member: AgencyMember, on: boolean): Promise<void> {
    await this.run(member.id, async () => {
      await this.api.setUmbrellaDefault(member.id, on);
      await this.refreshTeam();
      return on ? `I nuovi viaggi di ${member.firstName} nasceranno coperti dall’agenzia.` : `I nuovi viaggi di ${member.firstName} restano sotto la sua responsabilità.`;
    });
  }

  /** Rimozione in due tocchi: il primo chiede conferma. */
  protected async remove(member: AgencyMember): Promise<void> {
    if (this.confirming() !== member.id) {
      this.confirming.set(member.id);
      return;
    }
    this.confirming.set('');
    await this.run(member.id, async () => {
      await this.api.remove(member.id);
      await this.refreshTeam();
      return member.status === 'invited' ? 'Invito annullato.' : `${member.firstName} non fa più parte del team.`;
    });
  }

  protected initials(member: AgencyMember): string {
    return `${member.firstName.slice(0, 1)}${member.lastName.slice(0, 1)}`.toUpperCase();
  }

  protected tierLabel(tier: { from: number; to: number | null }): string {
    return tier.to === null ? `${tier.from} e oltre` : `${tier.from}–${tier.to}`;
  }

  protected money(cents: number): string {
    return formatPrice(cents, 'EUR');
  }

  protected goSettings(): void {
    location.assign('/agenzia');
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
