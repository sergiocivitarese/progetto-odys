import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '../../core/api/api-client';
import { ACCOUNT_STATUS_LABELS, ModerationApi, ROLE_LABELS, type AccountRole, type AccountStatus, type AccountSummary } from '../../core/api/moderation.api';
import { ButtonComponent, IconComponent, NoticeComponent } from '../../shared/ui';
import { AdminNavComponent } from './admin-nav.component';

/** Gestione degli account (G-02): ricerca, ruolo e stato, ogni modifica nel registro attività. */
@Component({
  selector: 'odys-admin-accounts-page',
  imports: [DatePipe, FormsModule, AdminNavComponent, ButtonComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="head">
        <p class="eyebrow">Amministrazione</p>
        <h1>Account</h1>
      </header>
      <odys-admin-nav />
      <form class="search" role="search" (submit)="$event.preventDefault(); load()">
        <label class="visually-hidden" for="account-search">Cerca per nome o email</label>
        <input id="account-search" type="search" placeholder="Cerca per nome o email" [ngModel]="query()" (ngModelChange)="query.set($event)" name="q" />
        <button odysButton variant="secondary" type="submit" icon="search">Cerca</button>
      </form>
      @if (message()) {<odys-notice [tone]="messageTone()">{{ message() }}</odys-notice>}
      @if (loading()) {
        <p class="muted"><odys-icon name="loader" /> Caricamento…</p>
      } @else {
        <div class="table-wrap">
          <table>
            <caption class="visually-hidden">Account trovati</caption>
            <thead><tr><th scope="col">Persona</th><th scope="col">Ruolo</th><th scope="col">Stato</th><th scope="col">Dal</th><th scope="col"><span class="visually-hidden">Azioni</span></th></tr></thead>
            <tbody>
              @for (account of accounts(); track account.id) {
                <tr>
                  <td><strong>{{ account.firstName }} {{ account.lastName }}</strong><br /><span class="muted small">{{ account.email }}</span></td>
                  <td>
                    <label class="visually-hidden" [for]="'role-' + account.id">Ruolo di {{ account.firstName }}</label>
                    <select [id]="'role-' + account.id" [ngModel]="draft(account).role" (ngModelChange)="edit(account, { role: $event })">
                      @for (role of roles; track role) {<option [value]="role">{{ roleLabels[role] }}</option>}
                    </select>
                  </td>
                  <td>
                    <label class="visually-hidden" [for]="'status-' + account.id">Stato di {{ account.firstName }}</label>
                    <select [id]="'status-' + account.id" [ngModel]="draft(account).status" (ngModelChange)="edit(account, { status: $event })">
                      @for (status of statuses; track status) {<option [value]="status">{{ statusLabels[status] }}</option>}
                    </select>
                  </td>
                  <td class="small">{{ account.createdAt | date: 'd MMM y' }}</td>
                  <td>@if (changed(account)) {<button odysButton variant="accent" size="sm" [disabled]="busy() === account.id" (click)="save(account)">Salva</button>}</td>
                </tr>
              } @empty {
                <tr><td colspan="5" class="muted">Nessun account trovato.</td></tr>
              }
            </tbody>
          </table>
        </div>
        <p class="muted small">Ogni modifica di ruolo o stato viene registrata. Un account sospeso perde le funzioni da coordinatore finché non viene riattivato.</p>
      }
    </div>
  `,
  styles: `
    .head { margin-bottom: var(--space-4); h1 { font-size: var(--text-3xl); } }
    .search { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-4); input { flex: 1; min-width: 220px; min-height: 44px; padding: 0 var(--space-4); border-radius: var(--radius-pill); border: var(--border-width) solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); font: inherit; } }
    .table-wrap { overflow-x: auto; border-radius: var(--radius-lg); border: var(--border-width) solid var(--color-border); background: var(--color-surface); }
    table { width: 100%; border-collapse: collapse; min-width: 640px; }
    th, td { padding: var(--space-3) var(--space-4); text-align: left; border-bottom: var(--border-width) solid var(--color-border); vertical-align: middle; }
    th { font-size: var(--text-sm); color: var(--color-text-muted); }
    select { min-height: 40px; padding: 0 var(--space-2); border-radius: var(--radius-sm); border: var(--border-width) solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); font: inherit; }
    .small { font-size: var(--text-sm); }
    p.small { margin-top: var(--space-3); }
  `,
})
export default class AdminAccountsPage implements OnInit {
  private readonly api = inject(ModerationApi);
  protected readonly roles: AccountRole[] = ['traveler', 'coordinator', 'agency', 'admin'];
  protected readonly statuses: AccountStatus[] = ['active', 'suspended', 'disabled'];
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly statusLabels = ACCOUNT_STATUS_LABELS;
  protected readonly accounts = signal<AccountSummary[]>([]);
  protected readonly drafts = signal<Record<string, { role: AccountRole; status: AccountStatus }>>({});
  protected readonly query = signal('');
  protected readonly loading = signal(true);
  protected readonly busy = signal('');
  protected readonly message = signal('');
  protected readonly messageTone = signal<'success' | 'danger'>('success');

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.accounts.set(await this.api.accounts(this.query().trim()));
      this.drafts.set({});
    } catch (error) {
      this.messageTone.set('danger');
      this.message.set(apiErrorMessage(error, 'Account non disponibili.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected draft(account: AccountSummary) { return this.drafts()[account.id] ?? { role: account.role, status: account.status }; }
  protected changed(account: AccountSummary): boolean { const d = this.drafts()[account.id]; return !!d && (d.role !== account.role || d.status !== account.status); }
  protected edit(account: AccountSummary, change: Partial<{ role: AccountRole; status: AccountStatus }>): void {
    this.drafts.update((current) => ({ ...current, [account.id]: { ...this.draft(account), ...change } }));
  }

  protected async save(account: AccountSummary): Promise<void> {
    const d = this.draft(account);
    const note = prompt('Motivo della modifica (finisce nel registro attività):') ?? '';
    this.busy.set(account.id);
    try {
      const updated = await this.api.updateAccount(account.id, { role: d.role !== account.role ? d.role : undefined, status: d.status !== account.status ? d.status : undefined }, note.trim());
      this.accounts.update((list) => list.map((item) => item.id === updated.id ? updated : item));
      this.drafts.update((current) => { const next = { ...current }; delete next[account.id]; return next; });
      this.messageTone.set('success');
      this.message.set(`Account di ${updated.firstName} aggiornato.`);
    } catch (error) {
      this.messageTone.set('danger');
      this.message.set(apiErrorMessage(error, 'Modifica non salvata.'));
    } finally {
      this.busy.set('');
    }
  }
}
