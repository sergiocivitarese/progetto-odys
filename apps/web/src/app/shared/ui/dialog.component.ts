import { ChangeDetectionStrategy, Component, effect, ElementRef, input, output, viewChild } from '@angular/core';
import { IconComponent } from './icon.component';

/**
 * Finestra modale accessibile basata su <dialog> nativo (focus trap, Esc).
 * Su mobile si apre come bottom sheet, su desktop centrata.
 */
@Component({
  selector: 'odys-dialog',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog (close)="closed.emit()" (click)="onBackdrop($event)" [attr.aria-labelledby]="'dlg-title'">
      <div class="sheet">
        <header>
          <h2 id="dlg-title">{{ title() }}</h2>
          <button type="button" class="close" (click)="dialog.close()" aria-label="Chiudi"><odys-icon name="x" [size]="20" /></button>
        </header>
        <div class="content"><ng-content /></div>
        <footer><ng-content select="[dialog-actions]" /></footer>
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      padding: 0; border: 0; background: transparent; color: var(--color-text);
      width: 100%; max-width: 100%; max-height: 100dvh; margin: auto auto 0;
    }
    dialog::backdrop { background: var(--color-overlay); backdrop-filter: blur(2px); }
    .sheet {
      background: var(--color-surface); border-radius: var(--radius-xl) var(--radius-xl) 0 0;
      padding: var(--space-5) var(--space-5) calc(var(--space-5) + env(safe-area-inset-bottom));
      max-height: 90dvh; overflow: auto; box-shadow: var(--shadow-lg);
    }
    header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-4); }
    h2 { font-size: var(--text-xl); }
    .close { display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: var(--radius-pill); background: var(--color-surface-muted); cursor: pointer; }
    footer { display: flex; flex-wrap: wrap; gap: var(--space-2); justify-content: flex-end; margin-top: var(--space-5); }
    footer:empty { display: none; }
    @media (min-width: 640px) {
      dialog { max-width: 560px; margin: auto; }
      .sheet { border-radius: var(--radius-xl); padding: var(--space-6); }
    }
  `,
})
export class DialogComponent {
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly closed = output<void>();
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.open() && !element.open) element.showModal();
      if (!this.open() && element.open) element.close();
    });
  }

  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.dialog().nativeElement.close();
  }
}
