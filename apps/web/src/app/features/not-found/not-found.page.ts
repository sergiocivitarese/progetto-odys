import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent, EmptyStateComponent } from '../../shared/ui';

@Component({
  selector: 'odys-not-found-page',
  imports: [ButtonComponent, RouterLink, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <odys-empty-state icon="compass" title="Questa pagina non esiste" description="Forse il link è cambiato. Torna alla Home e riparti da lì." />
      <div class="actions"><a odysButton routerLink="/" icon="home">Torna alla Home</a></div>
    </div>
  `,
  styles: `.actions { display: flex; justify-content: center; margin-top: var(--space-4); }`,
})
export default class NotFoundPage {}
