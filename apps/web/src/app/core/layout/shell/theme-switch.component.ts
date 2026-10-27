import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconComponent, type IconName } from '../../../shared/ui';
import { ThemeStore, type ThemePreference } from '../../state/theme.store';

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: IconName }> = [
  { value: 'light', label: 'Tema chiaro', icon: 'sun' },
  { value: 'dark', label: 'Tema scuro', icon: 'moon' },
  { value: 'system', label: 'Tema automatico (come il sistema)', icon: 'monitor' },
];

/** Selettore del tema a tre opzioni: chiaro, scuro, automatico. */
@Component({
  selector: 'odys-theme-switch',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'radiogroup', 'aria-label': 'Tema' },
  template: `
    @for (option of options; track option.value) {
      <button type="button" role="radio" [attr.aria-checked]="theme.preference() === option.value" [attr.aria-label]="option.label" [title]="option.label"
        [class.is-active]="theme.preference() === option.value" (click)="theme.set(option.value)">
        <odys-icon [name]="option.icon" [size]="16" />
      </button>
    }
  `,
  styles: `
    :host { display: inline-flex; gap: 2px; padding: 3px; border-radius: var(--radius-pill); background: var(--color-surface-muted); border: var(--border-width) solid var(--color-border); }
    button { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: var(--radius-pill); background: transparent; color: var(--color-text-muted); cursor: pointer; transition: background-color var(--duration-fast), color var(--duration-fast); }
    button:hover { color: var(--color-text); }
    button.is-active { background: var(--color-surface); color: var(--color-text); box-shadow: var(--shadow-sm); }
  `,
})
export class ThemeSwitchComponent {
  protected readonly theme = inject(ThemeStore);
  protected readonly options = OPTIONS;
}
