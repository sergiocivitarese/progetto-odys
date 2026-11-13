import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, initialsOf, type CoordinatorCard, type PublicReview, type PublishedTripSummary } from '../../core/api/catalog.api';
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
      <a routerLink="/cerca" class="back"><odys-icon name="arrow-left" [size]="16" /> Tutti i viaggi</a>
      @if (error()) {
        <odys-empty-state icon="user" title="Coordinatore non trovato" [description]="error()" />
      } @else if (coordinator(); as c) {
        <header class="head">
          <span class="avatar" aria-hidden="true">{{ initials() }}</span>
          <dl class="stats">
            <div><dd>{{ c.tripsCompleted ?? past().length }}</dd><dt>viaggi fatti</dt></div>
            <div><dd>@if (c.rating) {{{ rating() }}<span class="star">★</span>} @else {—}</dd><dt>{{ c.reviewsCount ?? 0 }} {{ c.reviewsCount === 1 ? 'recensione' : 'recensioni' }}</dt></div>
            <div><dd>{{ followersLabel() }}</dd><dt>follower</dt></div>
          </dl>
        </header>
        <h1>{{ c.displayName }}@if (c.memberSince) {<span class="since"> · Coordinatore dal {{ c.memberSince | date: 'y' }}</span>}</h1>
        @if (c.headline) {<p class="headline">{{ c.headline }}</p>}
        @if (c.bio) {<p class="bio">{{ c.bio }}</p>}
        @if (c.interests.length) {<ul class="tags">@for (tag of c.interests; track tag) {<li>{{ tag }}</li>}</ul>}
        <div class="actions">
          @if (!isMe()) {
            <button type="button" class="follow" [class.is-on]="following()" [attr.aria-pressed]="following()" [disabled]="busy()" (click)="toggleFollow()">{{ following() ? 'Segui già' : 'Segui' }}</button>
          }
          @if (upcoming().length) {<a class="departures" href="#prossimi">Viaggi in partenza · {{ upcoming().length }}</a>}
        </div>
        @if (reviews()[0]; as review) {
          <a class="quote" href="#recensioni">
            <span class="quote__avatar" aria-hidden="true">{{ review.authorInitials }}</span>
            <span><span class="stars" [attr.aria-label]="review.coordinatorRating + ' stelle su 5'">{{ stars(review.coordinatorRating) }}</span> <strong>{{ review.authorName }} · {{ review.tripDestination }}</strong><span class="quote__body">{{ review.body || 'Nessun commento' }}</span></span>
          </a>
        }
        <a class="report-link" routerLink="/segnala" [queryParams]="{ tipo: 'profilo', id: c.id }"><odys-icon name="alert-triangle" [size]="14" /> Segnala questo profilo</a>

        <h2 id="prossimi">Prossimi viaggi</h2>
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
        @if (reviews().length) {
          <h2 id="recensioni">Recensioni</h2>
          <ul class="reviews">
            @for (review of reviews(); track review.id) {
              <li>
                <span class="quote__avatar" aria-hidden="true">{{ review.authorInitials }}</span>
                <div>
                  <p><span class="stars" [attr.aria-label]="review.coordinatorRating + ' stelle su 5'">{{ stars(review.coordinatorRating) }}</span> <strong>{{ review.authorName }}</strong></p>
                  <p class="muted small">{{ review.tripTitle }}@if (review.tripEnd) { · {{ review.tripEnd | date: 'MMM y' }}}</p>
                  @if (review.body) {<p class="review__body">{{ review.body }}</p>}
                </div>
              </li>
            }
          </ul>
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
    .head { display: flex; gap: var(--space-5); align-items: center; margin-bottom: var(--space-5); }
    .avatar { display: grid; place-items: center; width: 96px; height: 96px; flex-shrink: 0; border-radius: 50%; background: var(--odys-ink); color: var(--odys-lime); font-weight: 900; font-size: var(--text-2xl); box-shadow: 0 0 0 4px var(--color-bg), 0 0 0 8px var(--odys-blue); }
    .stats { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); margin: 0; text-align: center;
      div { display: flex; flex-direction: column; min-width: 0; }
      dd { margin: 0; font-size: var(--text-2xl); font-weight: 900; font-variant-numeric: tabular-nums; }
      dt { font-size: var(--text-xs); color: var(--color-text-muted); font-weight: 600; line-height: 1.2; } }
    .star { color: var(--odys-coral); font-size: 0.8em; }
    h1 { font-size: var(--text-xl); }
    .since { font-weight: 700; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-5); }
    .follow, .departures { display: inline-flex; align-items: center; justify-content: center; flex: 1; min-width: 140px; min-height: 52px; padding: 0 var(--space-5); border-radius: var(--radius-lg); border: 0; font: inherit; font-weight: 900; text-decoration: none; cursor: pointer; }
    .follow { background: var(--odys-blue); color: #fff; }
    .follow.is-on { background: var(--color-surface); color: var(--color-text); box-shadow: inset 0 0 0 2px var(--color-border-strong); }
    .departures { background: var(--odys-lime); color: var(--odys-ink); }
    .quote { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-4); padding: var(--space-3) var(--space-4); border-radius: var(--radius-xl); background: var(--color-surface); border: var(--border-width) solid var(--color-border); color: var(--color-text); text-decoration: none;
      > span:last-child { min-width: 0; } strong { font-weight: 800; } }
    .quote__body { display: block; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .quote__avatar { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; border-radius: 50%; background: var(--odys-coral); color: var(--odys-ink); font-weight: 900; font-size: var(--text-sm); }
    .stars { color: var(--odys-coral); letter-spacing: 1px; }
    .reviews { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3);
      li { display: flex; gap: var(--space-3); padding: var(--space-4); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); } }
    .review__body { margin-top: var(--space-2); }
    .headline { font-size: var(--text-lg); }
    .small { font-size: var(--text-sm); }
    .bio { margin-top: var(--space-5); font-size: var(--text-lg); }
    .tags { list-style: none; margin: var(--space-4) 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2);
      li { padding: 4px 12px; border-radius: var(--radius-pill); background: var(--color-surface-muted); font-size: var(--text-sm); font-weight: 600; } }
    h2 { font-size: var(--text-xl); margin: var(--space-8) 0 var(--space-4); }
    .grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); }
    .report-link { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; margin-top: var(--space-3); font-size: var(--text-sm); color: var(--color-text-muted); }
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
  protected readonly reviews = signal<PublicReview[]>([]);
  protected readonly following = signal(false);
  protected readonly busy = signal(false);
  protected readonly isMe = computed(() => this.account.profile()?.id === this.id());
  protected readonly initials = computed(() => initialsOf(this.coordinator()?.displayName ?? ''));
  protected readonly rating = computed(() => this.coordinator()?.rating?.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  protected readonly followersLabel = computed(() => {
    const value = this.coordinator()?.followers ?? 0;
    return value >= 1000 ? `${(value / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })}k` : String(value);
  });
  protected readonly upcoming = computed(() => this.trips().filter((trip) => trip.effectiveStatus !== 'completed'));
  protected readonly past = computed(() => this.trips().filter((trip) => trip.effectiveStatus === 'completed'));

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(async () => {
        try {
          await this.auth.start();
          const result = await this.catalog.coordinator(id);
          this.reviews.set(result.reviews ?? []);
          this.following.set(result.following ?? false);
          this.coordinator.set(result.coordinator);
          this.trips.set(result.trips);
          this.posts.set(await this.creator.feed(id).catch(() => []));
        } catch (error) {
          this.error.set(apiErrorMessage(error, 'Profilo non disponibile.'));
        }
      });
    });
  }

  protected stars(value: number): string {
    return '★'.repeat(value) + '☆'.repeat(5 - value);
  }

  /** Segui (TB-11): senza accesso porta al login e poi torna qui. */
  protected async toggleFollow(): Promise<void> {
    await this.auth.start();
    if (!this.auth.isAuthenticated()) {
      await this.router.navigate(['/accedi'], { queryParams: { ritorno: `/coordinatori/${this.id()}` } });
      return;
    }
    const next = !this.following();
    this.busy.set(true);
    try {
      if (next) await this.catalog.follow(this.id()); else await this.catalog.unfollow(this.id());
      this.following.set(next);
      this.coordinator.update((card) => (card ? { ...card, followers: Math.max(0, (card.followers ?? 0) + (next ? 1 : -1)) } : card));
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile aggiornare.'));
    } finally {
      this.busy.set(false);
    }
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
