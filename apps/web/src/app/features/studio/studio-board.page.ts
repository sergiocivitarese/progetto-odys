import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi } from '../../core/api/catalog.api';
import { CreatorApi, type Post, type PostStatus } from '../../core/api/creator.api';
import { PostTileComponent } from '../../shared/travel/post-tile.component';
import { ButtonComponent, ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';

type Filter = 'all' | PostStatus;

/**
 * Bacheca privata del Creator Studio (C-21, C-22, C-24): griglia dei propri post
 * con stato, filtri e conto alla rovescia dei programmati.
 */
@Component({
  selector: 'odys-studio-board-page',
  imports: [RouterLink, PostTileComponent, ButtonComponent, ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="head">
        <div>
          <p class="eyebrow">Creator Studio</p>
          <h1>I tuoi contenuti</h1>
          <p class="muted">Racconta i tuoi viaggi con foto, video e caroselli. Le bozze e i post programmati li vedi solo tu.</p>
        </div>
        @if (state() === 'ready') {<button odysButton variant="accent" icon="plus" [loading]="creating()" (click)="create()">Nuovo post</button>}
      </header>

      @if (state() === 'loading') {
        <p class="muted"><odys-icon name="loader" /> Caricamento della bacheca…</p>
      } @else if (state() === 'not-coordinator') {
        <odys-empty-state icon="shield" title="Il Creator Studio è per i coordinatori" description="Candidati come coordinatore: dopo l’approvazione potrai pubblicare viaggi e contenuti." actionLabel="Diventa coordinatore" (action)="goCoordinator()" />
      } @else if (state() === 'guidelines') {
        <odys-notice tone="info" title="Accetta le linee guida">Prima di pubblicare contenuti accetta le linee guida del coordinatore nell’<a routerLink="/coordinatore">area coordinatore</a>.</odys-notice>
      } @else {
        @if (error()) {<odys-notice tone="danger">{{ error() }}</odys-notice>}
        <div class="filters" role="group" aria-label="Filtra per stato">
          @for (option of filters; track option.value) {
            <button odysChip [selected]="filter() === option.value" (click)="filter.set(option.value)">{{ option.label }} · {{ count(option.value) }}</button>
          }
        </div>
        <div class="grid">
          @for (post of visible(); track post.id) {
            <odys-post-tile [post]="post" [showStatus]="true" [now]="now()" />
          } @empty {
            <odys-empty-state class="span" icon="upload" title="Nessun contenuto qui" description="Crea il primo post: scegli le foto o i video, scrivi la didascalia e pubblicalo subito o più tardi." actionLabel="Nuovo post" (action)="create()" />
          }
        </div>
      }
    </div>
  `,
  styles: `
    .head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-6); h1 { font-size: var(--text-3xl); } > div { display: flex; flex-direction: column; gap: var(--space-2); } }
    .filters { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-4); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
    .span { grid-column: 1 / -1; }
    @media (min-width: 640px) { .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); } }
    @media (min-width: 1024px) { .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  `,
})
export default class StudioBoardPage implements OnInit {
  private readonly api = inject(CreatorApi);
  private readonly catalog = inject(CatalogApi);
  private readonly router = inject(Router);

  protected readonly state = signal<'loading' | 'not-coordinator' | 'guidelines' | 'ready'>('loading');
  protected readonly posts = signal<Post[]>([]);
  protected readonly error = signal('');
  protected readonly creating = signal(false);
  protected readonly filter = signal<Filter>('all');
  protected readonly now = signal(Date.now());
  protected readonly filters: Array<{ value: Filter; label: string }> = [
    { value: 'all', label: 'Tutti' },
    { value: 'draft', label: 'Bozze' },
    { value: 'scheduled', label: 'Programmati' },
    { value: 'published', label: 'Pubblicati' },
    { value: 'archived', label: 'Archiviati' },
  ];
  protected readonly visible = computed(() => this.filter() === 'all' ? this.posts() : this.posts().filter((post) => post.effectiveStatus === this.filter()));

  constructor() {
    // Il conto alla rovescia dei programmati si aggiorna ogni minuto.
    const timer = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  async ngOnInit(): Promise<void> {
    try {
      const status = await this.catalog.coordinatorStatus();
      if (!status.isCoordinator) { this.state.set('not-coordinator'); return; }
      if (!status.guidelinesAccepted) { this.state.set('guidelines'); return; }
      this.posts.set(await this.api.myPosts());
      this.state.set('ready');
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile caricare la bacheca.'));
      this.state.set('ready');
    }
  }

  protected count(filter: Filter): number {
    return filter === 'all' ? this.posts().length : this.posts().filter((post) => post.effectiveStatus === filter).length;
  }

  protected async create(): Promise<void> {
    this.creating.set(true);
    try {
      const post = await this.api.createPost();
      await this.router.navigate(['/studio', post.id]);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile creare il post.'));
    } finally {
      this.creating.set(false);
    }
  }

  protected goCoordinator(): void {
    void this.router.navigate(['/coordinatore']);
  }
}
