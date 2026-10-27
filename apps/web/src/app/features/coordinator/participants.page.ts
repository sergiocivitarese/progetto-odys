import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, PARTICIPATION_STATUS_LABELS, type Participant, type ParticipationStatus, type PublishedTrip } from '../../core/api/catalog.api';
import { ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';

/**
 * Partecipanti di un viaggio pubblicato (C-15): richieste ricevute, conferma o
 * rifiuto nel limite dei posti. Il contatto compare solo dopo la conferma (S-04).
 */
@Component({
  selector: 'odys-participants-page',
  imports: [DatePipe, RouterLink, ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a [routerLink]="['/coordinatore', id()]" class="back"><odys-icon name="arrow-left" [size]="16" /> Torna al viaggio</a>
      <header class="head">
        <p class="eyebrow">Partecipanti</p>
        <h1>{{ trip()?.title ?? 'Viaggio' }}</h1>
        @if (trip(); as t) {
          <p class="muted">{{ confirmed().length }} confermati su {{ t.capacity ?? '—' }} posti · {{ pending().length }} richieste in attesa</p>
        }
      </header>

      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
      @if (loading()) {
        <p class="muted"><odys-icon name="loader" /> Caricamento delle richieste…</p>
      } @else if (!participants().length && !error()) {
        <odys-empty-state icon="users" title="Nessuna richiesta per ora" description="Quando un viaggiatore chiede di partecipare dalla pagina del viaggio, la richiesta compare qui." />
      } @else {
        @for (group of groups(); track group.title) {
          @if (group.items.length) {
            <section>
              <h2>{{ group.title }} · {{ group.items.length }}</h2>
              <ul class="rows">
                @for (person of group.items; track person.id) {
                  <li class="row">
                    <span class="avatar" aria-hidden="true">{{ person.firstName[0] }}</span>
                    <div class="row__main">
                      <strong>{{ person.firstName }} {{ person.lastName }}</strong>
                      <span class="muted small">{{ label(person.status) }} · richiesta del {{ person.createdAt | date: 'd MMM y' }}</span>
                      @if (person.email) {<a class="small" [href]="'mailto:' + person.email"><odys-icon name="mail" [size]="14" /> {{ person.email }}</a>}
                      @if (person.message) {<p class="message">“{{ person.message }}”</p>}
                    </div>
                    @if (person.status !== 'withdrawn') {
                      <div class="actions">
                        @if (person.status !== 'confirmed') {
                          <button odysButton variant="accent" size="sm" icon="check" [disabled]="busy() === person.id" (click)="decide(person, 'confirm')">Conferma</button>
                        }
                        @if (person.status !== 'declined') {
                          <button odysButton variant="ghost" size="sm" icon="x" [disabled]="busy() === person.id" (click)="decide(person, 'decline')">{{ person.status === 'confirmed' ? 'Annulla conferma' : 'Rifiuta' }}</button>
                        }
                      </div>
                    }
                  </li>
                }
              </ul>
            </section>
          }
        }
      }
    </div>
  `,
  styles: `
    .back { display: inline-flex; align-items: center; gap: var(--space-1); margin-bottom: var(--space-4); color: var(--color-text-muted); text-decoration: none; }
    .head { margin-bottom: var(--space-6); h1 { font-size: var(--text-3xl); } }
    section { margin-bottom: var(--space-6); h2 { font-size: var(--text-lg); margin-bottom: var(--space-3); } }
    .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
    .row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-4); padding: var(--space-4); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); }
    .row__main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 220px; a { display: inline-flex; align-items: center; gap: var(--space-1); } }
    .avatar { display: grid; place-items: center; width: 44px; height: 44px; flex-shrink: 0; border-radius: var(--radius-md); background: var(--color-accent); color: var(--color-on-accent); font-family: var(--font-brand); font-weight: 800; }
    .message { margin-top: var(--space-2); padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface-muted); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .small { font-size: var(--text-sm); }
  `,
})
export default class ParticipantsPage {
  private readonly api = inject(CatalogApi);
  readonly id = input.required<string>();

  protected readonly trip = signal<PublishedTrip | null>(null);
  protected readonly participants = signal<Participant[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly busy = signal('');
  protected readonly pending = computed(() => this.participants().filter((item) => item.status === 'pending'));
  protected readonly confirmed = computed(() => this.participants().filter((item) => item.status === 'confirmed'));
  protected readonly groups = computed(() => [
    { title: 'In attesa di risposta', items: this.pending() },
    { title: 'Confermati', items: this.confirmed() },
    { title: 'Non accettati o ritirati', items: this.participants().filter((item) => item.status === 'declined' || item.status === 'withdrawn') },
  ]);

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [trip, participants] = await Promise.all([this.api.myPublishedTrip(id), this.api.participants(id)]);
      this.trip.set(trip);
      this.participants.set(participants);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile caricare i partecipanti.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected label(status: ParticipationStatus): string {
    return PARTICIPATION_STATUS_LABELS[status];
  }

  protected async decide(person: Participant, decision: 'confirm' | 'decline'): Promise<void> {
    this.busy.set(person.id);
    this.error.set('');
    try {
      await this.api.decideParticipant(this.id(), person.id, decision);
      // Ricarica: dopo la conferma il server espone anche il contatto.
      this.participants.set(await this.api.participants(this.id()));
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile aggiornare la richiesta.'));
    } finally {
      this.busy.set('');
    }
  }
}
