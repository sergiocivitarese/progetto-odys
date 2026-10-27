import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../../config/env';
import type { AuthUser } from '../../shared/auth';
import type {
  AdminRepository,
  ApplicationReview,
  ApplicationsRepository,
  ApplicationStatus,
  CommunityStore,
  CoordinatorApplication,
  CoordinatorApplicationInput,
  Participant,
  ParticipationCounts,
  ParticipationRepository,
  ParticipationRequest,
  ParticipationStatus,
} from '../../shared/community';
import { dbError, userClient } from './client';

interface RequestRow {
  id: string;
  published_trip_id: string;
  status: ParticipationStatus;
  message: string | null;
  created_at: string;
  decided_at: string | null;
}

interface ParticipantRow extends Omit<RequestRow, 'published_trip_id'> {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
}

interface ApplicationRow {
  id: string;
  status: ApplicationStatus;
  motivation: string;
  experience: string;
  trips_led: number;
  languages: string[] | null;
  links: string[] | null;
  reviewer_message: string | null;
  created_at: string;
  decided_at: string | null;
}

interface ReviewRow extends ApplicationRow {
  user_id: string;
  admin_note: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  bio: string | null;
  interests: string[] | null;
}

const REQUEST_COLUMNS = 'id, published_trip_id, status, message, created_at, decided_at';
// La nota interna dell'amministratore non è leggibile dal candidato (permessi di colonna).
const APPLICATION_COLUMNS = 'id, status, motivation, experience, trips_led, languages, links, reviewer_message, created_at, decided_at';

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function toRequest(row: RequestRow): ParticipationRequest {
  return { id: row.id, tripId: row.published_trip_id, status: row.status, message: row.message ?? undefined, createdAt: row.created_at, decidedAt: row.decided_at ?? undefined };
}

function toApplication(row: ApplicationRow): CoordinatorApplication {
  return {
    id: row.id,
    status: row.status,
    motivation: row.motivation,
    experience: row.experience,
    tripsLed: row.trips_led,
    languages: row.languages ?? [],
    links: row.links ?? [],
    reviewerMessage: row.reviewer_message ?? undefined,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined,
  };
}

function toReview(row: ReviewRow): ApplicationReview {
  return {
    ...toApplication(row),
    userId: row.user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email ?? undefined,
    bio: row.bio ?? undefined,
    interests: row.interests ?? [],
    adminNote: row.admin_note ?? undefined,
  };
}

/** Richieste di partecipazione: le regole (chi, quando, capienza) sono nel database. */
class SupabaseParticipationRepository implements ParticipationRepository {
  constructor(private readonly db: SupabaseClient, private readonly user: AuthUser) {}

  async mine(): Promise<ParticipationRequest[]> {
    const { data, error } = await this.db.from('participation_requests').select(REQUEST_COLUMNS).eq('user_id', this.user.id).order('created_at', { ascending: false });
    if (error) throw dbError(error);
    return (data as RequestRow[]).map(toRequest);
  }

  private async own(tripId: string): Promise<RequestRow | null> {
    const { data, error } = await this.db.from('participation_requests').select(REQUEST_COLUMNS).eq('user_id', this.user.id).eq('published_trip_id', tripId).maybeSingle();
    if (error) throw dbError(error);
    return data as RequestRow | null;
  }

  async request(tripId: string, message?: string): Promise<ParticipationRequest> {
    if (!isUuid(tripId)) throw dbError({ code: 'P0002' });
    const existing = await this.own(tripId);
    if (existing && existing.status !== 'withdrawn') return toRequest(existing);
    const query = existing
      ? this.db.from('participation_requests').update({ status: 'pending', message: message ?? null }).eq('id', existing.id)
      : this.db.from('participation_requests').insert({ published_trip_id: tripId, user_id: this.user.id, message: message ?? null });
    const { data, error } = await query.select(REQUEST_COLUMNS).single();
    if (error) throw dbError(error);
    return toRequest(data as RequestRow);
  }

  async withdraw(tripId: string): Promise<ParticipationRequest | null> {
    if (!isUuid(tripId)) return null;
    const existing = await this.own(tripId);
    if (!existing) return null;
    if (existing.status === 'withdrawn' || existing.status === 'declined') return toRequest(existing);
    const { data, error } = await this.db.from('participation_requests').update({ status: 'withdrawn' }).eq('id', existing.id).select(REQUEST_COLUMNS).single();
    if (error) throw dbError(error);
    return toRequest(data as RequestRow);
  }

  async participants(tripId: string): Promise<Participant[]> {
    if (!isUuid(tripId)) throw dbError({ code: 'P0002' });
    const { data, error } = await this.db.rpc('trip_participants', { p_published_trip_id: tripId });
    if (error) throw dbError(error);
    return (data as ParticipantRow[]).map((row) => ({
      ...toRequest({ ...row, published_trip_id: tripId }),
      userId: row.user_id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email ?? undefined,
    }));
  }

  async decide(tripId: string, requestId: string, status: 'confirmed' | 'declined'): Promise<ParticipationRequest | null> {
    if (!isUuid(tripId) || !isUuid(requestId)) return null;
    const { data, error } = await this.db.from('participation_requests').update({ status }).eq('id', requestId).eq('published_trip_id', tripId).select(REQUEST_COLUMNS).maybeSingle();
    if (error) throw dbError(error);
    return data ? toRequest(data as RequestRow) : null;
  }

  async counts(tripIds: string[]): Promise<Map<string, ParticipationCounts>> {
    const counts = new Map<string, ParticipationCounts>();
    const valid = tripIds.filter(isUuid);
    if (!valid.length) return counts;
    const { data, error } = await this.db.from('participation_requests').select('published_trip_id, status').in('published_trip_id', valid).in('status', ['pending', 'confirmed']);
    if (error) throw dbError(error);
    for (const row of data as Array<{ published_trip_id: string; status: 'pending' | 'confirmed' }>) {
      const current = counts.get(row.published_trip_id) ?? { pending: 0, confirmed: 0 };
      current[row.status] += 1;
      counts.set(row.published_trip_id, current);
    }
    return counts;
  }
}

class SupabaseApplicationsRepository implements ApplicationsRepository {
  constructor(private readonly db: SupabaseClient, private readonly user: AuthUser) {}

  async latest(): Promise<CoordinatorApplication | null> {
    const { data, error } = await this.db.from('coordinator_applications').select(APPLICATION_COLUMNS).eq('user_id', this.user.id).order('created_at', { ascending: false }).limit(1);
    if (error) throw dbError(error);
    return data?.[0] ? toApplication(data[0] as ApplicationRow) : null;
  }

  async submit(input: CoordinatorApplicationInput, guidelinesVersion: string): Promise<CoordinatorApplication> {
    const { data, error } = await this.db.from('coordinator_applications').insert({
      motivation: input.motivation,
      experience: input.experience,
      trips_led: input.tripsLed,
      languages: input.languages,
      links: input.links,
      guidelines_version: guidelinesVersion,
    }).select(APPLICATION_COLUMNS).single();
    if (error) throw dbError(error);
    return toApplication(data as ApplicationRow);
  }
}

/** Amministrazione: ogni operazione passa da funzioni SQL che verificano il ruolo (G-01). */
class SupabaseAdminRepository implements AdminRepository {
  constructor(private readonly db: SupabaseClient, private readonly user: AuthUser) {}

  async isAdmin(): Promise<boolean> {
    const { data, error } = await this.db.from('profiles').select('role, status').eq('id', this.user.id).maybeSingle();
    if (error) throw dbError(error);
    return Boolean(data && data.role === 'admin' && data.status === 'active');
  }

  async listApplications(status?: ApplicationStatus): Promise<ApplicationReview[]> {
    const { data, error } = await this.db.rpc('admin_coordinator_applications', { p_status: status ?? null });
    if (error) throw dbError(error);
    return (data as ReviewRow[]).map(toReview);
  }

  async decideApplication(id: string, approve: boolean, adminNote?: string, reviewerMessage?: string): Promise<ApplicationReview | null> {
    if (!isUuid(id)) return null;
    const { error } = await this.db.rpc('admin_decide_coordinator_application', {
      p_application_id: id, p_approve: approve, p_admin_note: adminNote ?? null, p_reviewer_message: reviewerMessage ?? null,
    });
    if (error) throw dbError(error);
    return (await this.listApplications()).find((item) => item.id === id) ?? null;
  }
}

export function supabaseCommunity(config: AppConfig): CommunityStore {
  return {
    participation: (user) => new SupabaseParticipationRepository(userClient(config, user.accessToken), user),
    applications: (user) => new SupabaseApplicationsRepository(userClient(config, user.accessToken), user),
    admin: (user) => new SupabaseAdminRepository(userClient(config, user.accessToken), user),
  };
}
