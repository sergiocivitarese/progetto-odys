import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-client';
import { CreatorApi, type Post } from '../../core/api/creator.api';
import { AuthStore } from '../../core/auth/auth.store';
import { PostViewerComponent } from '../../shared/travel/post-viewer.component';
import { EmptyStateComponent, IconComponent, NoticeComponent } from '../../shared/ui';

/** Dettaglio pubblico di un post (U-19…U-21): like e salvataggi chiedono l'accesso (U-10, U-11). */
@Component({
  selector: 'odys-post-page',
  imports: [RouterLink, PostViewerComponent, EmptyStateComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a routerLink="/esplora" class="back"><odys-icon name="arrow-left" [size]="16" /> Esplora</a>
      @if (loading()) {
        <p class="muted"><odys-icon name="loader" /> Caricamento…</p>
      } @else if (post(); as p) {
        <odys-post-viewer [post]="p" (like)="toggle('like')" (save)="toggle('save')" (report)="report()" />
        @if (message()) {<odys-notice tone="info" class="message">{{ message() }}</odys-notice>}
      } @else {
        <odys-empty-state icon="compass" title="Contenuto non disponibile" [description]="error() || 'Il post potrebbe essere stato rimosso dal suo autore.'" />
      }
    </div>
  `,
  styles: `
    .back { display: inline-flex; align-items: center; gap: var(--space-1); margin-bottom: var(--space-4); color: var(--color-text-muted); text-decoration: none; }
    .message { margin-top: var(--space-4); }
  `,
})
export default class PostPage {
  private readonly api = inject(CreatorApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  readonly id = input.required<string>();
  protected readonly post = signal<Post | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly message = signal('');

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      await this.auth.start();
      this.post.set(await this.api.post(id));
    } catch (error) {
      this.error.set(apiErrorMessage(error, ''));
      this.post.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  private async ensureLoggedIn(): Promise<boolean> {
    await this.auth.start();
    if (this.auth.isAuthenticated()) return true;
    await this.router.navigate(['/accedi'], { queryParams: { ritorno: `/esplora/${this.id()}` } });
    return false;
  }

  protected async toggle(kind: 'like' | 'save'): Promise<void> {
    const post = this.post();
    if (!post || !(await this.ensureLoggedIn())) return;
    const on = kind === 'like' ? !post.liked : !post.saved;
    // Aggiornamento immediato, riallineato se il server rifiuta.
    this.post.set(kind === 'like' ? { ...post, liked: on, likes: post.likes + (on ? 1 : -1) } : { ...post, saved: on });
    try {
      await (kind === 'like' ? this.api.setLike(post.id, on) : this.api.setSave(post.id, on));
      if (kind === 'save') this.message.set(on ? 'Salvato: lo ritrovi nel tuo account.' : 'Rimosso dai contenuti salvati.');
    } catch (error) {
      this.post.set(post);
      this.message.set(apiErrorMessage(error));
    }
  }

  protected report(): void {
    void this.router.navigate(['/segnala'], { queryParams: { tipo: 'post', id: this.id() } });
  }
}
