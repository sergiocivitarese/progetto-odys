import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { GENERATOR_DURATIONS, type GeneratorDuration } from '@odys/domain';
import { apiErrorMessage } from '../../core/api/api-client';
import { formatAmount } from '../../core/api/catalog.api';
import { GeneratorApi, type GeneratedPreview, type GeneratorRequest } from '../../core/api/generator.api';
import { TripsStore } from '../../core/state/trips.store';
import { IconComponent, LogoComponent, NoticeComponent } from '../../shared/ui';

const INTERESTS = ['Mare', 'Cibo', 'Storia', 'Trekking', 'Arte', 'Nightlife', 'Relax', 'Natura', 'Città', 'Avventura'];
const MONTH_LABELS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const MONTH_FORMAT = new Intl.DateTimeFormat('it-IT', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Generatore di itinerari (TP-01…TP-03): parametri, stato di caricamento,
 * itinerario giorno per giorno con costi stimati e confronto col budget;
 * poi Rigenera, Modifica parametri, Salva e accetta.
 */
@Component({
  selector: 'odys-generator-page',
  imports: [FormsModule, IconComponent, LogoComponent, NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './generator.page.html',
  styleUrl: './generator.page.scss',
})
export default class GeneratorPage {
  private readonly api = inject(GeneratorApi);
  private readonly router = inject(Router);
  private readonly trips = inject(TripsStore);

  protected readonly interestOptions = INTERESTS;
  protected readonly durations = (Object.keys(GENERATOR_DURATIONS) as GeneratorDuration[]).map((id) => ({ id, label: GENERATOR_DURATIONS[id].label }));
  /** I prossimi sei mesi, a partire da quello dopo il mese in corso. */
  protected readonly months = Array.from({ length: 6 }, (_, index) => {
    const month = ((new Date().getMonth() + 1 + index) % 12) + 1;
    return { value: month, label: MONTH_LABELS[month - 1] };
  });

  protected readonly destination = signal('');
  protected readonly surprise = signal(false);
  protected readonly mode = signal<'precise' | 'flexible'>('flexible');
  protected readonly selectedMonths = signal<number[]>([this.months[1].value]);
  protected readonly departure = signal('');
  protected readonly returnDate = signal('');
  protected readonly duration = signal<GeneratorDuration>('3-5');
  protected readonly budget = signal(650);
  protected readonly interests = signal<string[]>(['Mare', 'Cibo']);
  protected readonly seed = signal(0);

  protected readonly result = signal<GeneratedPreview | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');

  protected readonly canGenerate = computed(() =>
    (this.surprise() || this.destination().trim().length >= 2) && this.interests().length > 0
    && (this.mode() === 'flexible' ? this.selectedMonths().length > 0 : !!this.departure() && !!this.returnDate()));
  protected readonly budgetLabel = computed(() => (this.budget() >= 1200 ? '€1.200+' : `€${this.budget().toLocaleString('it-IT')}`));
  protected readonly overBudget = computed(() => !!this.result() && this.result()!.totalCents > this.result()!.budgetCents);
  protected readonly fill = computed(() => {
    const trip = this.result();
    return trip?.budgetCents ? Math.min(100, Math.round((trip.totalCents / trip.budgetCents) * 100)) : 0;
  });
  protected readonly when = computed(() => (this.result() ? MONTH_FORMAT.format(new Date(`${this.result()!.departure}T00:00:00Z`)).replace('.', '') : ''));

  private request(): GeneratorRequest {
    return {
      destination: this.destination().trim(),
      surprise: this.surprise(),
      dates: this.mode() === 'precise' ? { mode: 'precise', departure: this.departure(), returnDate: this.returnDate() } : { mode: 'flexible', months: this.selectedMonths() },
      duration: this.duration(),
      budget: this.budget(),
      interests: this.interests(),
      seed: this.seed(),
    };
  }

  protected money(cents: number): string { return formatAmount(cents); }

  protected toggle(list: 'interests' | 'months', value: string | number): void {
    if (list === 'interests') this.interests.update((items) => (items.includes(value as string) ? items.filter((item) => item !== value) : [...items, value as string]));
    else this.selectedMonths.update((items) => (items.includes(value as number) ? items.filter((item) => item !== value) : [...items, value as number]));
  }

  protected useSurprise(): void {
    this.surprise.set(!this.surprise());
    if (this.surprise()) this.destination.set('');
  }

  /** «Genera il mio itinerario» e «Rigenera» (stessi parametri, proposta diversa). */
  protected async generate(again = false): Promise<void> {
    if (again) this.seed.update((value) => value + 1);
    this.loading.set(true);
    this.error.set('');
    try {
      this.result.set(await this.api.generate(this.request()));
      window.scrollTo({ top: 0 });
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile generare l’itinerario.'));
    } finally {
      this.loading.set(false);
    }
  }

  /** «Salva e accetta»: solo ora l'itinerario entra tra i viaggi salvati. */
  protected async accept(): Promise<void> {
    this.saving.set(true);
    this.error.set('');
    try {
      const trip = await this.api.accept(this.request());
      this.trips.upsertLocal(trip);
      await this.router.navigate(['/itinerario', trip.id]);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Non è stato possibile salvare il viaggio.'));
    } finally {
      this.saving.set(false);
    }
  }
}
