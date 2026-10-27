import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, type CoordinatorCard, type PublishedTripSummary } from '../../core/api/catalog.api';
import { AuthStore } from '../../core/auth/auth.store';
import { AccountStore } from '../../core/state/account.store';
import { CreatorApi, type Post } from '../../core/api/creator.api';
import { PostTileComponent } from '../../shared/travel/post-tile.component';
import { PublishedTripCardComponent } from '../../shared/travel/published-trip-card.component';
import { EmptyStateComponent, IconComponent } from '../../shared/ui';

/** Profilo pubblico del coordinatore (U-09, C-06…C-08): presentazione, viaggi pubblicati e contenuti. */
@Component({
  selector: 'odys-coordinator-profile-page',
  imports: [DatePipe, RouterLink, PublishedTripCardComponent, PostTileComponent, EmptyStateComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a routerLink="/gruppi" class="back"><odys-icon name="arrow-left" [size]="16" /> Viaggi di gruppo</a>
      @if (error()) {
        <odys-empty-state icon="user" title="Coordinatore non trovato" [description]="error()" />
      } @else if (coordinator(); as c) {
        <header class="head">
          <span class="avatar" aria-hidden="true">{{ c.displayName[0] }}</span>
          <div>
            <p class="eyebrow">Coordinatore Odys</p>
            <h1>{{ c.displayName }}</h1>
            @if (c.headline) {<p class="headline">{{ c.headline }}</p>}
            @if (c.memberSince) {<p class="muted small">Su Odys da {{ c.memberSince | date: 'MMMM y' }} · {{ upcoming().length }} viaggi in programma · {{ past().length }} svolti</p>}
          </div>
        </header>
        @if (c.bio) {<p class="bio">{{ c.bio }}</p>}
        @if (c.interests.length) {<ul class="tags">@for (tag of c.interests; track tag) {<li>{{ tag }}</li>}</ul>}

        <h2>Prossimi viaggi</h2>
        <div class="grid">
          @for (trip of upcoming(); track trip.id) {
            <odys-published-trip-card [trip]="trip" [saved]="account.savedTrips().has(trip.id)" (toggleSave)="toggleSaved($event)" />
          } @empty {
            <p class="muted">Nessun viaggio in programma al momento.</p>
          }
        </div>
        @if (posts().length) {
          <h2>Contenuti</h2>
          <div class="posts">
            @for (post of posts(); track post.id) {<odys-post-tile [post]="post" />}
          </div>
        }
        @if (past().length) {
          <h2>Viaggi svolti</h2>
          <div class="grid">
            @for (trip of past(); track trip.id) {<odys-published-trip-card [trip]="trip" [showSave]="false" />}
          </div>
        }
      }
    </div>
  `,
  styles: `
    .back { display: inline-flex; align-items: center; gap: 6px; margin-bottom: var(--space-4); color: var(--color-text-muted); font-size: var(--text-sm); font-weight: 600; text-decoration: none; }
    .head { display: flex; gap: var(--space-5); align-items: center; }
    .avatar { display: grid; place-items: center; width: 88px; height: 88px; flex-shrink: 0; border-radius: var(--radius-xl); background: var(--color-accent); color: var(--color-on-accent); font-family: var(--font-brand); font-weight: 800; font-size: var(--text-3xl); }
    h1 { font-size: var(--text-3xl); }
    .headline { font-size: var(--text-lg); }
    .small { font-size: var(--text-sm); }
    .bio { margin-top: var(--space-5); font-size: var(--text-lg); }
    .tags { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2);
      li { padding: 4px 12px; border-radius: var(--radius-pill); background: var(--color-surface-muted); font-size: var(--text-sm); font-weight: 600; } }
    h2 { font-size: var(--text-xl); margin: var(--space-8) 0 var(--space-4); }
    .grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); }
    .posts { display: grid; gap: var(--space-2); grid-template-columns: repeat(auto-fill, minmax(min(45%, 200px), 1fr)); }
  `,
})
export default class CoordinatorProfilePage {
  private readonly catalog = inject(CatalogApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  protected readonly account = inject(AccountStore);
  readonly id = input.required<string>();

  protected readonly coordinator = signal<CoordinatorCard | null>(null);
  protected readonly trips = signal<PublishedTripSummary[]>([]);
  protected readonly posts = signal<Post[]>([]);
  private readonly creator = inject(CreatorApi);
  protected readonly error = signal('');
  protected readonly upcoming = computed(() => this.trips().filter((trip) => trip.effectiveStatus !== 'completed'));
  protected readonly past = computed(() => this.trips().filter((trip) => trip.effectiveStatus === 'completed'));

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(async () => {
        try {
          const result = await this.catalog.coordinator(id);
          this.coordinator.set(result.coordinator);
          this.trips.set(result.trips);
          this.posts.set(await this.creator.feed(id).catch(() => []));
        } catch (error) {
          this.error.set(apiErrorMessage(error, 'Profilo non disponibile.'));
        }
      });
    });
  }

  protected async toggleSaved(id: string): Promise<void> {
    await this.auth.start();
    if (!this.auth.isAuthenticated()) {
      await this.router.navigate(['/accedi'], { queryParams: { ritorno: `/coordinatori/${this.id()}` } });
      return;
    }
    await this.account.toggleSavedTrip(id).catch(() => undefined);
  }
}
