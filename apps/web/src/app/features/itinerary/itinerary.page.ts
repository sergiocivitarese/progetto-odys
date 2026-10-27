import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { discoveryPlaceFor, openStreetMapUrl, TRANSPORT_LABELS, TRIP_TRANSPORT_OPTIONS } from '@odys/domain';
import { ButtonComponent, ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent, SectionHeaderComponent, StatusBadgeComponent } from '../../shared/ui';
import { BudgetEditorDialogComponent } from './components/budget-editor-dialog.component';
import { DateEditorDialogComponent } from './components/date-editor-dialog.component';
import { DaySectionComponent } from './components/day-section.component';
import { ItineraryHeroComponent } from './components/itinerary-hero.component';
import { OriginEditorDialogComponent } from './components/origin-editor-dialog.component';
import { RouteCardComponent } from './components/route-card.component';
import { TodayPanelComponent } from './components/today-panel.component';
import { VersionHistoryDialogComponent } from './components/version-history-dialog.component';
import { ItineraryStore } from './itinerary.store';

type Editor = 'dates' | 'budget' | 'origin' | 'history' | null;

/** Pagina itinerario: compone i blocchi della feature attorno a ItineraryStore. */
@Component({
  selector: 'odys-itinerary-page',
  imports: [
    RouterLink, ButtonComponent, ChipComponent, EmptyStateComponent, IconComponent, NoticeComponent, SectionHeaderComponent, StatusBadgeComponent,
    ItineraryHeroComponent, TodayPanelComponent, DaySectionComponent, RouteCardComponent,
    DateEditorDialogComponent, BudgetEditorDialogComponent, OriginEditorDialogComponent, VersionHistoryDialogComponent,
  ],
  providers: [ItineraryStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './itinerary.page.html',
  styleUrl: './itinerary.page.scss',
})
export default class ItineraryPage {
  protected readonly store = inject(ItineraryStore);
  /** Parametro di rotta `:id` (collegato automaticamente dal router). */
  readonly id = input.required<string>();
  /** `?salva=1`: al ritorno dal login salva subito la bozza (U-11). */
  readonly salva = input<string>();

  protected readonly editor = signal<Editor>(null);
  protected readonly confirmRestore = signal(false);
  protected readonly transportOptions = TRIP_TRANSPORT_OPTIONS;
  protected readonly transportLabels = TRANSPORT_LABELS;
  protected readonly discoveryPlace = computed(() => {
    const plan = this.store.visiblePlan();
    return plan ? discoveryPlaceFor(plan) : null;
  });
  /** Collegamento alla scheda OpenStreetMap della destinazione confermata. */
  protected readonly destinationMapUrl = computed(() => {
    const node = this.store.visiblePlan()?.destinationNode;
    return node?.geoStatus === 'CONFIRMED' ? openStreetMapUrl(node) : null;
  });
  protected readonly hasRoutes = computed(() => {
    const plan = this.store.visiblePlan();
    return !!plan && (!!plan.interurbanRoutes?.length || plan.days.some((day) => day.segments?.length));
  });

  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(async () => {
        // Dopo il primo salvataggio di una bozza l'URL diventa quello del viaggio: niente ricaricamento.
        if (this.store.trip()?.id === id) return;
        await this.store.load(id);
        const plan = this.store.plan();
        if (id === 'bozza' && this.salva() === '1' && plan && !this.store.isSaved()) await this.store.persist(plan);
      });
    });
    effect(() => {
      const savedId = this.store.trip()?.id;
      if (savedId && untracked(() => this.id()) === 'bozza') void this.router.navigate(['/itinerario', savedId], { replaceUrl: true });
    });
  }

  protected openEditor(editor: Editor): void {
    this.store.cancelEditing();
    this.editor.set(editor);
  }
}
