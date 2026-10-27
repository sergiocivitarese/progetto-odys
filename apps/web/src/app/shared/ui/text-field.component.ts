import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent, type IconName } from './icon.component';

let nextId = 0;

/** Campo di testo con etichetta, icona e testo di aiuto. Two-way binding: `[(value)]`. */
@Component({
  selector: 'odys-text-field',
  imports: [IconComponent, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label [for]="id" class="label">{{ label() }}</label>
    <div class="control" [class.control--multiline]="multiline()">
      @if (icon()) {<odys-icon [name]="icon()!" [size]="17" class="icon" />}
      @if (multiline()) {
        <textarea [id]="id" [ngModel]="value()" (ngModelChange)="value.set($event)" [placeholder]="placeholder()" rows="3" [attr.aria-describedby]="hint() ? id + '-hint' : null"></textarea>
      } @else {
        <input [id]="id" [type]="type()" [attr.required]="required() || null" [attr.aria-required]="required() || null" [ngModel]="value()" (ngModelChange)="value.set($event)" [placeholder]="placeholder()" [attr.inputmode]="inputMode() ?? null" [attr.autocomplete]="autocomplete()" [attr.aria-describedby]="hint() ? id + '-hint' : null" />
      }
    </div>
    @if (hint()) {<p [id]="id + '-hint'" class="hint">{{ hint() }}</p>}
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .label { font-size: var(--text-sm); font-weight: 600; }
    .control {
      display: flex; align-items: center; gap: var(--space-2);
      min-height: 48px; padding: 0 var(--space-3);
      background: var(--color-surface); border: var(--border-width) solid var(--color-border-strong); border-radius: var(--radius-md);
      transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
    }
    .control:focus-within { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-soft); }
    .control--multiline { align-items: flex-start; padding-block: var(--space-3); }
    .icon { color: var(--color-text-muted); }
    input, textarea { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font-size: var(--text-md); padding: 10px 0; }
    textarea { resize: vertical; padding: 0; min-height: 64px; }
    input::placeholder, textarea::placeholder { color: var(--color-text-muted); opacity: 0.8; }
    .hint { font-size: var(--text-xs); color: var(--color-text-muted); }
  `,
})
export class TextFieldComponent {
  readonly label = input.required<string>();
  readonly value = model('');
  readonly placeholder = input('');
  readonly icon = input<IconName>();
  readonly hint = input<string>();
  readonly type = input<'text' | 'email' | 'password' | 'date' | 'time' | 'number' | 'search'>('text');
  readonly inputMode = input<'text' | 'numeric' | 'decimal'>();
  readonly autocomplete = input('off');
  readonly required = input(false);
  readonly multiline = input(false);
  protected readonly id = `odys-field-${nextId++}`;
}
