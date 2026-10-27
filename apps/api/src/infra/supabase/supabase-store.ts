import type { SupabaseClient } from '@supabase/supabase-js';
import { asSavedTrip, type Itinerary } from '@odys/domain';
import type { AppConfig } from '../../config/env';
import type { AuthUser } from '../../shared/auth';
import type {
  AccountRepository,
  AuditEntry,
  DataStore,
  Preferences,
  Profile,
  ProfilePatch,
  StoredTrip,
  TripChangeKind,
  TripsRepository,
  TripVersion,
  TripVersionSummary,
} from '../../shared/data';
import { dbError, userClient } from './client';
import { supabaseCatalog } from './supabase-catalog';
import { supabaseCommunity } from './supabase-community';

interface TripRow {
  id: string;
  title: string;
  itinerary: Itinerary;
  current_version: number;
  created_at: string;
  updated_at: string;
}

const TRIP_COLUMNS = 'id, title, itinerary, current_version, created_at, updated_at';

/** Riga del database → viaggio nel formato del dominio (con migrazione dei piani vecchi). */
function toTrip(row: TripRow): StoredTrip {
  const trip = asSavedTrip({ id: row.id, title: row.title, itinerary: row.itinerary, createdAt: row.created_at, updatedAt: row.updated_at, planVersion: 5 });
  if (!trip) throw dbError({ message: 'Viaggio salvato in un formato non valido.' });
  return { ...trip, currentVersion: row.current_version };
}

class SupabaseTripsRepository implements TripsRepository {
  constructor(private readonly db: SupabaseClient) {}

  private active() {
    return this.db.from('trips').select(TRIP_COLUMNS).is('deleted_at', null);
  }

  async list(): Promise<StoredTrip[]> {
    const { data, error } = await this.active().order('updated_at', { ascending: false });
    if (error) throw dbError(error);
    return (data as TripRow[]).map(toTrip);
  }

  async get(id: string): Promise<StoredTrip | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.active().eq('id', id).maybeSingle();
    if (error) throw dbError(error);
    return data ? toTrip(data as TripRow) : null;
  }

  async findByLegacyId(legacyId: string): Promise<StoredTrip | null> {
    const { data, error } = await this.db.from('trips').select(TRIP_COLUMNS).eq('legacy_id', legacyId).maybeSingle();
    if (error) throw dbError(error);
    return data ? toTrip(data as TripRow) : null;
  }

  async save(input: { tripId?: string; title?: string; itinerary: Itinerary; changeKind: TripChangeKind; summary?: string; legacyId?: string; recordVersion?: boolean }): Promise<StoredTrip> {
    const { data, error } = await this.db.rpc('save_trip', {
      p_trip_id: input.tripId ?? null,
      p_title: input.title ?? null,
      p_itinerary: input.itinerary,
      p_change_kind: input.changeKind,
      p_summary: input.summary ?? null,
      p_legacy_id: input.legacyId ?? null,
      p_record_version: input.recordVersion ?? true,
    }).single();
    if (error) throw dbError(error);
    return toTrip(data as TripRow);
  }

  async rename(id: string, title: string): Promise<StoredTrip | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from('trips').update({ title }).eq('id', id).is('deleted_at', null).select(TRIP_COLUMNS).maybeSingle();
    if (error) throw dbError(error);
    return data ? toTrip(data as TripRow) : null;
  }

  async softDelete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { data, error } = await this.db.from('trips').update({ deleted_at: new Date().toISOString() }).eq('id', id).is('deleted_at', null).select('id');
    if (error) throw dbError(error);
    return (data ?? []).length > 0;
  }

  async listVersions(id: string): Promise<TripVersionSummary[]> {
    if (!isUuid(id)) return [];
    const { data, error } = await this.db.from('trip_versions').select('version, change_kind, summary, created_at').eq('trip_id', id).order('version', { ascending: false });
    if (error) throw dbError(error);
    return (data ?? []).map((row) => ({ version: row.version, changeKind: row.change_kind, summary: row.summary ?? undefined, createdAt: row.created_at }));
  }

  async getVersion(id: string, version: number): Promise<TripVersion | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from('trip_versions').select('version, change_kind, summary, created_at, itinerary').eq('trip_id', id).eq('version', version).maybeSingle();
    if (error) throw dbError(error);
    return data ? { version: data.version, changeKind: data.change_kind, summary: data.summary ?? undefined, createdAt: data.created_at, itinerary: data.itinerary } : null;
  }
}

interface ProfileRow {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  bio: string | null;
  interests: string[] | null;
  avatar_url: string | null;
  public_headline: string | null;
  role: Profile['role'];
  status: Profile['status'];
  created_at: string;
}

function toProfile(row: ProfileRow, email?: string): Profile {
  return {
    id: row.id,
    email,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date ?? undefined,
    bio: row.bio ?? undefined,
    interests: row.interests ?? [],
    avatarUrl: row.avatar_url ?? undefined,
    publicHeadline: row.public_headline ?? undefined,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
  };
}

class SupabaseAccountRepository implements AccountRepository {
  constructor(private readonly db: SupabaseClient, private readonly user: AuthUser) {}

  async getProfile(): Promise<Profile | null> {
    const { data, error } = await this.db.from('profiles').select('*').eq('id', this.user.id).maybeSingle();
    if (error) throw dbError(error);
    return data ? toProfile(data as ProfileRow, this.user.email) : null;
  }

  async updateProfile(patch: ProfilePatch): Promise<Profile> {
    const changes: Record<string, unknown> = {};
    if (patch.firstName !== undefined) changes['first_name'] = patch.firstName;
    if (patch.lastName !== undefined) changes['last_name'] = patch.lastName;
    if (patch.bio !== undefined) changes['bio'] = patch.bio || null;
    if (patch.interests !== undefined) changes['interests'] = patch.interests;
    if (patch.publicHeadline !== undefined) changes['public_headline'] = patch.publicHeadline || null;
    const { data, error } = await this.db.from('profiles').update(changes).eq('id', this.user.id).select('*').single();
    if (error) throw dbError(error);
    return toProfile(data as ProfileRow, this.user.email);
  }

  async getPreferences(): Promise<Preferences> {
    const { data, error } = await this.db.from('user_preferences').select('theme, onboarding_completed_at').eq('user_id', this.user.id).maybeSingle();
    if (error) throw dbError(error);
    return { theme: data?.theme ?? 'light', onboardingCompletedAt: data?.onboarding_completed_at ?? undefined };
  }

  async updatePreferences(patch: Partial<Preferences>): Promise<Preferences> {
    const row: Record<string, unknown> = { user_id: this.user.id };
    if (patch.theme) row['theme'] = patch.theme;
    if (patch.onboardingCompletedAt !== undefined) row['onboarding_completed_at'] = patch.onboardingCompletedAt;
    const { data, error } = await this.db.from('user_preferences').upsert(row).select('theme, onboarding_completed_at').single();
    if (error) throw dbError(error);
    return { theme: data.theme, onboardingCompletedAt: data.onboarding_completed_at ?? undefined };
  }

  async listSavedIdeas(): Promise<string[]> {
    const { data, error } = await this.db.from('saved_group_trips').select('group_trip_id').order('created_at', { ascending: false });
    if (error) throw dbError(error);
    return (data ?? []).map((row) => row.group_trip_id as string);
  }

  async saveIdea(id: string): Promise<void> {
    const { error } = await this.db.from('saved_group_trips').upsert({ user_id: this.user.id, group_trip_id: id });
    if (error) throw dbError(error);
  }

  async removeIdea(id: string): Promise<void> {
    const { error } = await this.db.from('saved_group_trips').delete().eq('group_trip_id', id);
    if (error) throw dbError(error);
  }

  async record(entry: AuditEntry): Promise<void> {
    const { error } = await this.db.from('audit_log').insert({
      actor_id: this.user.id,
      action: entry.action,
      entity: entry.entity ?? null,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    });
    if (error) console.warn('[audit] registrazione non riuscita:', error.message);
  }

  async listActivity(limit = 50): Promise<AuditEntry[]> {
    const { data, error } = await this.db.from('audit_log').select('action, entity, entity_id, metadata, created_at').eq('actor_id', this.user.id).order('created_at', { ascending: false }).limit(limit);
    if (error) throw dbError(error);
    return (data ?? []).map((row) => ({ action: row.action, entity: row.entity ?? undefined, entityId: row.entity_id ?? undefined, metadata: row.metadata ?? {}, createdAt: row.created_at }));
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Archivio su Supabase: ogni richiesta usa un client con il token dell'utente. */
export function supabaseDataStore(config: AppConfig): DataStore {
  const catalog = supabaseCatalog(config);
  return {
    trips: (user) => new SupabaseTripsRepository(userClient(config, user.accessToken)),
    account: (user) => new SupabaseAccountRepository(userClient(config, user.accessToken), user),
    catalog: catalog.catalog,
    coordinator: catalog.coordinator,
    saved: catalog.saved,
    ...supabaseCommunity(config),
  };
}
