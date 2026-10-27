import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { LocationNode } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, type PublishedTrip } from '../../core/api/catalog.api';
import { CreatorApi, POST_STATUS_LABELS, type Post, type PostAction, type PostMedia } from '../../core/api/creator.api';
import { AuthStore } from '../../core/auth/auth.store';
import { MAX_MEDIA_PER_POST, prepareMedia } from '../../core/media/media-processing';
import { countdown } from '../../shared/travel/post-tile.component';
import { PlaceFieldComponent } from '../../shared/travel/place-field.component';
import { PostViewerComponent } from '../../shared/travel/post-viewer.component';
import { ButtonComponent, IconComponent, NoticeComponent } from '../../shared/ui';

const CAPTION_MAX = 2200;

/**
 * Editor e dettaglio privato di un post (C-19…C-29): media con anteprima 4:5,
 * didascalia, luogo, itinerario collegato, diritti (M-05) e azioni per stato.
 */
@Component({
  selector: 'odys-post-editor-page',
  imports: [DatePipe, FormsModule, RouterLink, PlaceFieldComponent, PostViewerComponent, ButtonComponent, IconComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a routerLink="/studio" class="back"><odys-icon name="arrow-left" [size]="16" /> Creator Studio</a>

      @if (loading()) {
        <p class="muted"><odys-icon name="loader" /> Caricamento del post…</p>
      } @else if (post(); as p) {
        <header class="head">
          <div>
            <p class="eyebrow">{{ statusLabel() }}@if (p.effectiveStatus === 'scheduled' && p.scheduledFor) { · {{ p.scheduledFor | date: 'd MMM y, HH:mm' }} ({{ eta() }})}</p>
            <h1>{{ p.status === 'draft' ? 'Bozza' : 'Il tuo post' }}</h1>
          </div>
          @if (p.effectiveStatus === 'published') {<a odysButton variant="secondary" icon="arrow-up-right" [routerLink]="['/esplora', p.id]">Vedi come lo vede il pubblico</a>}
        </header>

        @if (message()) {<odys-notice [tone]="messageTone()">{{ message() }}</odys-notice>}

        <div class="layout">
          <section class="preview" aria-label="Anteprima">
            <odys-post-viewer [post]="p" [interactive]="false" />
          </section>

          <section class="form">
            <div class="group">
              <h2>Foto e video <small>{{ p.media.length }}/{{ maxMedia }}</small></h2>
              @if (p.media.length) {
                <ol class="media">
                  @for (media of p.media; track media.id; let i = $index) {
                    <li [class.is-failed]="media.status === 'failed'">
                      @if (media.urls?.thumbnail) {<img [src]="media.urls?.thumbnail" alt="" />} @else {<span class="thumb-placeholder"><odys-icon [name]="media.status === 'failed' ? 'alert-triangle' : 'loader'" [size]="16" /></span>}
                      <span class="media__label">{{ i + 1 }}. {{ media.kind === 'video' ? 'Video' : 'Foto' }}@if (media.status !== 'ready') { · {{ media.status === 'failed' ? 'non caricato' : 'in caricamento' }}}</span>
                      @if (editableMedia()) {
                        <span class="media__actions">
                          <button type="button" class="icon-btn" (click)="move(i, -1)" [disabled]="i === 0 || busy()" [attr.aria-label]="'Sposta prima il media ' + (i + 1)"><odys-icon name="arrow-up" [size]="16" /></button>
                          <button type="button" class="icon-btn" (click)="move(i, 1)" [disabled]="i === p.media.length - 1 || busy()" [attr.aria-label]="'Sposta dopo il media ' + (i + 1)"><odys-icon name="arrow-down" [size]="16" /></button>
                          <button type="button" class="icon-btn" (click)="removeMedia(media)" [disabled]="busy()" [attr.aria-label]="'Elimina il media ' + (i + 1)"><odys-icon name="trash" [size]="16" /></button>
                        </span>
                      }
                    </li>
                  }
                </ol>
              }
              @if (editableMedia()) {
                @if (p.media.length < maxMedia) {
                  <label class="upload" [class.is-busy]="uploading()">
                    <odys-icon [name]="uploading() ? 'loader' : 'upload'" />
                    <span>{{ uploading() ? uploadProgress() : 'Aggiungi foto o video' }}</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm" multiple (change)="upload($event)" [disabled]="uploading()" />
                  </label>
                  <p class="hint">Fino a {{ maxMedia }} elementi · foto fino a 15 MB, video fino a 60 secondi e 100 MB. Le foto vengono ottimizzate automaticamente; nella griglia la copertina è ritagliata al centro.</p>
                }
              } @else {
                <p class="hint">Per cambiare foto e video riporta il post in bozza.</p>
              }
            </div>

            <div class="group">
              <label class="label" for="caption">Didascalia</label>
              <textarea id="caption" rows="5" [maxlength]="captionMax" [ngModel]="caption()" (ngModelChange)="caption.set($event); dirty.set(true)" placeholder="Racconta il momento, il luogo, cosa consigli…"></textarea>
              <p class="hint counter">{{ caption().length }}/{{ captionMax }}</p>
            </div>

            <odys-place-field label="Luogo" placeholder="Dove è stato scattato?" kind="point" icon="map-pin"
              [value]="locationText()" (valueChange)="setLocationText($event)" [selected]="locationNode()" (pick)="pickLocation($event)" hint="Facoltativo" />

            <div class="group">
              <label class="label" for="trip">Itinerario collegato</label>
              <select id="trip" [ngModel]="tripId()" (ngModelChange)="tripId.set($event); dirty.set(true)">
                <option value="">Nessuno</option>
                @for (trip of trips(); track trip.id) {<option [value]="trip.id">{{ trip.title }}</option>}
              </select>
              <p class="hint">Chi vede il post può aprire il viaggio e usarlo come base. Gli itinerari a pagamento arriveranno con i pagamenti online.</p>
            </div>

            <label class="check">
              <input type="checkbox" [ngModel]="rights()" (ngModelChange)="rights.set($event); dirty.set(true)" />
              <span>Dichiaro di essere autore dei contenuti o di avere i diritti per pubblicarli, e il consenso delle persone riconoscibili. Odys può rimuovere i contenuti segnalati che violano le linee guida.</span>
            </label>

            <div class="actions">
              @if (dirty()) {<button odysButton variant="secondary" icon="check" [loading]="busy()" (click)="save()">Salva modifiche</button>}
              @switch (p.effectiveStatus) {
                @case ('draft') {
                  <button odysButton variant="accent" icon="zap" [loading]="busy()" (click)="act('publish')">Pubblica ora</button>
                }
                @case ('scheduled') {
                  <button odysButton variant="accent" icon="zap" [loading]="busy()" (click)="act('publish')">Pubblica ora</button>
                  <button odysButton variant="ghost" [disabled]="busy()" (click)="act('unpublish')">Annulla programmazione</button>
                }
                @case ('published') {
                  <button odysButton variant="secondary" [disabled]="busy()" (click)="act('unpublish')">Torna in bozza</button>
                  <button odysButton variant="ghost" [disabled]="busy()" (click)="act('archive')">Archivia</button>
                }
                @case ('archived') {
                  <button odysButton variant="secondary" [disabled]="busy()" (click)="act('unpublish')">Ripristina come bozza</button>
                }
              }
            </div>

            @if (p.effectiveStatus === 'draft' || p.effectiveStatus === 'scheduled') {
              <div class="schedule">
                <label class="label" for="when">{{ p.effectiveStatus === 'scheduled' ? 'Riprogramma' : 'Oppure programma la pubblicazione' }}</label>
                <div class="schedule__row">
                  <input id="when" type="datetime-local" [min]="minSchedule" [ngModel]="when()" (ngModelChange)="when.set($event)" />
                  <button odysButton variant="secondary" icon="calendar" [disabled]="!when() || busy()" (click)="schedule()">Programma</button>
                </div>
              </div>
            }

            <button type="button" class="delete" (click)="remove()" [disabled]="busy()"><odys-icon name="trash" [size]="16" /> Elimina il post</button>
          </section>
        </div>
      } @else {
        <odys-notice tone="danger">{{ message() || 'Post non trovato.' }}</odys-notice>
      }
    </div>
  `,
  styles: `
    .back { display: inline-flex; align-items: center; gap: var(--space-1); margin-bottom: var(--space-4); color: var(--color-text-muted); text-decoration: none; }
    .head { display: flex; flex-wrap: wrap; align-items: flex-end; > div { display: flex; flex-direction: column; gap: var(--space-1); } justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-5); h1 { font-size: var(--text-3xl); } }
    .layout { display: grid; gap: var(--space-6); margin-top: var(--space-4); }
    .form { display: flex; flex-direction: column; gap: var(--space-5); min-width: 0; }
    .group { display: flex; flex-direction: column; gap: var(--space-2); }
    h2 { font-size: var(--text-lg); display: flex; align-items: baseline; gap: var(--space-2); small { font-size: var(--text-sm); color: var(--color-text-muted); font-weight: 500; } }
    .label { font-size: var(--text-sm); font-weight: 600; }
    .hint { font-size: var(--text-xs); color: var(--color-text-muted); }
    .counter { text-align: right; }
    textarea, select, input[type='datetime-local'] { width: 100%; min-height: 48px; padding: var(--space-3); border-radius: var(--radius-md); border: var(--border-width) solid var(--color-border-strong); background: var(--color-surface); color: var(--color-text); font: inherit; }
    textarea { resize: vertical; }
    .media { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2);
      li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2); border-radius: var(--radius-md); background: var(--color-surface); border: var(--border-width) solid var(--color-border); }
      li.is-failed { border-color: var(--color-danger); }
      img, .thumb-placeholder { width: 52px; height: 52px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; }
      .thumb-placeholder { display: grid; place-items: center; background: var(--color-surface-muted); } }
    .media__label { flex: 1; min-width: 0; font-size: var(--text-sm); font-weight: 600; }
    .media__actions { display: flex; gap: 2px; }
    .icon-btn { display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: var(--radius-pill); background: transparent; color: var(--color-text); cursor: pointer; &:hover:not(:disabled) { background: var(--color-surface-muted); } &:disabled { opacity: 0.35; cursor: default; } }
    .upload { position: relative; display: flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: 72px; padding: var(--space-4); border-radius: var(--radius-md); border: 2px dashed var(--color-border-strong); color: var(--color-link); font-weight: 600; cursor: pointer;
      &:hover, &:focus-within { border-color: var(--color-primary); background: var(--color-primary-soft); }
      input { position: absolute; inset: 0; opacity: 0; cursor: pointer; } }
    .upload.is-busy { cursor: progress; }
    .check { display: flex; align-items: flex-start; gap: var(--space-3); font-size: var(--text-sm); input { margin-top: 3px; width: 18px; height: 18px; flex-shrink: 0; } }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .schedule { display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-4); border-top: var(--border-width) solid var(--color-border); }
    .schedule__row { display: flex; flex-wrap: wrap; gap: var(--space-2); input { flex: 1; min-width: 220px; } }
    .delete { align-self: flex-start; display: inline-flex; align-items: center; gap: var(--space-2); min-height: 44px; padding: 0; border: 0; background: transparent; color: var(--color-danger-text); font: inherit; font-weight: 600; cursor: pointer; }
    @media (min-width: 1024px) { .layout { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); align-items: start; } .preview { position: sticky; top: calc(var(--header-height) + var(--space-4)); } }
  `,
})
export default class PostEditorPage {
  private readonly api = inject(CreatorApi);
  private readonly catalog = inject(CatalogApi);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  readonly id = input.required<string>();

  protected readonly maxMedia = MAX_MEDIA_PER_POST;
  protected readonly captionMax = CAPTION_MAX;
  protected readonly minSchedule = new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16);

  protected readonly post = signal<Post | null>(null);
  protected readonly trips = signal<PublishedTrip[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly uploading = signal(false);
  protected readonly uploadProgress = signal('');
  protected readonly message = signal('');
  protected readonly messageTone = signal<'info' | 'success' | 'danger'>('info');
  protected readonly dirty = signal(false);

  protected readonly caption = signal('');
  protected readonly locationText = signal('');
  protected readonly locationNode = signal<LocationNode | null>(null);
  protected readonly tripId = signal('');
  protected readonly rights = signal(false);
  protected readonly when = signal('');

  protected readonly statusLabel = computed(() => this.post() ? POST_STATUS_LABELS[this.post()!.effectiveStatus] : '');
  protected readonly eta = computed(() => countdown(this.post()?.scheduledFor, Date.now()));
  protected readonly editableMedia = computed(() => this.post()?.status === 'draft');

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const [post, trips] = await Promise.all([this.api.myPost(id), this.catalog.myPublished().catch(() => [])]);
      this.trips.set(trips.filter((trip) => ['published', 'scheduled', 'active'].includes(trip.effectiveStatus) || trip.id === post.publishedTripId));
      this.apply(post);
    } catch (error) {
      this.notify(apiErrorMessage(error, 'Post non trovato.'), 'danger');
    } finally {
      this.loading.set(false);
    }
  }

  /** Allinea il modulo al post salvato. */
  private apply(post: Post): void {
    this.post.set(post);
    this.caption.set(post.caption);
    this.locationText.set(post.location?.label ?? '');
    this.locationNode.set(post.location?.latitude !== undefined ? { id: 'post-location', label: post.location.label, type: 'custom', latitude: post.location.latitude, longitude: post.location.longitude, osmId: post.location.osmId, geoStatus: 'CONFIRMED' } : null);
    this.tripId.set(post.publishedTripId ?? '');
    this.rights.set(post.rightsConfirmed);
    this.dirty.set(false);
  }

  private notify(text: string, tone: 'info' | 'success' | 'danger' = 'info'): void {
    this.message.set(text);
    this.messageTone.set(tone);
  }

  protected setLocationText(value: string): void {
    this.locationText.set(value);
    if (this.locationNode()?.label !== value) this.locationNode.set(null);
    this.dirty.set(true);
  }

  protected pickLocation(node: LocationNode): void {
    this.locationNode.set(node);
    this.locationText.set(node.label);
    this.dirty.set(true);
  }

  /** Salva didascalia, luogo, itinerario e diritti. */
  protected async save(): Promise<boolean> {
    const post = this.post();
    if (!post) return false;
    this.busy.set(true);
    try {
      const node = this.locationNode();
      const label = this.locationText().trim();
      this.apply(await this.api.updatePost(post.id, {
        caption: this.caption(),
        location: label ? { label, latitude: node?.latitude, longitude: node?.longitude, osmId: node?.osmId } : null,
        publishedTripId: this.tripId() || null,
        rightsConfirmed: this.rights(),
      }));
      this.notify('Modifiche salvate.', 'success');
      return true;
    } catch (error) {
      this.notify(apiErrorMessage(error, 'Non è stato possibile salvare.'), 'danger');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async act(action: PostAction, scheduledFor?: string): Promise<void> {
    const post = this.post();
    if (!post || (this.dirty() && !(await this.save()))) return;
    this.busy.set(true);
    try {
      this.apply(await this.api.changeStatus(post.id, action, scheduledFor));
      this.notify({
        publish: 'Pubblicato: ora è visibile nel feed e sul tuo profilo.',
        schedule: 'Programmato: verrà pubblicato all’ora indicata. Fino ad allora lo vedi solo tu.',
        unpublish: 'Il post è di nuovo una bozza privata.',
        archive: 'Archiviato: non è più visibile al pubblico.',
      }[action], 'success');
    } catch (error) {
      this.notify(apiErrorMessage(error), 'danger');
    } finally {
      this.busy.set(false);
    }
  }

  protected schedule(): void {
    const value = this.when();
    if (value) void this.act('schedule', new Date(value).toISOString());
  }

  /** Prepara, registra e carica i file scelti, uno alla volta (M-01…M-04). */
  protected async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    const post = this.post();
    if (!post || !files.length) return;
    const room = MAX_MEDIA_PER_POST - post.media.length;
    if (files.length > room) this.notify(`Puoi aggiungere ancora ${room} elementi: gli altri sono stati ignorati.`);
    this.uploading.set(true);
    const problems: string[] = [];
    for (const [index, file] of files.slice(0, room).entries()) {
      this.uploadProgress.set(`Caricamento ${index + 1} di ${Math.min(files.length, room)}…`);
      let media: PostMedia | null = null;
      try {
        const prepared = await prepareMedia(file);
        media = await this.api.addMedia(post.id, { mimeType: prepared.mimeType, sizeBytes: file.size, width: prepared.width, height: prepared.height, durationMs: prepared.durationMs, extension: prepared.extension });
        await this.auth.uploadMedia(media.originalKey, file, prepared.mimeType);
        if (media.displayKey && prepared.display) await this.auth.uploadMedia(media.displayKey, prepared.display, 'image/webp');
        if (media.thumbnailKey) await this.auth.uploadMedia(media.thumbnailKey, prepared.thumbnail, 'image/webp');
        await this.api.setMediaStatus(post.id, media.id, 'ready');
      } catch (error) {
        problems.push(error instanceof Error && !('status' in error) ? error.message : apiErrorMessage(error, `"${file.name}" non caricato.`));
        // M-04: un caricamento interrotto non resta a metà: lo si segnala e si può eliminare.
        if (media) await this.api.setMediaStatus(post.id, media.id, 'failed').catch(() => undefined);
      }
    }
    this.uploading.set(false);
    this.apply(await this.api.myPost(post.id));
    if (problems.length) this.notify(problems.join(' '), 'danger');
  }

  protected async move(index: number, step: number): Promise<void> {
    const post = this.post();
    if (!post) return;
    const ids = post.media.map((media) => media.id);
    [ids[index], ids[index + step]] = [ids[index + step], ids[index]];
    this.busy.set(true);
    try {
      await this.api.reorderMedia(post.id, ids);
      this.apply(await this.api.myPost(post.id));
    } catch (error) {
      this.notify(apiErrorMessage(error), 'danger');
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeMedia(media: PostMedia): Promise<void> {
    const post = this.post();
    if (!post || !confirm('Eliminare questo media? Il file verrà cancellato.')) return;
    this.busy.set(true);
    try {
      await this.api.removeMedia(post.id, media.id);
      this.apply(await this.api.myPost(post.id));
    } catch (error) {
      this.notify(apiErrorMessage(error), 'danger');
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const post = this.post();
    if (!post || !confirm('Eliminare il post? Non sarà più visibile da nessuna parte.')) return;
    this.busy.set(true);
    try {
      await this.api.deletePost(post.id);
      await this.router.navigate(['/studio']);
    } catch (error) {
      this.notify(apiErrorMessage(error), 'danger');
      this.busy.set(false);
    }
  }
}
