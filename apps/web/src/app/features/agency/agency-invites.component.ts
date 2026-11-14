import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AGENCY_ROLE_LABELS } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { AgencyApi, type AgencyInvite, type MyAgency } from '../../core/api/agency.api';
import { IconComponent, NoticeComponent } from '../../shared/ui';

/** Agenzia di appartenenza e inviti ricevuti (AG-05): l'invitato accetta o rifiuta dal proprio account. */
@Component({
  selector: 'odys-agency-invites',
  imports: [RouterLink, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (mine(); as m) {
      <a class="mine" [routerLink]="m.role === 'coordinator' ? ['/agenzie', m.agency.slug] : ['/agenzia/team']">
        <odys-icon name="users" [size]="20" />
        <span><strong>{{ m.agency.displayName }}</strong><span class="muted">Fai parte del team come {{ roleLabel(m.role) }}@if (m.linkType === 'licensed') { · con licenza Coordinatore Premium}</span></span>
        <odys-icon name="chevron-right" />
      </a>
    }
    @if (invites().length || message()) {
      <section class="invites" aria-labelledby="invites-title">
        <h2 id="invites-title"><odys-icon name="users" [size]="20" /> Inviti dalle agenzie</h2>
        @if (message()) {<odys-notice [tone]="tone()">{{ message() }}</odys-notice>}
        @for (invite of invites(); track invite.id) {
          <div class="invite">
            <p><strong><a [routerLink]="['/agenzie', invite.agencySlug]">{{ invite.agencyName }}</a></strong> ti invita nel suo team come <strong>{{ roleLabel(invite.role) }}</strong>.</p>
            @if (invite.role === 'coordinator') {<p class="muted">Entri come coordinatore associato: resti indipendente. L’agenzia potrà assegnarti una licenza Coordinatore Premium.</p>}
            <div class="actions">
              <button type="button" class="accept" [disabled]="busy() === invite.id" (click)="respond(invite, true)">Accetta</button>
              <button type="button" class="decline" [disabled]="busy() === invite.id" (click)="respond(invite, false)">Rifiuta</button>
            </div>
          </div>
        }
      </section>
    }
  `,
  styles: `
    .invites { display: flex; flex-direction: column; gap: var(--space-3); margin-bottom: var(--space-5); padding: var(--space-5); border-radius: var(--radius-lg); background: var(--color-primary-soft); border: var(--border-width) solid var(--color-border);
      h2 { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-lg); } }
    .mine { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); padding: var(--space-4); border-radius: var(--radius-lg); background: var(--odys-blue); color: #fff; text-decoration: none;
      > span { display: flex; flex-direction: column; flex: 1; min-width: 0; } .muted { color: rgb(255 255 255 / 0.85); } }
    .invite { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); border-radius: var(--radius-md); background: var(--color-surface); }
    .muted { color: var(--color-text-muted); font-size: var(--text-sm); }
    .actions { display: flex; gap: var(--space-2); }
    .accept, .decline { min-height: 44px; padding: 0 var(--space-5); border-radius: var(--radius-pill); font: inherit; font-weight: 800; cursor: pointer; }
    .accept { border: 0; background: var(--odys-ink); color: #fff; }
    .decline { border: var(--border-width) solid var(--color-border-strong); background: transparent; color: var(--color-text); }
  `,
})
export class AgencyInvitesComponent implements OnInit {
  private readonly api = inject(AgencyApi);
  protected readonly invites = signal<AgencyInvite[]>([]);
  /** Agenzia di cui si fa già parte (chi non ha il piano Agenzia non la trova nella barra). */
  protected readonly mine = signal<MyAgency | null>(null);
  protected readonly busy = signal('');
  protected readonly message = signal('');
  protected readonly tone = signal<'success' | 'danger'>('success');

  async ngOnInit(): Promise<void> {
    const [invites, mine] = await Promise.all([this.api.invites().catch(() => []), this.api.mine().catch(() => null)]);
    this.invites.set(invites);
    this.mine.set(mine);
  }

  protected roleLabel(role: AgencyInvite['role']): string {
    return AGENCY_ROLE_LABELS[role].toLowerCase();
  }

  protected async respond(invite: AgencyInvite, accept: boolean): Promise<void> {
    this.busy.set(invite.id);
    try {
      await this.api.respond(invite.id, accept);
      this.invites.update((list) => list.filter((item) => item.id !== invite.id));
      this.tone.set('success');
      this.message.set(accept ? `Ora fai parte del team di ${invite.agencyName}.` : 'Invito rifiutato.');
      if (accept) this.mine.set(await this.api.mine().catch(() => null));
    } catch (error) {
      this.tone.set('danger');
      this.message.set(apiErrorMessage(error));
    } finally {
      this.busy.set('');
    }
  }
}
