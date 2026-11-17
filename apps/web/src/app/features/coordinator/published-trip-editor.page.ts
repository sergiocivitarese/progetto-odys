import { AgencyApi } from '../../core/api/agency.api';
import { DatePipe } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { changedDayIndexes, finalizeDraft, MAX_TRIP_PARTICIPANTS, TRIP_INTERESTS, type GeneratorDuration, type Itinerary } from '@odys/domain';
import type { GeneratorRequest } from '../../core/api/generator.api';
import { apiErrorMessage } from '../../core/api/api-client';
import { CatalogApi, PUBLISHED_STATUS_LABELS, type CoordinatorAction, type PlaceStory, type PublishedTrip, type PublishedTripForm, type TripVisibility } from '../../core/api/catalog.api';
import { TripsStore } from '../../core/state/trips.store';
import { ButtonComponent, ChipComponent, IconComponent, NoticeComponent, TextFieldComponent } from '../../shared/ui';
import { CoordinatorAccessComponent } from './coordinator-access.component';
import { PricingPanelComponent } from './pricing-panel.component';
import { SocialKitComponent } from './social-kit.component';
import { OfferItineraryEditorComponent } from './offer-itinerary-editor.component';

function lines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

type Step = 1 | 2 | 3 | 4;

/** Durata del generatore più vicina al numero di giorni scelto. */
function durationFor(days: number): GeneratorDuration {
  if (days <= 3) return 'weekend';
  if (days <= 5) return '3-5';
  return days <= 7 ? '7' : '7+';
}

/**
 * Crea viaggio in 4 passi (CB-02…CB-05): meta, itinerario, prezzo, pubblicazione.
 * La bozza nasce alla fine del passo 2, dal generatore o da un viaggio salvato;
 * da lì l'itinerario si modifica dentro l'offerta (CB-03).
 */
@Component({
  selector: 'odys-published-trip-editor-page',
  imports: [FormsModule, DatePipe, RouterLink, ButtonComponent, ChipComponent, IconComponent, NoticeComponent, TextFieldComponent, CoordinatorAccessComponent, PricingPanelComponent, SocialKitComponent, OfferItineraryEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './published-trip-editor.page.html',
  styleUrl: './published-trip-editor.page.scss',
})
export default class PublishedTripEditorPage implements AfterViewInit {
  private readonly api = inject(CatalogApi);
  private readonly agencies = inject(AgencyApi);
  /** Ruolo nell'agenzia: proprietario e amministratori pubblicano i viaggi coperti (AG-11). */
  private readonly agencyRole = signal<string | null>(null);
  private readonly router = inject(Router);
  protected readonly trips = inject(TripsStore);
  private readonly access = viewChild.required(CoordinatorAccessComponent);
  private readonly pricing = viewChild(PricingPanelComponent);

  /** Parametro di rotta: assente per un nuovo viaggio. */
  readonly id = input<string>();
  /** `?passo=` per riaprire l'editor su un passo preciso. */
  readonly passo = input<string>();
  /** `?agenzia=` : il nuovo viaggio nasce nel catalogo di questa agenzia (AG-03). */
  readonly agenzia = input<string>();
  /** Viaggio dell'agenzia (catalogo): il ritorno porta al catalogo. */
  protected readonly agencyTrip = computed(() => Boolean(this.existing()?.agencyOwned || (this.isNew() && this.agenzia())));

  protected readonly steps: Array<{ n: Step; label: string }> = [
    { n: 1, label: 'Meta' },
    { n: 2, label: 'Itinerario' },
    { n: 3, label: 'Prezzo' },
    { n: 4, label: 'Pubblicazione' },
  ];
  protected readonly step = signal<Step>(1);
  protected readonly origin = signal<'generator' | 'saved'>('generator');
  /** Itinerario dell'offerta in modifica e versione salvata, per sapere se va inviato. */
  protected readonly itinerary = signal<Itinerary | null>(null);
  private readonly savedItinerary = signal<Itinerary | null>(null);
  protected readonly itineraryDirty = computed(() => {
    const draft = this.itinerary();
    const saved = this.savedItinerary();
    return Boolean(draft && saved && draft !== saved && changedDayIndexes(saved, draft).length);
  });

  protected readonly ready = signal(false);
  protected readonly existing = signal<PublishedTrip | null>(null);
  protected readonly sourceTripId = signal('');
  protected readonly title = signal('');
  protected readonly summary = signal('');
  protected readonly destination = signal('');
  protected readonly startDate = signal('');
  protected readonly endDate = signal('');
  protected readonly price = signal('');
  protected readonly capacity = signal('');
  protected readonly included = signal('');
  protected readonly excluded = signal('');
  protected readonly coverImageUrl = signal('');
  protected readonly scheduledFor = signal('');
  // Dati per ricerca, affinità e prenotazione (CB-02, CB-04, CB-05).
  protected readonly country = signal('');
  protected readonly region = signal('');
  protected readonly interests = signal<string[]>([]);
  protected readonly deposit = signal('');
  protected readonly balanceDueDate = signal('');
  protected readonly visibility = signal<TripVisibility>('public');
  protected readonly ageMin = signal('');
  protected readonly ageMax = signal('');
  /** Storia dei luoghi (TP-08): le tappe sono tre righe «data — cosa è successo». */
  protected readonly stories = signal<PlaceStory[]>([]);
  protected readonly interestOptions = TRIP_INTERESTS;
  protected readonly maxSeats = MAX_TRIP_PARTICIPANTS;
  protected readonly visibilities: Array<{ value: TripVisibility; label: string; hint: string }> = [
    { value: 'public', label: 'Pubblico', hint: 'Lo vede chiunque, in Esplora e nella ricerca.' },
    { value: 'followers', label: 'Follower', hint: 'Lo vede solo chi ti segue.' },
    { value: 'invite', label: 'Su invito', hint: 'Resta fuori dal catalogo: gli inviti arrivano in una prossima versione.' },
  ];
  protected readonly visibilityHint = computed(() => this.visibilities.find((item) => item.value === this.visibility())?.hint ?? '');

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly isNew = computed(() => !this.id());
  protected readonly status = computed(() => this.existing()?.effectiveStatus ?? 'draft');
  protected readonly statusLabel = computed(() => PUBLISHED_STATUS_LABELS[this.status()]);
  protected readonly isPublic = computed(() => ['published', 'active', 'completed'].includes(this.status()));
  /** Viaggio del coordinatore coperto da un'agenzia: chi non ne è proprietario o amministratore lo propone (AG-05). */
  protected readonly needsApproval = computed(() => {
    const trip = this.existing();
    return Boolean(trip && trip.organizer === 'agency' && !trip.agencyOwned && trip.status === 'draft' && !['owner', 'admin'].includes(this.agencyRole() ?? ''));
  });
  /** Il kit social (CB-06) compare da quando il viaggio è pubblicato o programmato, finché è in vendita. */
  protected readonly showKit = computed(() => ['published', 'scheduled'].includes(this.status()));
  /** Campi che la pubblicazione richiede (stesse regole del server, C-13). */
  protected readonly missing = computed(() => [
    this.summary().trim().length < 20 && 'descrizione (passo 1)',
    (!this.startDate() || !this.endDate()) && 'date (passo 1)',
    !this.capacity().trim() && 'posti (passo 1)',
    !this.price().trim() && 'quota (passo 3)',
  ].filter((item): item is string => Boolean(item)));

  constructor() {
    effect(() => {
      const wanted = Number(this.passo());
      untracked(() => { if (wanted >= 1 && wanted <= 4 && !(this.isNew() && wanted > 2)) this.step.set(wanted as Step); });
    });
  }

  protected stepDone(n: Step): boolean {
    if (n === 1) return this.title().trim().length >= 3 && Boolean(this.destination().trim() && this.startDate() && this.endDate() && this.capacity().trim());
    if (n === 2) return Boolean(this.existing()?.itinerary.days.length);
    if (n === 3) return Boolean(this.existing() && this.price().trim());
    return ['published', 'scheduled', 'active', 'completed'].includes(this.existing()?.status ?? '');
  }

  protected async goTo(n: Step): Promise<void> {
    if (this.isNew() && n > 2) return;
    if (n === this.step()) return;
    // Cambiando passo si salva, così nulla si perde (solo per i viaggi già creati).
    if (!this.isNew() && !(await this.save(false))) return;
    this.setStep(n);
  }

  private setStep(n: Step): void {
    this.step.set(n);
    const id = this.existing()?.id;
    if (id) void this.router.navigate(['/coordinatore', id], { queryParams: { passo: n }, replaceUrl: true });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected async next(): Promise<void> {
    const current = this.step();
    if (this.isNew()) {
      if (current === 1) {
        if (this.title().trim() && this.title().trim().length < 3) { this.error.set('Il titolo deve avere almeno 3 caratteri.'); return; }
        if (!this.destination().trim()) { this.error.set('Indica la meta del viaggio.'); return; }
        if (this.startDate() && this.endDate() && this.endDate() < this.startDate()) { this.error.set('Il rientro non può precedere la partenza.'); return; }
        this.error.set('');
        if (!this.trips.trips().length) this.origin.set('generator');
        this.setStep(2);
        return;
      }
      await this.create();
      return;
    }
    if (current < 4 && (await this.save(false))) this.setStep((current + 1) as Step);
  }

  protected async back(): Promise<void> {
    const current = this.step();
    if (current > 1) await this.goTo((current - 1) as Step);
  }

  /** Parametri del generatore presi dal passo 1. */
  private generatorRequest(): GeneratorRequest {
    const start = this.startDate();
    const end = this.endDate();
    const days = start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1 : 4;
    const price = Number(this.price().replace(',', '.'));
    const nextMonth = ((new Date().getMonth() + 1) % 12) + 1;
    return {
      destination: this.destination().trim(),
      surprise: false,
      dates: start && end ? { mode: 'precise', departure: start, returnDate: end } : { mode: 'flexible', months: [nextMonth] },
      duration: durationFor(days),
      budget: Number.isFinite(price) && price >= 50 ? Math.min(price, 20000) : 800,
      interests: this.interests().length ? this.interests() : ['Cibo', 'Storia'],
      seed: Math.floor(Math.random() * 1000),
    };
  }

  /** Fine del passo 2 per un viaggio nuovo: nasce la bozza e si continua dal suo itinerario. */
  private async create(): Promise<void> {
    await this.run(async () => {
      const base = { ...this.form(), agencyId: this.agenzia() || undefined };
      const created = this.origin() === 'generator'
        ? await this.api.createPublished({ ...base, generator: this.generatorRequest() })
        : await (async () => {
          if (!this.sourceTripId()) throw new Error('Scegli uno dei tuoi viaggi da cui partire.');
          return this.api.createPublished({ ...base, sourceTripId: this.sourceTripId() });
        })();
      // Da /nuovo a /:id Angular crea una nuova pagina: il messaggio viaggia con la navigazione.
      const notice = this.origin() === 'generator' ? 'Bozza creata con l’itinerario di Odys: rivedi i giorni e cambia ciò che vuoi.' : 'Bozza creata: l’itinerario è una copia, modificalo qui.';
      await this.router.navigate(['/coordinatore', created.id], { queryParams: { passo: 2 }, replaceUrl: true, state: { notice } });
      return created;
    });
  }


  async ngAfterViewInit(): Promise<void> {
    if (!(await this.access().check())) return;
    await this.start();
  }

  async start(): Promise<void> {
    this.ready.set(true);
    void this.agencies.mine().then((mine) => this.agencyRole.set(mine?.role ?? null)).catch(() => undefined);
    await this.trips.load();
    const id = this.id();
    if (!id) {
      // Il primo viaggio salvato è pronto come origine, ma non riempie i campi del passo 1.
      this.sourceTripId.set(this.trips.trips()[0]?.id ?? '');
      return;
    }
    try {
      this.fill(await this.api.myPublishedTrip(id));
      const notice = (typeof history !== 'undefined' ? (history.state as { notice?: unknown } | null)?.notice : undefined);
      if (typeof notice === 'string') this.message.set(notice);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Viaggio non trovato.'));
    }
  }

  protected chooseSource(id: string): void {
    this.sourceTripId.set(id);
    const trip = this.trips.trips().find((item) => item.id === id);
    if (!trip) return;
    // Completa solo ciò che al passo 1 è rimasto vuoto.
    if (!this.title()) this.title.set(trip.title);
    if (!this.destination()) this.destination.set(trip.itinerary.destination);
    if (!this.startDate()) this.startDate.set(trip.itinerary.departure ?? '');
    if (!this.endDate()) this.endDate.set(trip.itinerary.returnDate ?? '');
  }

  private fill(trip: PublishedTrip): void {
    this.existing.set(trip);
    this.title.set(trip.title);
    this.summary.set(trip.summary);
    this.destination.set(trip.destination);
    this.startDate.set(trip.startDate ?? '');
    this.endDate.set(trip.endDate ?? '');
    this.price.set(trip.priceCents !== undefined ? String(trip.priceCents / 100) : '');
    this.capacity.set(trip.capacity !== undefined ? String(trip.capacity) : '');
    this.included.set(trip.included.join('\n'));
    this.excluded.set(trip.excluded.join('\n'));
    this.coverImageUrl.set(trip.coverImageUrl ?? '');
    this.country.set(trip.country);
    this.region.set(trip.region);
    this.interests.set([...trip.interests]);
    this.deposit.set(trip.depositCents !== undefined ? String(trip.depositCents / 100) : '');
    this.balanceDueDate.set(trip.balanceDueDate ?? '');
    this.visibility.set(trip.visibility);
    this.ageMin.set(trip.ageMin !== undefined ? String(trip.ageMin) : '');
    this.ageMax.set(trip.ageMax !== undefined ? String(trip.ageMax) : '');
    this.itinerary.set(trip.itinerary);
    this.savedItinerary.set(trip.itinerary);
    this.stories.set(structuredClone(trip.placeStories ?? []).map((story) => ({ ...story, milestones: [0, 1, 2].map((index) => story.milestones[index] ?? { when: '', text: '' }) })));
  }

  protected addStory(): void {
    this.stories.update((list) => [...list, { id: `storia-${Date.now()}`, day: 1, title: '', intro: '', body: '', milestones: [0, 1, 2].map(() => ({ when: '', text: '' })) }]);
  }

  protected removeStory(id: string): void {
    this.stories.update((list) => list.filter((story) => story.id !== id));
  }

  /** Aggiorna un campo di una storia (o di una sua tappa) senza mutare l'elenco. */
  protected editStory(id: string, change: Partial<PlaceStory>, milestone?: { index: number; when?: string; text?: string }): void {
    this.stories.update((list) => list.map((story) => {
      if (story.id !== id) return story;
      const milestones = milestone ? story.milestones.map((step, index) => (index === milestone.index ? { when: milestone.when ?? step.when, text: milestone.text ?? step.text } : step)) : story.milestones;
      return { ...story, ...change, milestones };
    }));
  }

  /** Proposta all'agenzia (AG-05): prima si salva, poi si invia. */
  protected async submitToAgency(): Promise<void> {
    const saved = await this.save(false);
    if (!saved) return;
    await this.run(async () => {
      this.fill(await this.api.submitToAgency(saved.id));
      this.message.set('Proposta inviata all’agenzia: la pubblica dopo averla approvata.');
      return null;
    });
  }

  /** Quota consigliata dal pannello dei costi, scritta come nel campo (virgola decimale). */
  protected formatEuros(value: number): string {
    return String(value).replace('.', ',');
  }

  protected toggleInterest(item: string): void {
    this.interests.update((list) => (list.includes(item) ? list.filter((value) => value !== item) : [...list, item]));
  }

  private form(): PublishedTripForm {
    const price = this.price().trim().replace(',', '.');
    const capacity = this.capacity().trim();
    const deposit = this.deposit().trim().replace(',', '.');
    return {
      title: this.title().trim() || undefined,
      summary: this.summary().trim(),
      destination: this.destination().trim(),
      startDate: this.startDate(),
      endDate: this.endDate(),
      price: price ? Number(price) : undefined,
      capacity: capacity ? Number(capacity) : undefined,
      included: lines(this.included()),
      excluded: lines(this.excluded()),
      coverImageUrl: this.coverImageUrl().trim(),
      country: this.country().trim(),
      region: this.region().trim(),
      interests: this.interests(),
      deposit: deposit ? Number(deposit) : undefined,
      balanceDueDate: this.balanceDueDate(),
      visibility: this.visibility(),
      ageMin: this.ageMin().trim() ? Number(this.ageMin()) : null,
      ageMax: this.ageMax().trim() ? Number(this.ageMax()) : null,
      // Le storie lasciate vuote non si inviano.
      placeStories: this.stories().filter((story) => story.title.trim() || story.body.trim()).map((story) => ({ ...story, day: Number(story.day) || 1 })),
    };
  }

  /** Salva i dati del viaggio già creato, con itinerario (se cambiato) e costi. */
  protected async save(announce = true): Promise<PublishedTrip | null> {
    const existing = this.existing();
    if (!existing) return null;
    return this.run(async () => {
      const draft = this.itinerary();
      const saved = this.savedItinerary();
      const form = this.form();
      if (draft && saved && this.itineraryDirty()) form.itinerary = finalizeDraft(draft, changedDayIndexes(saved, draft));
      const updated = await this.api.updatePublished(existing.id, form);
      // I costi (CB-04) si salvano insieme al resto: un solo pulsante.
      await this.pricing()?.save();
      this.fill(updated);
      if (announce) this.message.set('Modifiche salvate.');
      return updated;
    });
  }

  protected async refreshItinerary(): Promise<void> {
    const existing = this.existing();
    if (!existing) return;
    await this.run(async () => {
      this.fill(await this.api.updatePublished(existing.id, { refreshItinerary: true }));
      this.message.set('Itinerario aggiornato con l’ultima versione del tuo viaggio.');
      return null;
    });
  }

  protected async act(action: CoordinatorAction): Promise<void> {
    if (action === 'schedule' && !this.scheduledFor()) {
      this.error.set('Scegli data e ora di pubblicazione.');
      return;
    }
    const saved = await this.save();
    if (!saved) return;
    await this.run(async () => {
      const scheduled = action === 'schedule' ? new Date(this.scheduledFor()).toISOString() : undefined;
      this.fill(await this.api.changeStatus(saved.id, action, scheduled));
      const messages: Record<CoordinatorAction, string> = {
        publish: `${this.visibility() === 'public' ? 'Viaggio pubblicato: ora è visibile a tutti in Esplora.' : this.visibility() === 'followers' ? 'Viaggio pubblicato per chi ti segue.' : 'Viaggio pubblicato su invito: resta fuori dal catalogo.'} Il kit social è pronto: story, post e link per la bio.`,
        schedule: 'Pubblicazione programmata.',
        unpublish: 'Il viaggio è tornato in bozza e non è più visibile al pubblico.',
        cancel: 'Viaggio annullato.',
        archive: 'Viaggio archiviato.',
      };
      this.message.set(messages[action]);
      return null;
    });
  }

  private async run<T>(action: () => Promise<T>): Promise<T | null> {
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      return await action();
    } catch (error) {
      this.error.set(error instanceof Error && !('status' in error) ? error.message : apiErrorMessage(error));
      return null;
    } finally {
      this.busy.set(false);
    }
  }
}
