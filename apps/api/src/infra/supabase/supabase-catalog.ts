import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { asSavedTrip, type Itinerary } from '@odys/domain';
import type { AppConfig } from '../../config/env';
import type { AuthUser } from '../../shared/auth';
import {
  COORDINATOR_GUIDELINES_VERSION,
  displayName,
  effectiveStatus,
  type CatalogFilters,
  type CatalogRepository,
  type CoordinatorCard,
  type CoordinatorRepository,
  type PublishedTrip,
  type PublishedTripInput,
  type PublishedTripStatus,
  type PublishedTripSummary,
  type SavedTripsRepository,
} from '../../shared/catalog';
import type { StoredTrip } from '../../shared/data';
import { dbError, userClient } from './client';

interface PublishedRow {
  id: string;
  coordinator_id: string;
  source_trip_id: string | null;
  status: PublishedTripStatus;
  title: string;
  summary: string;
  destination: string;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  price_cents: number | null;
  currency: string;
  capacity: number | null;
  included: string[] | null;
  excluded: string[] | null;
  cover_image_url: string | null;
  itinerary?: Itinerary;
  scheduled_for: string | null;
  published_at: string | null;
  updated_at: string;
}

interface CoordinatorRow {
  id: string;
  first_name: string;
  last_initial: string;
  public_headline: string | null;
  bio: string | null;
  interests: string[] | null;
  avatar_url: string | null;
  created_at: string;
}

const SUMMARY_COLUMNS = 'id, coordinator_id, source_trip_id, status, title, summary, destination, start_date, end_date, duration_days, price_cents, currency, capacity, included, excluded, cover_image_url, scheduled_for, published_at, updated_at';
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, itinerary`;

function toCard(row: CoordinatorRow | undefined, id: string): CoordinatorCard {
  if (!row) return { id, displayName: 'Coordinatore Odys', interests: [] };
  return {
    id: row.id,
    displayName: displayName(row.first_name, row.last_initial),
    headline: row.public_headline ?? undefined,
    bio: row.bio ?? undefined,
    interests: row.interests ?? [],
    avatarUrl: row.avatar_url ?? undefined,
    memberSince: row.created_at,
  };
}

function toSummary(row: PublishedRow, coordinator: CoordinatorCard): PublishedTripSummary {
  return {
    id: row.id,
    status: row.status,
    effectiveStatus: effectiveStatus(row.status, row.start_date ?? undefined, row.end_date ?? undefined, row.scheduled_for ?? undefined),
    title: row.title,
    summary: row.summary,
    destination: row.destination,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    durationDays: row.duration_days ?? undefined,
    priceCents: row.price_cents ?? undefined,
    currency: row.currency,
    capacity: row.capacity ?? undefined,
    coverImageUrl: row.cover_image_url ?? undefined,
    publishedAt: row.published_at ?? undefined,
    scheduledFor: row.scheduled_for ?? undefined,
    updatedAt: row.updated_at,
    coordinator,
  };
}

function toDetail(row: PublishedRow, coordinator: CoordinatorCard): PublishedTrip {
  return {
    ...toSummary(row, coordinator),
    included: row.included ?? [],
    excluded: row.excluded ?? [],
    itinerary: row.itinerary as Itinerary,
    sourceTripId: row.source_trip_id ?? undefined,
  };
}

async function coordinatorCards(db: SupabaseClient, ids: string[]): Promise<Map<string, CoordinatorCard>> {
  const unique = Array.from(new Set(ids));
  if (!unique.length) return new Map();
  const { data, error } = await db.from('coordinator_profiles').select('*').in('id', unique);
  if (error) throw dbError(error);
  return new Map(unique.map((id) => [id, toCard((data as CoordinatorRow[]).find((row) => row.id === id), id)]));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Lettura pubblica: client anonimo, valgono le regole RLS per i visitatori. */
class SupabaseCatalogRepository implements CatalogRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(filters: CatalogFilters): Promise<PublishedTripSummary[]> {
    let query = this.db.from('published_trips').select(SUMMARY_COLUMNS);
    if (filters.destination) query = query.ilike('destination', `%${filters.destination.replace(/[%_]/g, '')}%`);
    if (filters.coordinatorId && isUuid(filters.coordinatorId)) query = query.eq('coordinator_id', filters.coordinatorId);
    if (filters.maxPriceCents !== undefined) query = query.lte('price_cents', filters.maxPriceCents);
    if (filters.q) {
      const term = filters.q.replace(/[%_,()]/g, ' ').trim();
      if (term) query = query.or(`title.ilike.%${term}%,destination.ilike.%${term}%,summary.ilike.%${term}%`);
    }
    query = filters.sort === 'price' ? query.order('price_cents', { ascending: true, nullsFirst: false })
      : filters.sort === 'recent' ? query.order('published_at', { ascending: false, nullsFirst: false })
        : query.order('start_date', { ascending: true, nullsFirst: false });
    const { data, error } = await query.limit(100);
    if (error) throw dbError(error);
    const rows = data as PublishedRow[];
    const cards = await coordinatorCards(this.db, rows.map((row) => row.coordinator_id));
    return rows
      .map((row) => toSummary(row, cards.get(row.coordinator_id)!))
      .filter((trip) => filters.includeCompleted || trip.effectiveStatus !== 'completed');
  }

  async get(id: string): Promise<PublishedTrip | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from('published_trips').select(DETAIL_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw dbError(error);
    if (!data) return null;
    const row = data as PublishedRow;
    const cards = await coordinatorCards(this.db, [row.coordinator_id]);
    return toDetail(row, cards.get(row.coordinator_id)!);
  }

  async getMany(ids: string[]): Promise<PublishedTripSummary[]> {
    const valid = ids.filter(isUuid);
    if (!valid.length) return [];
    const { data, error } = await this.db.from('published_trips').select(SUMMARY_COLUMNS).in('id', valid);
    if (error) throw dbError(error);
    const rows = data as PublishedRow[];
    const cards = await coordinatorCards(this.db, rows.map((row) => row.coordinator_id));
    const byId = new Map(rows.map((row) => [row.id, toSummary(row, cards.get(row.coordinator_id)!)]));
    return valid.map((id) => byId.get(id)).filter((trip): trip is PublishedTripSummary => Boolean(trip));
  }

  async confirmedCount(id: string): Promise<number> {
    if (!isUuid(id)) return 0;
    const { data, error } = await this.db.rpc('published_trip_confirmed_count', { p_published_trip_id: id });
    if (error) throw dbError(error);
    return Number(data ?? 0);
  }

  async coordinator(id: string): Promise<CoordinatorCard | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from('coordinator_profiles').select('*').eq('id', id).maybeSingle();
    if (error) throw dbError(error);
    return data ? toCard(data as CoordinatorRow, id) : null;
  }
}

function inputToRow(input: Partial<PublishedTripInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (input.title !== undefined) row['title'] = input.title;
  if (input.summary !== undefined) row['summary'] = input.summary;
  if (input.destination !== undefined) row['destination'] = input.destination;
  if (input.startDate !== undefined) row['start_date'] = input.startDate || null;
  if (input.endDate !== undefined) row['end_date'] = input.endDate || null;
  if (input.priceCents !== undefined) row['price_cents'] = input.priceCents;
  if (input.capacity !== undefined) row['capacity'] = input.capacity;
  if (input.included !== undefined) row['included'] = input.included;
  if (input.excluded !== undefined) row['excluded'] = input.excluded;
  if (input.coverImageUrl !== undefined) row['cover_image_url'] = input.coverImageUrl || null;
  if (input.itinerary !== undefined) row['itinerary'] = input.itinerary;
  if (input.sourceTripId !== undefined) row['source_trip_id'] = input.sourceTripId || null;
  return row;
}

/** Operazioni del coordinatore: client con il token dell'utente (RLS: solo i propri viaggi). */
class SupabaseCoordinatorRepository implements CoordinatorRepository {
  constructor(private readonly db: SupabaseClient, private readonly user: AuthUser) {}

  async isCoordinator(): Promise<boolean> {
    const { data, error } = await this.db.from('profiles').select('role, status').eq('id', this.user.id).maybeSingle();
    if (error) throw dbError(error);
    return Boolean(data && (data.role === 'coordinator' || data.role === 'admin') && data.status === 'active');
  }

  async hasAcceptedGuidelines(): Promise<boolean> {
    const { data, error } = await this.db.from('consents').select('granted').eq('user_id', this.user.id)
      .eq('kind', 'coordinator_guidelines').eq('version', COORDINATOR_GUIDELINES_VERSION).order('created_at', { ascending: false }).limit(1);
    if (error) throw dbError(error);
    return Boolean(data?.[0]?.granted);
  }

  async acceptGuidelines(): Promise<void> {
    const { error } = await this.db.from('consents').insert({ user_id: this.user.id, kind: 'coordinator_guidelines', version: COORDINATOR_GUIDELINES_VERSION, granted: true });
    if (error) throw dbError(error);
  }

  private async withCard(rows: PublishedRow[]): Promise<PublishedTrip[]> {
    const cards = await coordinatorCards(this.db, rows.map((row) => row.coordinator_id));
    return rows.map((row) => toDetail(row, cards.get(row.coordinator_id)!));
  }

  async list(): Promise<PublishedTrip[]> {
    const { data, error } = await this.db.from('published_trips').select(DETAIL_COLUMNS).eq('coordinator_id', this.user.id).order('updated_at', { ascending: false });
    if (error) throw dbError(error);
    return this.withCard(data as PublishedRow[]);
  }

  async get(id: string): Promise<PublishedTrip | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from('published_trips').select(DETAIL_COLUMNS).eq('id', id).eq('coordinator_id', this.user.id).maybeSingle();
    if (error) throw dbError(error);
    return data ? (await this.withCard([data as PublishedRow]))[0] : null;
  }

  async create(input: PublishedTripInput): Promise<PublishedTrip> {
    const { data, error } = await this.db.from('published_trips').insert({ ...inputToRow(input), coordinator_id: this.user.id, status: 'draft' }).select(DETAIL_COLUMNS).single();
    if (error) throw dbError(error);
    return (await this.withCard([data as PublishedRow]))[0];
  }

  async update(id: string, patch: Partial<PublishedTripInput>): Promise<PublishedTrip | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from('published_trips').update(inputToRow(patch)).eq('id', id).eq('coordinator_id', this.user.id).select(DETAIL_COLUMNS).maybeSingle();
    if (error) throw dbError(error);
    return data ? (await this.withCard([data as PublishedRow]))[0] : null;
  }

  async setStatus(id: string, status: PublishedTripStatus, scheduledFor?: string): Promise<PublishedTrip | null> {
    if (!isUuid(id)) return null;
    const changes: Record<string, unknown> = { status, scheduled_for: status === 'scheduled' ? scheduledFor ?? null : null };
    const { data, error } = await this.db.from('published_trips').update(changes).eq('id', id).eq('coordinator_id', this.user.id).select(DETAIL_COLUMNS).maybeSingle();
    if (error) throw dbError(error);
    return data ? (await this.withCard([data as PublishedRow]))[0] : null;
  }
}

class SupabaseSavedTripsRepository implements SavedTripsRepository {
  constructor(private readonly db: SupabaseClient, private readonly user: AuthUser) {}

  async listIds(): Promise<string[]> {
    const { data, error } = await this.db.from('saved_published_trips').select('published_trip_id').order('created_at', { ascending: false });
    if (error) throw dbError(error);
    return (data ?? []).map((row) => row.published_trip_id as string);
  }

  async save(id: string): Promise<void> {
    if (!isUuid(id)) throw dbError({ code: 'P0002' });
    const { error } = await this.db.from('saved_published_trips').upsert({ user_id: this.user.id, published_trip_id: id });
    if (error) throw dbError(error.code === '23503' ? { code: 'P0002' } : error);
  }

  async remove(id: string): Promise<void> {
    if (!isUuid(id)) return;
    const { error } = await this.db.from('saved_published_trips').delete().eq('published_trip_id', id);
    if (error) throw dbError(error);
  }

  async copy(id: string): Promise<StoredTrip> {
    if (!isUuid(id)) throw dbError({ code: 'P0002' });
    const { data, error } = await this.db.rpc('copy_published_trip', { p_published_trip_id: id }).single();
    if (error) throw dbError(error);
    const row = data as { id: string; title: string; itinerary: Itinerary; current_version: number; created_at: string; updated_at: string };
    const trip = asSavedTrip({ id: row.id, title: row.title, itinerary: row.itinerary, createdAt: row.created_at, updatedAt: row.updated_at, planVersion: 5 });
    if (!trip) throw dbError({ message: 'Copia non valida.' });
    return { ...trip, currentVersion: row.current_version };
  }
}

const SERVER_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

export function supabaseCatalog(config: AppConfig) {
  const anon = config.supabase.url && config.supabase.anonKey ? createClient(config.supabase.url, config.supabase.anonKey, SERVER_OPTIONS) : null;
  return {
    catalog: (): CatalogRepository => {
      if (!anon) throw dbError({ code: 'not_configured' });
      return new SupabaseCatalogRepository(anon);
    },
    coordinator: (user: AuthUser): CoordinatorRepository => new SupabaseCoordinatorRepository(userClient(config, user.accessToken), user),
    saved: (user: AuthUser): SavedTripsRepository => new SupabaseSavedTripsRepository(userClient(config, user.accessToken), user),
  };
}
