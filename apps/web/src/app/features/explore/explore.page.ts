import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-client';
import { CreatorApi, type Post } from '../../core/api/creator.api';
import { PostTileComponent } from '../../shared/travel/post-tile.component';
import { ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';

/**
 * Feed pubblico dei contenuti dei coordinatori (U-05, U-19): solo post pubblicati,
 * consultabile senza accesso (U-01). Paginazione per data di pubblicazione.
 */
@Component({
  selector: 'odys-explore-page',
  imports: [PostTileComponent, ButtonComponent, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="head">
        <p class="eyebrow">Esplora</p>
        <h1>Storie di viaggio dai coordinatori</h1>
        <p class="muted">Foto e video di chi organizza i viaggi di gruppo. Apri un post per vedere l’itinerario collegato.</p>
      </header>
      @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
      <div class="grid">
        @for (post of posts(); track post.id) {
          <odys-post-tile [post]="post" />
        } @empty {
          @if (!loading()) {
            <odys-empty-state class="span" icon="compass" title="Ancora nessun contenuto" description="I coordinatori stanno preparando i primi racconti. Intanto scopri i viaggi di gruppo." actionLabel="Viaggi di gruppo" (action)="goGroups()" />
          }
        }
      </div>
      @if (loading()) {<p class="muted"><odys-icon name="loader" /> Caricamento…</p>}
      @if (more() && !loading()) {<button odysButton variant="secondary" class="more" (click)="load()">Mostra altri</button>}
    </div>
  `,
  styles: `
    .head { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-6); h1 { font-size: var(--text-3xl); } }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
    .span { grid-column: 1 / -1; }
    .more { margin: var(--space-5) auto; display: flex; }
    @media (min-width: 640px) { .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); } }
    @media (min-width: 1024px) { .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  `,
})
export default class ExplorePage implements OnInit {
  private readonly api = inject(CreatorApi);
  private readonly router = inject(Router);
  protected readonly posts = signal<Post[]>([]);
  protected readonly loading = signal(false);
  protected readonly more = signal(false);
  protected readonly error = signal('');

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      const before = this.posts().at(-1)?.publishedAt;
      const page = await this.api.feed(undefined, before);
      this.posts.update((current) => [...current, ...page]);
      this.more.set(page.length >= 24);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Contenuti non disponibili in questo momento.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected goGroups(): void {
    void this.router.navigate(['/gruppi']);
  }
}
