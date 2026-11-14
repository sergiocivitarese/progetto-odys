import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { SOCIAL_FORMATS, socialKitContent, type SocialFormat } from '@odys/domain';
import type { PublishedTrip } from '../../core/api/catalog.api';
import { ButtonComponent, IconComponent } from '../../shared/ui';
import { canvasToBlob, loadCover, loadKitFonts, renderSocialKit } from './social-kit-renderer';

interface KitImage { format: SocialFormat; label: string; url: string; blob: Blob; fileName: string }

function slug(value: string): string {
  return value.toLocaleLowerCase('it').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'viaggio';
}

/**
 * Kit social (CB-06): story 9:16, post 4:5 e link per la bio generati con i
 * dati del viaggio, da scaricare o condividere subito dopo la pubblicazione.
 */
@Component({
  selector: 'odys-social-kit',
  imports: [ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" aria-labelledby="kit-title">
      <div>
        <h2 id="kit-title">Kit social</h2>
        <p class="hint">Grafiche pronte con i dati del viaggio. Si aggiornano quando salvi le modifiche.</p>
      </div>
      @if (generating() && !images().length) {
        <p class="hint"><odys-icon name="loader" [size]="16" class="spin" /> Preparo le grafiche…</p>
      }
      <div class="previews">
        @for (image of images(); track image.format) {
          <figure class="preview preview--{{ image.format }}">
            <img [src]="image.url" [alt]="image.label + ' di ' + trip().title" />
            <figcaption>
              <span>{{ image.label }}</span>
              <span class="actions">
                @if (canShare()) {
                  <button odysButton type="button" variant="secondary" size="sm" icon="share" (click)="share(image)" [attr.aria-label]="'Condividi ' + image.label">Condividi</button>
                }
                <a odysButton variant="secondary" size="sm" icon="download" [href]="image.url" [attr.download]="image.fileName" [attr.aria-label]="'Scarica ' + image.label">Scarica</a>
              </span>
            </figcaption>
          </figure>
        }
      </div>
      <div class="bio">
        <p class="label">Link per la bio</p>
        <p class="bio__url">{{ publicUrl() }}</p>
        <p class="bio__text">{{ content().bioText }}</p>
        <div class="actions">
          <button odysButton type="button" variant="secondary" size="sm" [icon]="copied() === 'link' ? 'check' : 'link'" (click)="copy('link')">{{ copied() === 'link' ? 'Link copiato' : 'Copia link' }}</button>
          <button odysButton type="button" variant="ghost" size="sm" [icon]="copied() === 'text' ? 'check' : 'copy'" (click)="copy('text')">{{ copied() === 'text' ? 'Testo copiato' : 'Copia testo' }}</button>
        </div>
      </div>
      @if (trip().visibility !== 'public') {
        <p class="hint">Il viaggio è {{ trip().visibility === 'followers' ? 'visibile solo ai tuoi follower' : 'su invito' }}: chi apre il link senza averne diritto non lo vede.</p>
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .card { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5); border-radius: var(--radius-lg); background: var(--color-surface); border: var(--border-width) solid var(--color-border); h2 { font-size: var(--text-lg); } }
    .hint { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--color-text-muted); }
    .label { font-size: var(--text-sm); font-weight: 600; }
    .previews { display: grid; grid-template-columns: 9fr 10fr; gap: var(--space-3); align-items: start; }
    .preview { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; min-width: 0;
      img { display: block; width: 100%; height: auto; border-radius: var(--radius-md); box-shadow: var(--shadow-md); background: var(--color-surface-muted); }
      figcaption { display: flex; flex-direction: column; gap: var(--space-2); font-size: var(--text-xs); font-weight: 700; color: var(--color-text-muted); } }
    .preview--story img { aspect-ratio: 9 / 16; }
    .preview--post img { aspect-ratio: 4 / 5; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .bio { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); border-radius: var(--radius-md); background: var(--color-surface-muted); }
    .bio__url { font-weight: 700; overflow-wrap: anywhere; }
    .bio__text { font-size: var(--text-sm); color: var(--color-text-muted); white-space: pre-line; overflow-wrap: anywhere; }
    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { to { rotate: 360deg; } }
  `,
})
export class SocialKitComponent {
  readonly trip = input.required<PublishedTrip>();

  protected readonly images = signal<KitImage[]>([]);
  protected readonly generating = signal(false);
  protected readonly copied = signal<'' | 'link' | 'text'>('');
  protected readonly canShare = signal(false);
  protected readonly publicUrl = computed(() => `${location.origin}/gruppi/${this.trip().id}`);
  protected readonly content = computed(() => {
    const trip = this.trip();
    return socialKitContent({
      title: trip.title, destination: trip.destination, country: trip.country, startDate: trip.startDate, endDate: trip.endDate,
      priceCents: trip.priceCents, currency: trip.currency, capacity: trip.capacity, seatsLeft: trip.seatsLeft,
      interests: trip.interests, coordinatorName: trip.coordinator?.displayName,
    }, this.publicUrl());
  });
  private run = 0;

  constructor() {
    effect(() => {
      const content = this.content();
      const cover = this.trip().coverImageUrl;
      untracked(() => void this.generate(content, cover));
    });
    inject(DestroyRef).onDestroy(() => this.images().forEach((image) => URL.revokeObjectURL(image.url)));
  }

  private async generate(content: ReturnType<typeof socialKitContent>, coverUrl: string | undefined): Promise<void> {
    const run = ++this.run;
    this.generating.set(true);
    try {
      const [cover] = await Promise.all([loadCover(coverUrl), loadKitFonts()]);
      const base = `odys-${slug(this.trip().destination)}`;
      const images: KitImage[] = [];
      for (const format of ['story', 'post'] as SocialFormat[]) {
        const blob = await canvasToBlob(renderSocialKit(format, content, cover));
        images.push({ format, label: SOCIAL_FORMATS[format].label, blob, url: URL.createObjectURL(blob), fileName: `${base}-${format}.png` });
      }
      if (run !== this.run) { images.forEach((image) => URL.revokeObjectURL(image.url)); return; }
      this.images().forEach((image) => URL.revokeObjectURL(image.url));
      this.images.set(images);
      const probe = new File([images[0].blob], images[0].fileName, { type: 'image/png' });
      this.canShare.set(typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] }));
    } finally {
      if (run === this.run) this.generating.set(false);
    }
  }

  protected async share(image: KitImage): Promise<void> {
    const file = new File([image.blob], image.fileName, { type: 'image/png' });
    try {
      await navigator.share({ files: [file], title: this.trip().title, text: this.content().bioText });
    } catch {
      // Condivisione annullata: niente da fare.
    }
  }

  protected async copy(what: 'link' | 'text'): Promise<void> {
    try {
      await navigator.clipboard.writeText(what === 'link' ? this.publicUrl() : this.content().bioText);
      this.copied.set(what);
      setTimeout(() => this.copied.set(''), 2000);
    } catch {
      this.copied.set('');
    }
  }
}
