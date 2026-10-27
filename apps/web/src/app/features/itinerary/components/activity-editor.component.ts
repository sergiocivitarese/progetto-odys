import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_TRANSPORT_OPTIONS,
  activityStatusFor,
  EDITABLE_ACTIVITY_STATUSES,
  SETTING_LABELS,
  SETTING_OPTIONS,
  TRANSPORT_LABELS,
  type Activity,
  type DayPlan,
} from '@odys/domain';
import { ButtonComponent, ChipComponent, IconComponent, NoticeComponent, TextFieldComponent } from '../../../shared/ui';
import { ItineraryStore } from '../itinerary.store';

/** Modifica di una singola attività nella bozza (titolo, luogo, orario, giorno, ordine, stato, mezzo…). */
@Component({
  selector: 'odys-activity-editor',
  imports: [ButtonComponent, ChipComponent, IconComponent, NoticeComponent, TextFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './activity-editor.component.html',
  styleUrl: './activity-editor.component.scss',
})
export class ActivityEditorComponent {
  protected readonly store = inject(ItineraryStore);
  readonly activity = input.required<Activity>();
  readonly dayIndex = input.required<number>();
  readonly activityIndex = input.required<number>();
  readonly days = input.required<DayPlan[]>();

  protected readonly statusOptions = EDITABLE_ACTIVITY_STATUSES;
  protected readonly statusLabels = ACTIVITY_STATUS_LABELS;
  protected readonly transportOptions = ACTIVITY_TRANSPORT_OPTIONS;
  protected readonly transportLabels = TRANSPORT_LABELS;
  protected readonly settingOptions = SETTING_OPTIONS;
  protected readonly settingLabels = SETTING_LABELS;

  protected readonly status = computed(() => this.activity().status ?? activityStatusFor(this.activity()));
  protected readonly isLast = computed(() => this.activityIndex() === (this.days()[this.dayIndex()]?.activities.length ?? 1) - 1);
  protected readonly deletionPending = computed(() => {
    const pending = this.store.pendingDeletion();
    return pending?.dayIndex === this.dayIndex() && pending.activityIndex === this.activityIndex();
  });
  protected readonly geoSearch = computed(() => {
    const search = this.store.activityGeoSearch();
    return search?.dayIndex === this.dayIndex() && search.activityIndex === this.activityIndex() ? search : null;
  });
  protected readonly proposal = computed(() => {
    const proposal = this.store.reposition();
    return proposal?.dayIndex === this.dayIndex() && proposal.suggestion.activityIndex === this.activityIndex() ? proposal.suggestion : null;
  });

  protected patch(patch: Partial<Activity>): void {
    this.store.patchActivity(this.dayIndex(), this.activityIndex(), patch);
  }
}
