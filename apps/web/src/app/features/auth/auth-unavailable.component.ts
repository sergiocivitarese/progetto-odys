import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NoticeComponent } from '../../shared/ui';

/** Mostrato quando il server non ha ancora Supabase configurato. */
@Component({
  selector: 'odys-auth-unavailable',
  imports: [NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <odys-notice tone="warning" title="Accesso non ancora attivo">
      Il server di Odys non è collegato a Supabase, quindi registrazione e accesso non sono disponibili.
      Puoi comunque pianificare viaggi e consultare gli itinerari. Per attivarli segui <strong>docs/supabase-setup.md</strong>.
    </odys-notice>
  `,
})
export class AuthUnavailableComponent {}
