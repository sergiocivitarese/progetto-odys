import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, model, output, signal } from '@angular/core';
import { MIN_SUGGESTION_QUERY_LENGTH, openStreetMapUrl, SUGGESTION_DEBOUNCE_MS, type LocationNode, type PlaceSuggestionKind } from '@odys/domain';
import { ServicesApi } from '../../core/api/services.api';
import { IconComponent, type IconName } from '../ui';

let nextId = 0;

/**
 * Campo località con suggerimenti OpenStreetMap mentre si digita (combobox accessibile).
 * Il testo resta libero: scegliere un suggerimento aggiunge la posizione confermata
 * e il collegamento alla scheda OpenStreetMap del luogo.
 *
 * Uso: `<odys-place-field label="Destinazione" [(value)]="testo" [selected]="nodo" (pick)="scegli($event)" />`
 */
@Component({
  selector: 'odys-place-field',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label [for]="id" [id]="id + '-label'" class="label">{{ label() }}</label>
    <div class="anchor">
    <div class="control">
      <odys-icon [name]="icon()" [size]="17" class="icon" />
      <input [id]="id" type="text" role="combobox" autocomplete="off" spellcheck="false"
        [value]="value()" [placeholder]="placeholder()"
        [attr.aria-expanded]="open()" [attr.aria-controls]="id + '-list'" [attr.aria-labelledby]="id + '-label'" aria-autocomplete="list"
        [attr.aria-activedescendant]="active() >= 0 ? id + '-option-' + active() : null"
        [attr.aria-describedby]="id + '-status'"
        (input)="onInput($any($event.target).value)" (keydown)="onKeydown($event)" (focus)="reopen()" (blur)="closeSoon()" />
      @if (loading()) {<odys-icon name="loader" [size]="16" class="icon spin" />}
      @else if (osmUrl()) {<odys-icon name="check-circle" [size]="17" class="icon icon--ok" />}
    </div>

    @if (open()) {
      <div class="popup">
        <ul [id]="id + '-list'" role="listbox" [attr.aria-label]="'Suggerimenti per ' + label()">
          @for (node of suggestions(); track node.id; let i = $index) {
            <li [id]="id + '-option-' + i" role="option" [attr.aria-selected]="i === active()" [class.is-active]="i === active()"
              (mousedown)="$event.preventDefault()" (click)="choose(node)" (mouseenter)="active.set(i)">
              <odys-icon [name]="kind() === 'place' ? 'map-pin' : 'navigation'" [size]="16" class="icon" />
              <span class="option__text"><strong>{{ head(node.label) }}</strong>@if (tail(node.label)) {<small>{{ tail(node.label) }}</small>}</span>
            </li>
          }
        </ul>
        <p class="attribution">Suggerimenti da <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></p>
      </div>
    }
    </div>

    <p [id]="id + '-status'" class="hint" aria-live="polite">
      @if (osmUrl()) {
        Posizione trovata · <a [href]="osmUrl()" target="_blank" rel="noopener noreferrer">vedi su OpenStreetMap<span class="visually-hidden"> (si apre in una nuova scheda)</span></a>
      } @else if (message()) {
        {{ message() }}
      } @else if (hint()) {
        {{ hint() }}
      }
    </p>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .label { font-size: var(--text-sm); font-weight: 600; }
    .control { display: flex; align-items: center; gap: var(--space-2); min-height: 48px; padding: 0 var(--space-3); background: var(--color-surface); border: var(--border-width) solid var(--color-border-strong); border-radius: var(--radius-md); transition: border-color var(--duration-fast), box-shadow var(--duration-fast); }
    .control:focus-within { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-soft); }
    .icon { color: var(--color-text-muted); flex-shrink: 0; }
    .icon--ok { color: var(--color-link); }
    .spin { animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font-size: var(--text-md); padding: 10px 0; }
    input::placeholder { color: var(--color-text-muted); opacity: 0.8; }
    .anchor { position: relative; }
    .popup { position: absolute; z-index: 20; top: 100%; left: 0; right: 0; margin-top: 4px; border-radius: var(--radius-md); background: var(--color-surface); border: var(--border-width) solid var(--color-border-strong); box-shadow: var(--shadow-lg); overflow: hidden; }
    ul { list-style: none; margin: 0; padding: var(--space-1); max-height: 300px; overflow-y: auto; }
    li { display: flex; align-items: center; gap: var(--space-3); min-height: 44px; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); cursor: pointer; }
    li.is-active { background: var(--color-primary-soft); }
    .option__text { display: flex; flex-direction: column; min-width: 0; small { color: var(--color-text-muted); font-size: var(--text-xs); } }
    .attribution { margin: 0; padding: var(--space-2) var(--space-3); border-top: var(--border-width) solid var(--color-border); font-size: var(--text-xs); color: var(--color-text-muted); a { color: inherit; } }
    .hint { min-height: 1em; font-size: var(--text-xs); color: var(--color-text-muted); a { color: var(--color-link); font-weight: 600; } }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  `,
})
export class PlaceFieldComponent {
  private readonly api = inject(ServicesApi);

  readonly label = input.required<string>();
  readonly placeholder = input('');
  readonly icon = input<IconName>('map-pin');
  readonly hint = input<string>();
  /** `place`: città, regioni, paesi. `point`: indirizzi, luoghi, stazioni, aeroporti. */
  readonly kind = input<PlaceSuggestionKind>('place');
  /** Luogo già scelto (mostra il collegamento a OpenStreetMap). */
  readonly selected = input<LocationNode | null | undefined>(null);
  /** Testo del campo; chi lo usa azzera il luogo scelto quando il testo cambia. */
  readonly value = model('');
  readonly pick = output<LocationNode>();
  /** Invio senza suggerimento evidenziato (es. "aggiungi la tappa così come l'ho scritta"). */
  readonly submitText = output<string>();

  protected readonly id = `odys-place-${nextId++}`;
  protected readonly suggestions = signal<LocationNode[]>([]);
  protected readonly active = signal(-1);
  protected readonly loading = signal(false);
  protected readonly message = signal('');
  private readonly focused = signal(false);
  protected readonly open = computed(() => this.focused() && this.suggestions().length > 0);
  protected readonly osmUrl = computed(() => {
    const node = this.selected();
    return node && node.label === this.value() ? openStreetMapUrl(node) : null;
  });

  private timer: ReturnType<typeof setTimeout> | undefined;
  private sequence = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected onInput(text: string): void {
    this.value.set(text);
    this.message.set('');
    clearTimeout(this.timer);
    const query = text.trim();
    if (query.length < MIN_SUGGESTION_QUERY_LENGTH) {
      this.sequence++;
      this.suggestions.set([]);
      this.loading.set(false);
      return;
    }
    this.timer = setTimeout(() => void this.load(query), SUGGESTION_DEBOUNCE_MS);
  }

  private async load(query: string): Promise<void> {
    const current = ++this.sequence;
    this.loading.set(true);
    try {
      const result = await this.api.suggestPlaces(query, this.kind());
      if (current !== this.sequence) return; // risposta superata da una digitazione più recente
      this.suggestions.set(result.suggestions);
      this.active.set(-1);
      this.message.set(result.suggestions.length ? '' : 'Nessun suggerimento: puoi lasciare la località scritta così.');
    } catch {
      if (current !== this.sequence) return;
      this.suggestions.set([]);
      this.message.set('Suggerimenti non disponibili: puoi scrivere la località a mano.');
    } finally {
      if (current === this.sequence) this.loading.set(false);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.suggestions().length;
    if (event.key === 'ArrowDown' && count) {
      event.preventDefault();
      this.focused.set(true);
      this.active.set((this.active() + 1) % count);
    } else if (event.key === 'ArrowUp' && count) {
      event.preventDefault();
      this.active.set(this.active() <= 0 ? count - 1 : this.active() - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const node = this.open() && this.active() >= 0 ? this.suggestions()[this.active()] : undefined;
      if (node) this.choose(node);
      else if (this.value().trim()) this.submitText.emit(this.value().trim());
    } else if (event.key === 'Escape' && this.open()) {
      event.preventDefault();
      this.suggestions.set([]);
    }
  }

  protected choose(node: LocationNode): void {
    this.sequence++;
    clearTimeout(this.timer);
    this.value.set(node.label);
    this.suggestions.set([]);
    this.active.set(-1);
    this.message.set('');
    this.pick.emit(node);
  }

  protected reopen(): void {
    this.focused.set(true);
  }

  protected closeSoon(): void {
    setTimeout(() => this.focused.set(false), 120);
  }

  protected head(label: string): string {
    return label.split(', ')[0];
  }

  protected tail(label: string): string {
    return label.split(', ').slice(1).join(', ');
  }
}
