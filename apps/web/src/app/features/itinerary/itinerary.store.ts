import { computed, inject, Injectable, signal } from '@angular/core';
import {
  acceptRepositioning,
  addActivity,
  addPlaceFromSearch,
  applyActivityGeoNode,
  nodeIdForLabel,
  serializeTripExport,
  dayForToday,
  deleteActivity,
  moveActivityToDay,
  moveActivityWithinDay,
  normalizePlan,
  patchRouteInPlan,
  restoreOriginal,
  statusForNode,
  ACTIVITY_STATUS_LABELS,
  toggleActivityCompletion,
  toggleSegmentCompletion,
  updateActivity,
  updateActivityPlaceQuery,
  weatherKey,
  weatherRequestForDay,
  type Activity,
  type GeoEnrichmentIssue,
  type Itinerary,
  type LocationNode,
  type LodgingInfo,
  type RepositionSuggestion,
  type RouteSegment,
  type TripDateFields,
  type WeatherSnapshot,
} from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { ItineraryApi } from '../../core/api/itinerary.api';
import { ServicesApi } from '../../core/api/services.api';
import { TripsApi } from '../../core/api/trips.api';
import { PlanDraftStore } from '../../core/state/plan-draft.store';
import { TripsStore } from '../../core/state/trips.store';
import { AuthStore } from '../../core/auth/auth.store';
import type { StoredTrip, TripChangeKind, TripVersionSummary } from '../../core/api/trips.api';
import { Router } from '@angular/router';

export interface PersistOptions {
  /** Nessun messaggio "Salvataggio completato" (aggiornamenti automatici). */
  quiet?: boolean;
  /** Motivo del salvataggio, registrato nello storico. */
  changeKind?: TripChangeKind;
  /** false: aggiorna il viaggio senza creare una nuova versione (meteo, arricchimenti). */
  recordVersion?: boolean;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface ActivityGeoSearch {
  dayIndex: number;
  activityIndex: number;
  message: string;
  candidates: LocationNode[];
}

/**
 * Stato e casi d'uso della pagina itinerario (ex `app/itinerary.tsx`).
 *
 * - `plan` è il piano salvato; `draft` la bozza in modalità modifica.
 * - Le modifiche alla bozza usano funzioni pure di @odys/domain (istantanee).
 * - Salvataggi e ricalcoli passano dal backend.
 *
 * È fornito a livello di pagina (`providers: [ItineraryStore]`): ogni apertura
 * dell'itinerario ha il proprio stato.
 */
@Injectable()
export class ItineraryStore {
  private readonly tripsApi = inject(TripsApi);
  private readonly itineraryApi = inject(ItineraryApi);
  private readonly services = inject(ServicesApi);
  private readonly trips = inject(TripsStore);
  private readonly unsaved = inject(PlanDraftStore);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  // --- stato ------------------------------------------------------------------
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly trip = signal<StoredTrip | null>(null);
  readonly plan = signal<Itinerary | null>(null);
  readonly draft = signal<Itinerary | null>(null);
  readonly saveState = signal<SaveState>('idle');
  readonly saveError = signal('');
  readonly message = signal('');

  readonly geoIssues = signal<GeoEnrichmentIssue[]>([]);
  readonly geoMessages = signal<string[]>([]);
  readonly weatherLoading = signal(false);
  readonly todayDay = signal<number | undefined>(undefined);
  readonly selectedNodeId = signal<string | undefined>(undefined);
  readonly selectedSegmentId = signal<string | undefined>(undefined);

  readonly pendingDeletion = signal<{ dayIndex: number; activityIndex: number; title: string } | null>(null);
  readonly activityGeoSearch = signal<ActivityGeoSearch | null>(null);
  readonly reposition = signal<{ dayIndex: number; suggestion: RepositionSuggestion } | null>(null);
  readonly pendingProviderRoute = signal<{ segment: RouteSegment; patch: Partial<RouteSegment> } | null>(null);
  private readonly daysToRefresh = signal<number[]>([]);

  /** Storico delle versioni del viaggio aperto. */
  readonly versions = signal<TripVersionSummary[]>([]);
  readonly versionsLoading = signal(false);

  // --- derivati -----------------------------------------------------------------
  readonly isSaved = computed(() => this.trip() !== null);
  readonly isEditing = computed(() => this.draft() !== null);
  readonly visiblePlan = computed(() => this.draft() ?? this.plan());
  readonly selectedDay = computed(() => {
    const plan = this.visiblePlan();
    if (!plan) return undefined;
    return plan.days.find((day) => day.day === this.todayDay()) ?? plan.days[0];
  });

  weatherForDay(dayNumber: number): WeatherSnapshot | undefined {
    const plan = this.visiblePlan();
    if (!plan) return undefined;
    const request = weatherRequestForDay(plan, dayNumber);
    return request ? (plan.weather ?? []).find((record) => weatherKey(record) === weatherKey(request)) : undefined;
  }

  // --- caricamento ---------------------------------------------------------------

  async load(id: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.draft.set(null);
    try {
      if (id === 'bozza') {
        const draft = this.unsaved.plan();
        if (!draft) throw new Error('missing-draft');
        this.trip.set(null);
        this.setPlan(normalizePlan(draft));
      } else {
        await this.auth.start();
        if (!this.auth.isAuthenticated()) {
          await this.router.navigate(['/accedi'], { queryParams: { ritorno: `/itinerario/${id}` }, replaceUrl: true });
          return;
        }
        const trip = await this.tripsApi.get(id);
        this.trip.set(trip);
        this.setPlan(normalizePlan(trip.itinerary));
      }
    } catch (error) {
      this.loadError.set(id === 'bozza'
        ? 'Questo piano non è più disponibile: crealo di nuovo dal planner.'
        : apiErrorMessage(error, 'Non è stato possibile aprire il viaggio.'));
    } finally {
      this.loading.set(false);
    }
    if (this.plan()) void this.enrichThenWeather();
    if (this.trip()) void this.loadVersions();
  }

  // --- storico delle versioni -------------------------------------------------

  async loadVersions(): Promise<void> {
    const trip = this.trip();
    if (!trip) return;
    this.versionsLoading.set(true);
    try {
      this.versions.set(await this.tripsApi.versions(trip.id));
    } catch {
      this.versions.set([]);
    } finally {
      this.versionsLoading.set(false);
    }
  }

  /** Ripristina una versione: ne crea una nuova uguale, lo storico non perde nulla. */
  async restoreVersion(version: number): Promise<boolean> {
    const trip = this.trip();
    if (!trip) return false;
    this.saveState.set('saving');
    try {
      const restored = await this.tripsApi.restore(trip.id, version);
      this.trips.upsertLocal(restored);
      this.trip.set(restored);
      this.draft.set(null);
      this.setPlan(normalizePlan(restored.itinerary));
      this.saveState.set('saved');
      this.message.set(`Versione ${version} ripristinata: è ora la versione ${restored.currentVersion}.`);
      await this.loadVersions();
      return true;
    } catch (error) {
      this.saveError.set(apiErrorMessage(error));
      this.saveState.set('error');
      return false;
    }
  }

  private setPlan(plan: Itinerary): void {
    this.plan.set(plan);
    if (!plan.days.some((day) => day.day === this.todayDay())) this.todayDay.set(dayForToday(plan));
  }

  /** Cerca le posizioni mancanti e poi aggiorna il meteo (come all'apertura nel planner originale). */
  private async enrichThenWeather(): Promise<void> {
    const plan = this.plan();
    if (!plan) return;
    try {
      const result = await this.services.enrichGeography(plan);
      this.geoIssues.set(result.issues);
      this.geoMessages.set(result.messages);
      if (result.changed && !this.isEditing()) {
        this.setPlan(result.itinerary);
        if (this.trip()) await this.persist(result.itinerary, { quiet: true, changeKind: 'geography', recordVersion: false });
      }
    } catch {
      // Il geocoding è un arricchimento: se non risponde il piano resta utilizzabile.
    }
    await this.refreshWeather();
  }

  // --- salvataggio ----------------------------------------------------------------

  /**
   * Salva il piano (crea il viaggio se è ancora una bozza non salvata).
   * Senza accesso le modifiche a un piano non salvato restano nel piano locale:
   * pianificare è libero (U-10). Solo il salvataggio esplicito porta al login;
   * dopo l'accesso si torna qui e il salvataggio riparte da solo (U-11).
   */
  async persist(next: Itinerary, options: PersistOptions = {}): Promise<boolean> {
    await this.auth.start();
    if (!this.auth.isAuthenticated()) {
      this.unsaved.set(next);
      this.setPlan(next);
      if (options.changeKind && !this.trip()) {
        this.saveState.set('idle');
        if (!options.quiet) this.message.set('Modifiche applicate al piano. Salva il viaggio per ritrovarlo nel tuo account.');
        return true;
      }
      await this.router.navigate(['/accedi'], { queryParams: { ritorno: '/itinerario/bozza?salva=1', motivo: 'salva' } });
      return false;
    }
    if (!options.quiet) this.saveState.set('saving');
    try {
      const trip = this.trip();
      const saved = await this.trips.save(next, trip?.id, { title: trip?.title, changeKind: trip ? options.changeKind ?? 'edited' : 'created', recordVersion: options.recordVersion });
      this.trip.set(saved);
      this.setPlan(normalizePlan(saved.itinerary));
      if (!trip) this.unsaved.clear();
      if (!options.quiet) this.saveState.set('saved');
      if (options.recordVersion !== false) void this.loadVersions();
      return true;
    } catch (error) {
      this.saveError.set(apiErrorMessage(error, 'Errore di salvataggio. Le modifiche non sono state salvate.'));
      this.saveState.set('error');
      return false;
    }
  }

  /**
   * Aggiornamenti operativi (completamenti, meteo): in bozza restano nella bozza,
   * altrimenti si salvano subito, senza creare una nuova versione nello storico.
   */
  private async operationalUpdate(update: (current: Itinerary) => Itinerary, changeKind: TripChangeKind = 'progress'): Promise<void> {
    if (this.draft()) {
      this.updateDraft(update);
      return;
    }
    const plan = this.plan();
    if (!plan) return;
    const next = normalizePlan(update(plan));
    this.setPlan(next);
    if (this.trip()) await this.persist(next, { quiet: changeKind !== 'progress', changeKind, recordVersion: false });
  }

  // --- modalità modifica -----------------------------------------------------------

  startEditing(): void {
    const plan = this.plan();
    if (!plan) return;
    this.draft.set(normalizePlan(JSON.parse(JSON.stringify(plan)) as Itinerary));
    this.daysToRefresh.set([]);
    this.pendingDeletion.set(null);
    this.activityGeoSearch.set(null);
    this.saveState.set('idle');
  }

  cancelEditing(): void {
    this.draft.set(null);
    this.daysToRefresh.set([]);
    this.pendingDeletion.set(null);
    this.activityGeoSearch.set(null);
    this.reposition.set(null);
    this.saveState.set('idle');
  }

  updateDraft(update: (current: Itinerary) => Itinerary, ...touchedDays: number[]): void {
    this.draft.update((current) => current ? update(current) : current);
    if (touchedDays.length) this.daysToRefresh.update((days) => Array.from(new Set([...days, ...touchedDays.filter((day) => day >= 0)])));
    this.saveState.set('idle');
  }

  async saveChanges(): Promise<void> {
    const draft = this.draft();
    if (!draft) return;
    this.saveState.set('saving');
    try {
      const finalized = await this.itineraryApi.finalize(draft, this.daysToRefresh());
      if (await this.persist(finalized, { changeKind: 'edited' })) {
        this.draft.set(null);
        this.daysToRefresh.set([]);
      }
    } catch (error) {
      this.saveError.set(apiErrorMessage(error));
      this.saveState.set('error');
    }
  }

  restoreOriginalDraft(): void {
    const draft = this.draft();
    if (draft?.original) this.draft.set(restoreOriginal(draft));
    this.saveState.set('idle');
  }

  setTripTransport(transport: Itinerary['transport']): void {
    this.updateDraft((current) => ({ ...current, transport }));
  }

  patchActivity(dayIndex: number, activityIndex: number, patch: Partial<Activity>): void {
    this.updateDraft((current) => updateActivity(current, dayIndex, activityIndex, patch), dayIndex);
  }

  addActivity(dayIndex: number): void {
    this.updateDraft((current) => addActivity(current, dayIndex), dayIndex);
  }

  confirmDeletion(): void {
    const pending = this.pendingDeletion();
    if (!pending) return;
    this.updateDraft((current) => deleteActivity(current, pending.dayIndex, pending.activityIndex), pending.dayIndex);
    this.pendingDeletion.set(null);
  }

  moveWithinDay(dayIndex: number, activityIndex: number, targetIndex: number): void {
    this.updateDraft((current) => moveActivityWithinDay(current, dayIndex, activityIndex, targetIndex), dayIndex);
  }

  moveToDay(fromDayIndex: number, activityIndex: number, toDayIndex: number): void {
    this.updateDraft((current) => moveActivityToDay(current, fromDayIndex, activityIndex, toDayIndex), fromDayIndex, toDayIndex);
  }

  setPlaceQuery(dayIndex: number, activityIndex: number, value: string): void {
    this.updateDraft((current) => updateActivityPlaceQuery(current, dayIndex, activityIndex, value), dayIndex);
    this.activityGeoSearch.set(null);
  }

  applyPlaceCandidate(dayIndex: number, activityIndex: number, node: LocationNode): void {
    this.updateDraft((current) => applyActivityGeoNode(current, dayIndex, activityIndex, node), dayIndex);
    this.activityGeoSearch.set(null);
  }

  async searchActivityPlace(dayIndex: number, activityIndex: number): Promise<void> {
    const plan = this.visiblePlan();
    const activity = plan?.days[dayIndex]?.activities[activityIndex];
    const query = activity?.place?.title?.trim() ?? '';
    if (!plan || !activity || !query) {
      this.activityGeoSearch.set({ dayIndex, activityIndex, message: 'Inserisci prima il nome del luogo da cercare.', candidates: [] });
      return;
    }
    this.activityGeoSearch.set({ dayIndex, activityIndex, message: 'Ricerca del luogo in corso…', candidates: [] });
    try {
      const result = await this.services.searchPlace(query, plan.destination, 'activity');
      if (result.node && result.status !== 'AMBIGUOUS' && result.status !== 'CITY_MISMATCH') {
        this.applyPlaceCandidate(dayIndex, activityIndex, result.node);
        this.message.set(result.message ?? `Luogo aggiornato: stato ${ACTIVITY_STATUS_LABELS[statusForNode(result.node)]}.`);
        return;
      }
      this.activityGeoSearch.set({ dayIndex, activityIndex, message: result.message ?? 'Posizione da definire.', candidates: result.candidates });
    } catch {
      this.activityGeoSearch.set({ dayIndex, activityIndex, message: 'Ricerca non disponibile. Il luogo resta salvato come Posizione da definire.', candidates: [] });
    }
  }

  async inspectReposition(dayIndex: number, activityIndex: number): Promise<void> {
    const plan = this.visiblePlan();
    if (!plan) return;
    try {
      this.reposition.set({ dayIndex, suggestion: await this.itineraryApi.reposition(plan, dayIndex, activityIndex) });
    } catch (error) {
      this.message.set(apiErrorMessage(error));
    }
  }

  acceptReposition(): void {
    const proposal = this.reposition();
    if (!proposal) return;
    this.updateDraft((current) => acceptRepositioning(current, proposal.dayIndex, proposal.suggestion), proposal.dayIndex);
    this.reposition.set(null);
  }

  keepReposition(): void {
    const proposal = this.reposition();
    if (!proposal) return;
    this.patchActivity(proposal.dayIndex, proposal.suggestion.activityIndex, { repositioningDecision: 'KEPT' });
    this.reposition.set(null);
  }

  /** Aggiunge alla giornata selezionata un luogo trovato con la ricerca in mappa (apre la modifica). */
  addSearchResult(node: LocationNode): void {
    const plan = this.plan();
    if (!plan) return;
    const dayNumber = this.todayDay() ?? plan.days[0]?.day;
    const dayIndex = plan.days.findIndex((day) => day.day === dayNumber);
    this.draft.set(addPlaceFromSearch(this.draft() ?? plan, dayNumber, node));
    this.daysToRefresh.update((days) => Array.from(new Set([...days, dayIndex])));
    this.saveState.set('idle');
    this.message.set('Luogo aggiunto alla bozza. Salva le modifiche per conservarlo nel viaggio.');
  }

  // --- aggiornamenti operativi ----------------------------------------------------

  toggleActivity(dayNumber: number, activityIndex: number): void {
    void this.operationalUpdate((current) => toggleActivityCompletion(current, dayNumber, activityIndex));
  }

  toggleSegment(routeId: string): void {
    void this.operationalUpdate((current) => toggleSegmentCompletion(current, routeId));
  }

  async refreshWeather(): Promise<void> {
    const source = this.visiblePlan();
    if (!source) return;
    this.weatherLoading.set(true);
    try {
      const { weather, requested } = await this.services.refreshWeather(source);
      if (!requested) return;
      await this.operationalUpdate((current) => ({ ...current, weather }), 'edited');
    } catch {
      // Il meteo è opzionale: in errore restano gli ultimi dati salvati.
    } finally {
      this.weatherLoading.set(false);
    }
  }

  async confirmGeoIssue(issue: GeoEnrichmentIssue, node: LocationNode): Promise<void> {
    const plan = this.plan();
    if (!plan) return;
    try {
      const next = await this.services.confirmGeography(plan, issue.target, node);
      this.geoIssues.update((issues) => issues.filter((item) => item.id !== issue.id));
      this.setPlan(next);
      if (this.trip()) await this.persist(next, { quiet: true, changeKind: 'geography' });
      await this.refreshWeather();
    } catch (error) {
      this.message.set(apiErrorMessage(error));
    }
  }

  // --- percorsi online ----------------------------------------------------------------

  async requestProviderRoute(segment: RouteSegment): Promise<void> {
    try {
      const { patch } = await this.services.calculateRoute(segment);
      this.message.set('');
      this.pendingProviderRoute.set({ segment, patch });
    } catch (error) {
      this.message.set(apiErrorMessage(error, 'Routing online non disponibile.'));
    }
  }

  async confirmProviderRoute(): Promise<void> {
    const pending = this.pendingProviderRoute();
    if (!pending) return;
    this.pendingProviderRoute.set(null);
    if (this.draft()) {
      this.updateDraft((current) => patchRouteInPlan(current, pending.segment.id, pending.patch));
      this.message.set('Percorso online applicato alla bozza. Salva le modifiche per conservarlo nel viaggio.');
      return;
    }
    const plan = this.plan();
    if (plan) await this.persist(normalizePlan(patchRouteInPlan(plan, pending.segment.id, pending.patch)), { changeKind: 'route' });
  }

  // --- editor di date, budget e alloggio (ricalcolo lato server) -------------------

  checkDates(fields: TripDateFields) {
    return this.itineraryApi.checkDates(this.plan()!, fields);
  }

  async applyDates(fields: TripDateFields): Promise<boolean> {
    return this.persist(await this.itineraryApi.applyDates(this.plan()!, fields), { changeKind: 'dates' });
  }

  async confirmBudget(fields: { travelers: string; budgetPerTraveler?: string }): Promise<boolean> {
    return this.persist(await this.itineraryApi.confirmBudget(this.plan()!, fields), { changeKind: 'budget' });
  }

  previewOrigin(lodging: LodgingInfo) {
    return this.itineraryApi.previewOrigin(this.plan()!, lodging);
  }

  async confirmOrigin(preview: Itinerary): Promise<boolean> {
    const confirmed = await this.itineraryApi.confirmOrigin(this.plan()!, preview);
    const ok = await this.persist(confirmed, { changeKind: 'lodging' });
    if (ok) void this.enrichThenWeather();
    return ok;
  }

  // --- export -------------------------------------------------------------------------

  /** Scarica l'export JSON compatibile con Odys e Triply v5 (anche per piani non ancora salvati). */
  exportJson(): void {
    const plan = this.visiblePlan();
    if (!plan) return;
    const trip = this.trip();
    const json = serializeTripExport({
      id: trip?.id ?? `local-${nodeIdForLabel(plan.destination, 'trip')}`,
      title: trip?.title ?? plan.destination,
      itinerary: plan,
      createdAt: trip?.createdAt,
      updatedAt: trip?.updatedAt,
      planVersion: 5,
    });
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${plan.destination.toLocaleLowerCase('it').replace(/[^a-z0-9]+/g, '-') || 'viaggio'}-odys.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async share(): Promise<void> {
    const plan = this.visiblePlan();
    if (!plan) return;
    const text = `Ho preparato un itinerario per ${plan.destination}: ${plan.duration} giorni da vivere.`;
    try {
      if (navigator.share) await navigator.share({ title: 'Il mio itinerario', text });
      else {
        await navigator.clipboard.writeText(text);
        this.message.set('Riepilogo del viaggio copiato negli appunti.');
      }
    } catch {
      // Condivisione annullata dall'utente.
    }
  }
}
