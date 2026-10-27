import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, OnInit, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { RECOMMENDED_INTERESTS, type GroupTrip } from '@odys/domain';
import { AccountApi, type ActivityEntry } from '../../core/api/account.api';
import { CatalogApi, formatPrice, PARTICIPATION_STATUS_LABELS, type MyParticipation, type ParticipationStatus, type PublishedTripSummary } from '../../core/api/catalog.api';
import { apiErrorMessage } from '../../core/api/api-client';
import { ServicesApi } from '../../core/api/services.api';
import { passwordProblem } from '../../core/auth/auth-errors';
import { AuthStore } from '../../core/auth/auth.store';
import { ThemeSwitchComponent } from '../../core/layout/shell/theme-switch.component';
import { AccountStore } from '../../core/state/account.store';
import { ConfigStore } from '../../core/state/config.store';
import { TripsStore } from '../../core/state/trips.store';
import { ButtonComponent, ChipComponent, DialogComponent, NoticeComponent, TextFieldComponent } from '../../shared/ui';

const ACTION_LABELS: Record<string, string> = {
  'trip.create': 'Viaggio creato',
  'trip.edited': 'Itinerario modificato',
  'trip.dates': 'Date aggiornate',
  'trip.budget': 'Budget confermato',
  'trip.lodging': 'Alloggio aggiornato',
  'trip.geography': 'Posizione confermata',
  'trip.progress': 'Avanzamento del viaggio',
  'trip.route': 'Percorso calcolato',
  'trip.restore': 'Versione ripristinata',
  'trip.import': 'Viaggio importato',
  'trip.rename': 'Viaggio rinominato',
  'trip.delete': 'Viaggio eliminato',
  'profile.update': 'Profilo aggiornato',
  'trip.copied': 'Viaggio creato da un viaggio pubblicato',
  'participation.request': 'Richiesta di partecipazione inviata',
  'participation.withdraw': 'Richiesta di partecipazione ritirata',
  'participation.confirm': 'Partecipante confermato',
  'participation.decline': 'Richiesta di partecipazione rifiutata',
  'coordinator_application.submit': 'Candidatura a coordinatore inviata',
  'coordinator.guidelines': 'Linee guida del coordinatore accettate',
  'published_trip.create': 'Viaggio pubblicato creato (bozza)',
  'published_trip.update': 'Viaggio pubblicato modificato',
  'published_trip.publish': 'Viaggio pubblicato',
  'published_trip.schedule': 'Pubblicazione programmata',
  'published_trip.unpublish': 'Viaggio ritirato in bozza',
  'published_trip.cancel': 'Viaggio annullato',
  'published_trip.archive': 'Viaggio archiviato',
};

/** Area personale (U-12): profilo, preferenze, idee salvate, attività, sicurezza. */
@Component({
  selector: 'odys-account-page',
  imports: [FormsModule, DatePipe, RouterLink, ButtonComponent, ChipComponent, DialogComponent, NoticeComponent, TextFieldComponent, ThemeSwitchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account.page.html',
  styleUrl: './account.page.scss',
})
export default class AccountPage implements OnInit {
  protected readonly auth = inject(AuthStore);
  protected readonly account = inject(AccountStore);
  protected readonly trips = inject(TripsStore);
  protected readonly config = inject(ConfigStore);
  private readonly api = inject(AccountApi);
  private readonly services = inject(ServicesApi);
  private readonly catalog = inject(CatalogApi);
  private readonly router = inject(Router);

  /** Avviso da mostrare all'arrivo (es. `?avviso=password`). */
  readonly avviso = input<string>();

  protected readonly interestsOptions = RECOMMENDED_INTERESTS;
  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  protected readonly bio = signal('');
  protected readonly headline = signal('');
  protected readonly interests = signal<string[]>([]);
  protected readonly profileState = signal<{ tone: 'success' | 'danger'; text: string } | null>(null);
  protected readonly savingProfile = signal(false);

  protected readonly newPassword = signal('');
  protected readonly passwordState = signal<{ tone: 'success' | 'danger'; text: string } | null>(null);
  protected readonly savingPassword = signal(false);

  protected readonly activity = signal<ActivityEntry[]>([]);
  protected readonly groupTrips = signal<GroupTrip[]>([]);
  protected readonly savedPublished = signal<PublishedTripSummary[]>([]);
  protected readonly participations = signal<MyParticipation[]>([]);
  protected readonly visibleSavedPublished = computed(() => this.savedPublished().filter((trip) => this.account.savedTrips().has(trip.id)));
  protected readonly savedGroupTrips = computed(() => this.groupTrips().filter((trip) => this.account.savedIdeas().has(trip.id)));

  protected readonly deleteOpen = signal(false);
  protected readonly deleteText = signal('');
  protected readonly deleting = signal(false);
  protected readonly deleteError = signal('');

  constructor() {
    // Compila il modulo quando il profilo arriva dal server.
    effect(() => {
      const profile = this.account.profile();
      if (!profile) return;
      untracked(() => {
        this.firstName.set(profile.firstName);
        this.lastName.set(profile.lastName);
        this.bio.set(profile.bio ?? '');
        this.headline.set(profile.publicHeadline ?? '');
        this.interests.set([...profile.interests]);
      });
    });
  }

  async ngOnInit(): Promise<void> {
    if (this.avviso() === 'password') this.passwordState.set({ tone: 'success', text: 'Password aggiornata.' });
    void this.config.ensureLoaded();
    const [activity, groups, saved, participations] = await Promise.allSettled([this.api.activity(), this.services.groupTrips(), this.catalog.savedTrips(), this.catalog.myParticipations()]);
    if (participations.status === 'fulfilled') this.participations.set(participations.value);
    if (activity.status === 'fulfilled') this.activity.set(activity.value);
    if (groups.status === 'fulfilled') this.groupTrips.set(groups.value);
    if (saved.status === 'fulfilled') this.savedPublished.set(saved.value);
  }

  protected participationLabel(status: ParticipationStatus): string {
    return PARTICIPATION_STATUS_LABELS[status];
  }

  protected actionLabel(action: string): string {
    return ACTION_LABELS[action] ?? action;
  }

  protected toggleInterest(item: string): void {
    this.interests.update((list) => list.includes(item) ? list.filter((value) => value !== item) : [...list, item]);
  }

  protected async saveProfile(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.firstName().trim() || !this.lastName().trim()) {
      this.profileState.set({ tone: 'danger', text: 'Nome e cognome sono obbligatori.' });
      return;
    }
    this.savingProfile.set(true);
    try {
      this.account.profile.set(await this.api.updateProfile({
        firstName: this.firstName(), lastName: this.lastName(), bio: this.bio(), interests: this.interests(),
        ...(this.account.isCoordinator() ? { publicHeadline: this.headline() } : {}),
      }));
      this.profileState.set({ tone: 'success', text: 'Profilo salvato.' });
      this.activity.set(await this.api.activity());
    } catch (error) {
      this.profileState.set({ tone: 'danger', text: apiErrorMessage(error) });
    } finally {
      this.savingProfile.set(false);
    }
  }

  protected async changePassword(event: Event): Promise<void> {
    event.preventDefault();
    const problem = passwordProblem(this.newPassword());
    if (problem) { this.passwordState.set({ tone: 'danger', text: problem }); return; }
    this.savingPassword.set(true);
    try {
      await this.auth.updatePassword(this.newPassword());
      this.newPassword.set('');
      this.passwordState.set({ tone: 'success', text: 'Password aggiornata.' });
    } catch (error) {
      this.passwordState.set({ tone: 'danger', text: (error as Error).message });
    } finally {
      this.savingPassword.set(false);
    }
  }

  protected price(trip: PublishedTripSummary): string {
    return formatPrice(trip.priceCents, trip.currency);
  }

  protected async unsaveTrip(id: string): Promise<void> {
    await this.account.toggleSavedTrip(id).catch(() => undefined);
  }

  protected async toggleIdea(id: string): Promise<void> {
    await this.account.toggleIdea(id).catch(() => undefined);
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/');
  }

  protected async deleteAccount(): Promise<void> {
    if (this.deleteText().trim() !== 'ELIMINA') return;
    this.deleting.set(true);
    this.deleteError.set('');
    try {
      await this.api.deleteAccount();
      await this.auth.clearLocalSession();
      await this.router.navigate(['/'], { queryParams: { avviso: 'account-eliminato' } });
    } catch (error) {
      this.deleteError.set(apiErrorMessage(error));
    } finally {
      this.deleting.set(false);
    }
  }
}
