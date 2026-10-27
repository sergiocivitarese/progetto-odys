import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { nodeIdForActivity, TRANSPORT_LABELS, type DayPlan, type Transport } from '@odys/domain';
import { ButtonComponent, IconComponent } from '../../../shared/ui';

/** "Prossima attività" della giornata in corso, con tratte precedente e successiva. */
@Component({
  selector: 'odys-next-activity-card',
  imports: [ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (info(); as next) {
      <article class="card">
        <div class="top">
          <div><p class="eyebrow">Prossima attività</p><h3>{{ next.activity.title }}</h3></div>
          <span class="time">{{ next.activity.time || 'Orario non inserito' }}</span>
        </div>
        <p class="text">{{ next.activity.place?.address || next.activity.place?.city || 'Luogo da definire' }} · {{ next.transport }} · In programma</p>
        <p class="text">Tratta precedente: {{ next.previous }}</p>
        <p class="text">Tratta successiva: {{ next.following }}</p>
        <div class="actions">
          <button odysButton variant="secondary" size="sm" icon="map-pin" (click)="openOnMap.emit(next.index)">Apri sulla mappa</button>
          <button odysButton variant="accent" size="sm" icon="check" (click)="complete.emit(next.index)">Segna completata</button>
        </div>
      </article>
    } @else {
      <article class="card card--done">
        <odys-icon name="check-circle" [size]="22" />
        <div><p class="eyebrow">Oggi</p><h3>Giornata completata</h3><p class="text">La mappa e la timeline della giornata restano disponibili per consultazione.</p></div>
      </article>
    }
  `,
  styles: `
    .card { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-5); border-radius: var(--radius-lg); background: var(--color-primary); color: var(--color-on-primary); }
    .card .eyebrow { color: var(--odys-lime); }
    .card--done { flex-direction: row; align-items: flex-start; gap: var(--space-3); background: var(--color-accent); color: var(--color-on-accent); }
    .card--done .eyebrow { color: var(--odys-ink); }
    .top { display: flex; justify-content: space-between; gap: var(--space-3); align-items: flex-start; }
    h3 { font-size: var(--text-xl); }
    .time { padding: 4px 10px; border-radius: var(--radius-pill); background: rgb(255 255 255 / 0.18); font-weight: 700; font-size: var(--text-sm); white-space: nowrap; }
    .text { font-size: var(--text-sm); opacity: 0.9; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
  `,
})
export class NextActivityCardComponent {
  readonly day = input.required<DayPlan>();
  readonly planTransport = input.required<Transport>();
  readonly openOnMap = output<number>();
  readonly complete = output<number>();

  protected readonly info = computed(() => {
    const day = this.day();
    const index = day.activities.findIndex((activity) => !activity.completed);
    if (index < 0) return null;
    const activity = day.activities[index];
    const nodeId = nodeIdForActivity(activity, index);
    const previous = day.segments?.find((segment) => segment.toNodeId === nodeId);
    const following = day.segments?.find((segment) => segment.fromNodeId === nodeId);
    return {
      activity,
      index,
      transport: TRANSPORT_LABELS[activity.transport ?? this.planTransport()],
      previous: previous ? `${previous.origin.label} → ${previous.destination.label}` : 'Da definire',
      following: following ? `${following.origin.label} → ${following.destination.label}` : 'Da definire',
    };
  });
}
