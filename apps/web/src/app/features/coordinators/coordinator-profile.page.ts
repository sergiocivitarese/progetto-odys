import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, initialsOf, type CoordinatorCard, type PublicReview, type PublishedTripSummary } from '../../core/api/catalog.api';
import { AuthStore } from '../../core/auth/auth.store';
import { AccountStore } from '../../core/state/account.store';
import { CreatorApi, type Post } from '../../core/api/creator.api';
import { PostTileComponent } from '../../shared/travel/post-tile.component';
import { EmptyStateComponent, IconComponent } from '../../shared/ui';

/** Profilo pubblico del coordinatore (U-09, C-06…C-08): presentazione, viaggi pubblicati e contenuti. */
@Component({
  selector: 'odys-coordinator-profile-page',
  imports: [DatePipe, RouterLink, PostTileComponent, EmptyStateComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a routerLink="/cerca" class="back"><odys-icon name="arrow-left" [size]="16" /> Tutti i viaggi</a>
      @if (error()) {
        <odys-empty-state icon="user" title="Coordinatore non trovato" [description]="error()" />
      } @else if (coordinator(); as c) {
        <header class="head">
          <span class="avatar">
            @if (c.avatarUrl) {<img [src]="c.avatarUrl" alt="" />} @else {<span aria-hidden="true">{{ initials() }}</span>}
            @if (c.verified) {<span class="avatar__badge" title="Coordinatore verificato da Odys"><odys-icon name="verified" [size]="18" /></span>}
          </span>
          <dl class="stats">
            <div><dd>{{ c.tripsCompleted ?? past().length }}</dd><dt>viaggi fatti</dt></div>
            <div><dd>@if (c.rating) {{{ rating() }}<span class="star">★</span>} @else {—}</dd><dt>{{ c.reviewsCount ?? 0 }} {{ c.reviewsCount === 1 ? 'recensione' : 'recensioni' }}</dt></div>
            <div><dd>{{ followersLabel() }}</dd><dt>follower</dt></div>
          </dl>
        </header>
        <h1>{{ c.displayName }}@if (c.verified) {<span class="verified"><odys-icon name="verified" [size]="18" /><span class="sr-only">verificato</span></span>}</h1>
        <p class="meta">@if (c.verified) {Coordinatore verificato}@else {Coordinatore Odys}@if (c.memberSince) { · dal {{ c.memberSince | date: 'y' }}}</p>
        @if (c.headline) {<p class="headline">{{ c.headline }}</p>}
        @if (c.bio) {<p class="bio">{{ c.bio }}</p>}
        @if (c.interests.length || c.languages?.length) {
          <ul class="tags" aria-label="Interessi e lingue">
            @for (tag of c.interests; track tag) {<li>{{ tag }}</li>}
            @for (lang of c.languages ?? []; track lang) {<li class="tag--lang"><odys-icon name="message" [size]="13" /> {{ lang }}</li>}
          </ul>
        }
        <div class="actions">
          @if (!isMe()) {
            <button type="button" class="follow" [class.is-on]="following()" [attr.aria-pressed]="following()" [disabled]="busy()" (click)="toggleFollow()">{{ following() ? 'Segui già' : 'Segui' }}</button>
          }
          @if (upcoming().length) {<button type="button" class="departures" (click)="tab.set('trips')">Viaggi in partenza · {{ upcoming().length }}</button>}
        </div>

        @if (highlights().length) {
          <ul class="highlights" aria-label="Highlight dei viaggi">
            @for (trip of highlights(); track trip.id) {
              <li>
                <a [routerLink]="['/gruppi', trip.id]" class="hl">
                  <span class="hl__ring" [class.hl__ring--done]="trip.effectiveStatus === 'completed'">
                    @if (trip.coverImageUrl) {<img [src]="trip.coverImageUrl" alt="" loading="lazy" />} @else {<span class="hl__initial" aria-hidden="true">{{ trip.destination.slice(0, 1) }}</span>}
                  </span>
                  <span class="hl__label">{{ trip.destination }}</span>
                </a>
              </li>
            }
          </ul>
        }

        <div class="tabs" role="tablist" aria-label="Contenuti del profilo">
          @for (item of tabs(); track item.id) {
            <button type="button" role="tab" class="tab" [id]="'tab-' + item.id" [attr.aria-selected]="tab() === item.id" [attr.aria-controls]="'panel-' + item.id" [attr.aria-label]="item.label + (item.count ? ', ' + item.count : '')" [class.is-on]="tab() === item.id" (click)="tab.set(item.id)">
              <odys-icon [name]="item.icon" [size]="18" /><span>{{ item.label }}</span>@if (item.count) {<span class="tab__count">{{ item.count }}</span>}
            </button>
          }
        </div>

        <section class="panel" role="tabpanel" [id]="'panel-' + tab()" [attr.aria-labelledby]="'tab-' + tab()">
          @switch (tab()) {
            @case ('posts') {
              <div class="grid45">
                @for (post of posts(); track post.id) {<odys-post-tile [post]="post" ratio="portrait" />}
                @empty {<p class="muted empty">Ancora nessun post.</p>}
              </div>
            }
            @case ('videos') {
              <div class="grid45">
                @for (post of videos(); track post.id) {<odys-post-tile [post]="post" ratio="portrait" />}
                @empty {<p class="muted empty">Ancora nessun video.</p>}
              </div>
            }
            @case ('trips') {
              <div class="grid45">
                @for (trip of tripsOrdered(); track trip.id) {
                  <a class="trip" [routerLink]="['/gruppi', trip.id]" [class.trip--done]="trip.effectiveStatus === 'completed'">
                    @if (trip.coverImageUrl) {<img [src]="trip.coverImageUrl" alt="" loading="lazy" />}
                    <span class="trip__shade"></span>
                    <span class="trip__state">{{ trip.effectiveStatus === 'completed' ? 'Svolto' : trip.effectiveStatus === 'active' ? 'In corso' : 'In partenza' }}</span>
                    <span class="trip__text">
                      <strong>{{ trip.destination }}</strong>
                      <span>{{ trip.startDate ? (trip.startDate | date: 'd MMM y') : 'Date in arrivo' }}</span>
                    </span>
                  </a>
                } @empty {<p class="muted empty">Nessun viaggio da mostrare.</p>}
              </div>
            }
            @case ('reviews') {
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
                } @empty {<li class="muted empty">Ancora nessuna recensione.</li>}
              </ul>
            }
          }
        </section>

        <a class="report-link" routerLink="/segnala" [queryParams]="{ tipo: 'profilo', id: c.id }"><odys-icon name="alert-triangle" [size]="14" /> Segnala questo profilo</a>
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
    .avatar { position: relative; overflow: visible; img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; } }
    .avatar__badge { position: absolute; right: -2px; bottom: -2px; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--odys-blue); color: #fff; box-shadow: 0 0 0 3px var(--color-bg); }
    .verified { display: inline-flex; vertical-align: -2px; margin-left: 6px; color: var(--odys-blue); }
    .meta { margin-top: 2px; font-size: var(--text-sm); font-weight: 700; color: var(--color-text-muted); }
    .tag--lang { display: inline-flex; align-items: center; gap: 4px; background: var(--color-primary-soft) !important; color: var(--color-link); }
    .highlights { display: flex; gap: var(--space-4); margin: var(--space-6) calc(-1 * var(--layout-gutter, 16px)) 0; padding: 0 var(--layout-gutter, 16px) var(--space-2); list-style: none; overflow-x: auto; scrollbar-width: none; }
    .hl { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 72px; color: var(--color-text); text-decoration: none; }
    .hl__ring { display: grid; place-items: center; width: 68px; height: 68px; padding: 3px; border-radius: 50%; background: conic-gradient(from 40deg, var(--odys-blue) 0 300deg, transparent 300deg 330deg, var(--odys-coral) 330deg 360deg);
      img, .hl__initial { width: 100%; height: 100%; border-radius: 50%; border: 3px solid var(--color-bg); object-fit: cover; } }
    .hl__ring--done { background: var(--color-border-strong); }
    .hl__initial { display: grid; place-items: center; background: var(--odys-ink); color: var(--odys-lime); font-weight: 900; font-size: var(--text-xl); }
    .hl__label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); font-weight: 700; }
    .tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: var(--space-6); border-bottom: var(--border-width) solid var(--color-border); }
    .tab { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 48px; padding: 0 4px; border: 0; border-bottom: 3px solid transparent; background: none; color: var(--color-text-muted); font: inherit; font-size: var(--text-sm); font-weight: 800; cursor: pointer;
      &.is-on { color: var(--color-text); border-bottom-color: var(--color-text); } }
    .tab__count { font-size: var(--text-xs); font-weight: 700; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
    @media (max-width: 479px) { .tab span:not(.tab__count) { display: none; } .tab.is-on span { display: inline; } }
    .panel { padding-top: var(--space-3); }
    .grid45 { display: grid; gap: 4px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    @media (max-width: 479px) { .grid45 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .empty { grid-column: 1 / -1; padding: var(--space-6) 0; text-align: center; }
    .trip { position: relative; display: block; aspect-ratio: 4 / 5; overflow: hidden; border-radius: var(--radius-md); background: var(--odys-blue); color: #fff; text-decoration: none;
      img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; } }
    .trip--done { background: var(--odys-ink); }
    .trip__shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgb(18 18 18 / 0) 40%, rgb(18 18 18 / 0.75)); }
    .trip__state { position: absolute; top: 8px; left: 8px; padding: 2px 8px; border-radius: var(--radius-pill); background: var(--odys-lime); color: var(--odys-ink); font-size: var(--text-xs); font-weight: 800; }
    .trip--done .trip__state { background: rgb(255 255 255 / 0.85); }
    .trip__text { position: absolute; left: 10px; right: 10px; bottom: 10px; display: flex; flex-direction: column; gap: 2px;
      strong { font-family: var(--font-brand); font-weight: 900; font-size: var(--text-lg); line-height: 1.05; text-transform: uppercase; letter-spacing: -0.02em; overflow-wrap: anywhere; }
      span { font-size: var(--text-xs); font-weight: 600; opacity: 0.9; } }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
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
  /** Schede del feed (CB-09). Si apre su Post se ci sono contenuti, altrimenti su Viaggi. */
  protected readonly tab = signal<'posts' | 'videos' | 'trips' | 'reviews' | null>(null);
  protected readonly videos = computed(() => this.posts().filter((post) => post.media.some((media) => media.kind === 'video')));
  protected readonly tripsOrdered = computed(() => [...this.upcoming(), ...this.past()]);
  /** Highlight: i prossimi viaggi e poi gli ultimi svolti, come cerchi da scorrere. */
  protected readonly highlights = computed(() => [...this.upcoming(), ...this.past()].slice(0, 12));
  protected readonly tabs = computed(() => [
    { id: 'posts' as const, label: 'Post', icon: 'grid' as const, count: this.posts().length },
    { id: 'videos' as const, label: 'Video', icon: 'play' as const, count: this.videos().length },
    { id: 'trips' as const, label: 'Viaggi', icon: 'bag' as const, count: this.trips().length },
    { id: 'reviews' as const, label: 'Recensioni', icon: 'star' as const, count: this.reviews().length },
  ]);
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
          if (!this.tab()) this.tab.set(this.posts().length ? 'posts' : 'trips');
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
}
