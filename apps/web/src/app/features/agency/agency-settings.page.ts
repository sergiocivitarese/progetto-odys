import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AGENCY_ROLE_LABELS, AGENCY_TIER_MODULES, AGENCY_TIERS, agencyCan, agencySlug, type AgencyTier } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { AgencyApi, type AgencyProfileForm, type MyAgency } from '../../core/api/agency.api';
import { EntitlementsStore } from '../../core/state/entitlements.store';
import { ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent, TextFieldComponent } from '../../shared/ui';

/**
 * Impostazioni dell'agenzia (AG-01): creazione con il piano Agenzia, profilo
 * dell'organizzazione e informazioni pubbliche. Lo modificano proprietario e amministratori.
 */
@Component({
  selector: 'odys-agency-settings-page',
  imports: [RouterLink, ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent, TextFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="head">
        <p class="eyebrow">Agenzia</p>
        <h1>{{ mine()?.agency?.displayName ?? 'La tua agenzia' }}</h1>
        @if (mine(); as m) {
          <p class="meta"><span class="role">{{ roleLabel() }}</span>
            <a [routerLink]="['/agenzie', m.agency.slug]"><odys-icon name="arrow-up-right" [size]="14" /> Pagina pubblica</a>
            <a routerLink="/agenzia/catalogo"><odys-icon name="box" [size]="14" /> Catalogo</a>
            <a routerLink="/agenzia/team"><odys-icon name="users" [size]="14" /> Team e licenze</a>
          </p>
        }
      </header>

      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
      @if (message()) {<odys-notice tone="success">{{ message() }}</odys-notice>}

      @if (loading()) {
        <p class="muted">Carico…</p>
      } @else if (!mine()) {
        @if (entitlements.has('agency.team')) {
          <form class="card" (submit)="$event.preventDefault(); create()" novalidate>
            <h2>Crea il profilo dell’agenzia</h2>
            <p class="hint">Servono la ragione sociale e il nome con cui i viaggiatori vi conosceranno. Il resto lo completi dopo.</p>
            <odys-text-field label="Ragione sociale" placeholder="Es. Viaggi Lenti Srl" [(value)]="legalName" />
            <odys-text-field label="Nome pubblico" placeholder="Es. Viaggi Lenti" [value]="displayName()" (valueChange)="setDisplayName($event)" />
            <odys-text-field label="Indirizzo della pagina" [hint]="'odys.app/agenzie/' + (slug() || '…')" [(value)]="slug" />
            <button odysButton type="submit" variant="accent" icon="check" [loading]="busy()">Crea l’agenzia</button>
          </form>
        } @else {
          <odys-empty-state icon="users" title="Nessuna agenzia" description="Il profilo agenzia è incluso nel piano Agenzia. Se un’agenzia ti ha invitato, trovi l’invito nel tuo account." actionLabel="Vai all’account" (action)="goAccount()" />
        }
      } @else if (mine(); as m) {
        <form class="card" (submit)="$event.preventDefault(); save()" novalidate>
          <h2>Profilo dell’organizzazione</h2>
          @if (!canEdit()) {<odys-notice tone="info">Il profilo lo modificano il proprietario e gli amministratori.</odys-notice>}
          <div class="two">
            <odys-text-field label="Ragione sociale" [(value)]="legalName" [disabled]="!canEdit()" />
            <odys-text-field label="Nome pubblico" [(value)]="displayName" [disabled]="!canEdit()" />
          </div>
          <odys-text-field label="Indirizzo della pagina" [hint]="'odys.app/agenzie/' + slug()" [(value)]="slug" [disabled]="!canEdit()" />
          <odys-text-field label="Descrizione" [multiline]="true" hint="Chi siete, che viaggi organizzate, da quanto tempo." [(value)]="description" [disabled]="!canEdit()" />
          <odys-text-field label="Logo (facoltativo)" placeholder="https://…" hint="Indirizzo https di un’immagine quadrata." [(value)]="logoUrl" [disabled]="!canEdit()" />
          <h3>Contatti pubblici</h3>
          <div class="two">
            <odys-text-field label="Email" type="email" [(value)]="email" [disabled]="!canEdit()" />
            <odys-text-field label="Telefono" [(value)]="phone" [disabled]="!canEdit()" />
          </div>
          <odys-text-field label="Sito" placeholder="https://…" [(value)]="website" [disabled]="!canEdit()" />
          <div class="two">
            <odys-text-field label="Città" [(value)]="city" [disabled]="!canEdit()" />
            <odys-text-field label="Paese" [(value)]="country" [disabled]="!canEdit()" />
          </div>
          <h3>Condizioni di vendita</h3>
          <odys-text-field label="Condizioni dell’agenzia (facoltative)" [multiline]="true" hint="Le leggono i viaggiatori nel checkout dei viaggi coperti dall’agenzia: acconto, rimborsi, annullamenti, garanzie." [(value)]="saleTerms" [disabled]="!canEdit()" />
          @if (canEdit()) {<button odysButton type="submit" variant="accent" icon="check" [loading]="busy()">Salva il profilo</button>}
        </form>

        <!-- Moduli a piano (AG-08) -->
        <section class="card" aria-labelledby="tier-title">
          <h2 id="tier-title">Piano dell’agenzia</h2>
          <p class="hint">Numero di membri del team, dati avanzati e automazioni dipendono dal piano. Prezzi da definire: il cambio è simulato, senza addebito.</p>
          <div class="tiers">
            @for (tier of tiers; track tier.key) {
              <div class="tier" [class.is-current]="m.agency.tier === tier.key">
                <strong>{{ tier.label }}</strong>
                <ul>
                  <li>{{ tier.maxMembers === null ? 'Team senza limiti' : 'Fino a ' + tier.maxMembers + ' membri' }}</li>
                  <li [class.off]="!tier.advancedAnalytics">Canali e classifica dei coordinatori</li>
                  <li [class.off]="!tier.automations">Automazioni sui nuovi coordinatori</li>
                </ul>
                @if (m.agency.tier === tier.key) {
                  <span class="tier__current">Piano attuale</span>
                } @else if (m.role === 'owner') {
                  <button odysButton type="button" variant="secondary" size="sm" [loading]="busy()" (click)="changeTier(tier.key)">Passa a {{ tier.label }}</button>
                }
              </div>
            }
          </div>
        </section>

        <section class="card" aria-labelledby="auto-title">
          <h2 id="auto-title">Automazioni</h2>
          @if (!m.modules.automations) {<odys-notice tone="info">Le automazioni sono incluse nel piano Business.</odys-notice>}
          <label class="auto">
            <input type="checkbox" [checked]="m.agency.autoUmbrellaNew" [disabled]="!m.modules.automations || !canEdit() || busy()" (change)="setAutomation('umbrella', $any($event.target).checked)" />
            <span><strong>Ombrello automatico</strong><span class="hint">Ogni coordinatore che entra nel team ha l’ombrello predefinito: i suoi viaggi nuovi nascono coperti dall’agenzia.</span></span>
          </label>
          <label class="auto">
            <input type="checkbox" [checked]="m.agency.autoLicenseNew" [disabled]="!m.modules.automations || !canEdit() || busy()" (change)="setAutomation('license', $any($event.target).checked)" />
            <span><strong>Licenza automatica</strong><span class="hint">Se ci sono licenze libere, chi entra come coordinatore riceve subito il Coordinatore Premium.</span></span>
          </label>
        </section>
        <p class="hint">Le parti dell’area agenzia ancora da costruire (AI per i coordinatori, dati e proposte da approvare) arrivano nei prossimi aggiornamenti.</p>
      }
    </div>
  `,
  styles: `
    .head { margin-bottom: var(--space-5); h1 { font-size: var(--text-3xl); } }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-4); margin-top: var(--space-2); font-size: var(--text-sm); font-weight: 700;
      a { display: inline-flex; align-items: center; gap: 4px; color: var(--color-link); } }
    .role { padding: 2px 10px; border-radius: var(--radius-pill); background: var(--odys-blue); color: #fff; }
    odys-notice { display: block; margin-bottom: var(--space-4); }
    .card { display: flex; flex-direction: column; gap: var(--space-4); max-width: 760px; margin-bottom: var(--space-4); padding: var(--space-5); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border);
      h2 { font-size: var(--text-lg); } h3 { font-size: var(--text-md); margin-top: var(--space-2); } > button { align-self: flex-start; } }
    .two { display: grid; gap: var(--space-4); }
    .tiers { display: grid; gap: var(--space-3); }
    @media (min-width: 640px) { .tiers { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    .tier { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); border-radius: var(--radius-lg); background: var(--color-surface-muted); border: 2px solid transparent;
      strong { font-family: var(--font-brand); font-size: var(--text-xl); font-weight: 900; }
      ul { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: var(--text-sm); }
      li::before { content: '✓ '; color: var(--odys-blue); font-weight: 900; }
      li.off { color: var(--color-text-muted); text-decoration: line-through; &::before { content: '– '; color: inherit; } }
      > button { align-self: flex-start; margin-top: auto; } }
    .tier.is-current { border-color: var(--odys-blue); background: var(--color-primary-soft); }
    .tier__current { align-self: flex-start; margin-top: auto; padding: 2px 10px; border-radius: var(--radius-pill); background: var(--odys-blue); color: #fff; font-size: var(--text-xs); font-weight: 800; }
    .auto { display: flex; align-items: flex-start; gap: var(--space-3); cursor: pointer;
      input { width: 20px; height: 20px; margin-top: 2px; accent-color: var(--odys-blue); flex-shrink: 0; }
      > span { display: flex; flex-direction: column; gap: 2px; } }
    @media (min-width: 640px) { .two { grid-template-columns: 1fr 1fr; } }
    .hint, .muted { font-size: var(--text-sm); color: var(--color-text-muted); }
  `,
})
export default class AgencySettingsPage implements OnInit {
  private readonly api = inject(AgencyApi);
  protected readonly entitlements = inject(EntitlementsStore);
  protected readonly mine = signal<MyAgency | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly legalName = signal('');
  protected readonly displayName = signal('');
  protected readonly slug = signal('');
  protected readonly description = signal('');
  protected readonly logoUrl = signal('');
  protected readonly email = signal('');
  protected readonly phone = signal('');
  protected readonly website = signal('');
  protected readonly city = signal('');
  protected readonly country = signal('');
  protected readonly saleTerms = signal('');
  protected readonly tiers = AGENCY_TIERS.map((key) => ({ key, ...AGENCY_TIER_MODULES[key] }));

  protected async changeTier(tier: AgencyTier): Promise<void> {
    const mine = this.mine();
    if (!mine) return;
    await this.run(async () => {
      const result = await this.api.setTier(mine.agency.id, tier);
      this.mine.set({ ...mine, agency: result.agency, modules: result.modules });
      this.message.set(`Piano ${result.modules.label} attivo.`);
    });
  }

  protected async setAutomation(which: 'umbrella' | 'license', on: boolean): Promise<void> {
    const mine = this.mine();
    if (!mine) return;
    const umbrella = which === 'umbrella' ? on : mine.agency.autoUmbrellaNew;
    const license = which === 'license' ? on : mine.agency.autoLicenseNew;
    await this.run(async () => {
      const agency = await this.api.setAutomations(mine.agency.id, umbrella, license);
      this.mine.set({ ...mine, agency });
      this.message.set('Automazioni aggiornate.');
    });
  }

  protected readonly canEdit = computed(() => agencyCan(this.mine()?.role, 'profile.edit'));
  protected readonly roleLabel = computed(() => (this.mine() ? AGENCY_ROLE_LABELS[this.mine()!.role] : ''));
  private slugTouched = false;

  async ngOnInit(): Promise<void> {
    await this.entitlements.refresh().catch(() => undefined);
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const mine = await this.api.mine();
      this.mine.set(mine);
      if (mine) {
        const a = mine.agency;
        this.legalName.set(a.legalName); this.displayName.set(a.displayName); this.slug.set(a.slug); this.description.set(a.description);
        this.logoUrl.set(a.logoUrl ?? ''); this.email.set(a.email ?? ''); this.phone.set(a.phone ?? ''); this.website.set(a.website ?? '');
        this.city.set(a.city ?? ''); this.country.set(a.country ?? ''); this.saleTerms.set(a.saleTerms ?? '');
      }
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  /** Il nome pubblico propone l'indirizzo finché non lo si scrive a mano. */
  protected setDisplayName(value: string): void {
    this.displayName.set(value);
    if (!this.slugTouched) this.slug.set(agencySlug(value));
  }

  private form(): AgencyProfileForm {
    return {
      legalName: this.legalName().trim(), displayName: this.displayName().trim(), slug: this.slug().trim(), description: this.description().trim(),
      logoUrl: this.logoUrl().trim(), email: this.email().trim(), phone: this.phone().trim(), website: this.website().trim(), city: this.city().trim(), country: this.country().trim(), saleTerms: this.saleTerms().trim(),
    };
  }

  protected async create(): Promise<void> {
    await this.run(async () => {
      const { legalName, displayName, slug } = this.form();
      await this.api.create({ legalName, displayName, slug });
      await this.load();
      this.message.set('Agenzia creata. Completa il profilo e invita il tuo team.');
    });
  }

  protected async save(): Promise<void> {
    const mine = this.mine();
    if (!mine) return;
    await this.run(async () => {
      const agency = await this.api.update(mine.agency.id, this.form());
      this.mine.set({ ...mine, agency });
      this.message.set('Profilo salvato.');
    });
  }

  protected goAccount(): void {
    location.assign('/account');
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await action();
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
