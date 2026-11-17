import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { asSavedTrip, normalizeCostItems, type Itinerary } from '@odys/domain';
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
  type CoordinatorAnalytics,
  type OrganizerAgency,
  type TripPricing,
  type PublishedTrip,
  type PublishedTripInput,
  type PublishedTripStatus,
  type PublishedTripSummary,
  type SavedTripsRepository,
  type TripVisibility,
  type PublicReview,
  type PlaceStory,
} from '../../shared/catalog';
import type { StoredTrip } from '../../shared/data';
import { dbError, userClient } from './client';

interface PublishedRow {
  id: string;
  coordinator_id: string | null;
  agency_id?: string | null;
  agency_owned?: boolean;
  approval_status?: 'pending' | 'approved' | 'rejected' | null;
  approval_note?: string | null;
  approval_requested_at?: string | null;
  series_id?: string | null;
  organizer?: 'coordinator' | 'agency';
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
  place_stories?: PlaceStory[] | null;
  scheduled_for: string | null;
  published_at: string | null;
  updated_at: string;
  country: string;
  region: string;
  interests: string[] | null;
  deposit_cents: number | null;
  balance_due_date: string | null;
  visibility: TripVisibility;
  age_min: number | null;
  age_max: number | null;
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
  rating: number | string | null;
  reviews_count: number | null;
  followers: number | null;
  trips_completed: number | null;
  languages?: string[] | null;
  verified?: boolean | null;
}

const SUMMARY_COLUMNS = 'id, coordinator_id, source_trip_id, status, title, summary, destination, start_date, end_date, duration_days, price_cents, currency, capacity, included, excluded, cover_image_url, scheduled_for, published_at, updated_at, country, region, interests, deposit_cents, balance_due_date, visibility, age_min, age_max, agency_id, agency_owned, series_id, organizer';
// `place_stories` non è tra le colonne leggibili: il testo esce solo dalla funzione che verifica il diritto (TP-08).
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, itinerary`;
// Area coordinatore e agenzia (solo utenti collegati): anche lo stato della proposta all'agenzia (AG-05).
const OWNER_COLUMNS = `${DETAIL_COLUMNS}, approval_status, approval_note, approval_requested_at`;

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
    rating: row.rating === null || row.rating === undefined ? undefined : Number(row.rating),
    reviewsCount: row.reviews_count ?? 0,
    followers: row.followers ?? 0,
    tripsCompleted: row.trips_completed ?? 0,
    languages: row.languages ?? [],
    verified: Boolean(row.verified),
  };
}

/** Partenza d'agenzia ancora senza coordinatore (AG-04). */
const UNASSIGNED: CoordinatorCard = { id: '', displayName: 'Coordinatore da assegnare', interests: [] };

interface Context { cards: Map<string, CoordinatorCard>; agencies: Map<string, OrganizerAgency> }

/** Card dei coordinatori e agenzie organizzatrici (AG-12) di un gruppo di righe, in due letture. */
async function contextFor(db: SupabaseClient, rows: PublishedRow[]): Promise<Context> {
  const agencyIds = Array.from(new Set(rows.filter((row) => row.organizer === 'agency' && row.agency_id).map((row) => row.agency_id!)));
  const [cards, agencies] = await Promise.all([
    coordinatorCards(db, rows.map((row) => row.coordinator_id).filter((id): id is string => Boolean(id))),
    agencyIds.length ? db.from('agency_profiles').select('id, display_name, slug, sale_terms').in('id', agencyIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (agencies.error) throw dbError(agencies.error);
  const byId = new Map((agencies.data as Array<{ id: string; display_name: string; slug: string; sale_terms: string | null }>).map((row) => [row.id, { id: row.id, name: row.display_name, slug: row.slug, saleTerms: row.sale_terms ?? '' }]));
  return { cards, agencies: byId };
}

function summaryOf(row: PublishedRow, context: Context): PublishedTripSummary {
  return toSummary(row, row.coordinator_id ? context.cards.get(row.coordinator_id) ?? UNASSIGNED : UNASSIGNED, row.agency_id ? context.agencies.get(row.agency_id) : undefined);
}

function detailOf(row: PublishedRow, context: Context): PublishedTrip {
  return toDetail(row, row.coordinator_id ? context.cards.get(row.coordinator_id) ?? UNASSIGNED : UNASSIGNED, row.agency_id ? context.agencies.get(row.agency_id) : undefined);
}

function toSummary(row: PublishedRow, coordinator: CoordinatorCard, agency?: OrganizerAgency): PublishedTripSummary {
  return {
    organizer: row.organizer ?? 'coordinator',
    organizerAgency: row.organizer === 'agency' ? agency : undefined,
    agencyId: row.agency_id ?? undefined,
    agencyOwned: row.agency_owned ?? false,
    seriesId: row.series_id ?? undefined,
    approvalStatus: row.approval_status ?? undefined,
    approvalNote: row.approval_note ?? undefined,
    approvalRequestedAt: row.approval_requested_at ?? undefined,
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
    country: row.country,
    region: row.region,
    interests: row.interests ?? [],
    depositCents: row.deposit_cents ?? undefined,
    balanceDueDate: row.balance_due_date ?? undefined,
    visibility: row.visibility,
    ageMin: row.age_min ?? undefined,
    ageMax: row.age_max ?? undefined,
  };
}

function toDetail(row: PublishedRow, coordinator: CoordinatorCard, agency?: OrganizerAgency): PublishedTrip {
  return {
    ...toSummary(row, coordinator, agency),
    included: row.included ?? [],
    excluded: row.excluded ?? [],
    itinerary: row.itinerary as Itinerary,
    sourceTripId: row.source_trip_id ?? undefined,
  };
}

/** Storie dei luoghi: il database le restituisce solo a chi ne ha diritto (null per gli altri) e dice sempre quante sono. */
async function withStories(db: SupabaseClient, trip: PublishedTrip): Promise<PublishedTrip> {
  const [stories, count] = await Promise.all([
    db.rpc('published_trip_place_stories', { p_published_trip_id: trip.id }),
    db.rpc('published_trip_place_stories_count', { p_published_trip_id: trip.id }),
  ]);
  // Chi non ha fatto l'accesso non può nemmeno chiamare la funzione del testo: vale come «nessun diritto».
  const list = stories.error ? null : (stories.data as PlaceStory[] | null);
  return { ...trip, placeStories: list ?? undefined, placeStoriesCount: count.error ? list?.length ?? 0 : Number(count.data ?? 0) };
}

/** Colonne e card dei viaggi per il catalogo dell'agenzia (AG-03). */
export const SUMMARY_COLUMNS_FOR_AGENCY = `${SUMMARY_COLUMNS}, approval_status, approval_note, approval_requested_at`;
export async function summariesOf(db: SupabaseClient, rows: unknown[]): Promise<PublishedTripSummary[]> {
  const typed = rows as PublishedRow[];
  const context = await contextFor(db, typed);
  return typed.map((row) => summaryOf(row, context));
}

/** Card pubbliche dei coordinatori per id (usate anche dalla pagina dell'agenzia, AG-01). */
export const coordinatorCardsById = (db: SupabaseClient, ids: string[]) => coordinatorCards(db, ids);

async function coordinatorCards(db: SupabaseClient, ids: string[]): Promise<Map<string, CoordinatorCard>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
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
    // Ricerca libera, interessi, mese, durata e ordinamento li applica `refineCatalog`, uguale per ogni archivio.
    const { data, error } = await query.order('start_date', { ascending: true, nullsFirst: false }).limit(300);
    if (error) throw dbError(error);
    const rows = data as PublishedRow[];
    const context = await contextFor(this.db, rows);
    return rows
      .map((row) => summaryOf(row, context))
      .filter((trip) => filters.includeCompleted || trip.effectiveStatus !== 'completed');
  }

  async get(id: string): Promise<PublishedTrip | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from('published_trips').select(DETAIL_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw dbError(error);
    if (!data) return null;
    const row = data as PublishedRow;
    return withStories(this.db, detailOf(row, await contextFor(this.db, [row])));
  }

  async getMany(ids: string[]): Promise<PublishedTripSummary[]> {
    const valid = ids.filter(isUuid);
    if (!valid.length) return [];
    const { data, error } = await this.db.from('published_trips').select(SUMMARY_COLUMNS).in('id', valid);
    if (error) throw dbError(error);
    const rows = data as PublishedRow[];
    const context = await contextFor(this.db, rows);
    const byId = new Map(rows.map((row) => [row.id, summaryOf(row, context)]));
    return valid.map((id) => byId.get(id)).filter((trip): trip is PublishedTripSummary => Boolean(trip));
  }

  async seatsTaken(ids: string[]): Promise<Map<string, number>> {
    const valid = ids.filter(isUuid);
    if (!valid.length) return new Map();
    const { data, error } = await this.db.rpc('published_trips_seats_taken', { p_trip_ids: valid });
    if (error) throw dbError(error);
    return new Map((data as Array<{ trip_id: string; taken: number }>).map((row) => [row.trip_id, Number(row.taken)]));
  }

  async reviews(coordinatorId: string): Promise<PublicReview[]> {
    if (!isUuid(coordinatorId)) return [];
    const { data, error } = await this.db.rpc('coordinator_reviews', { p_coordinator_id: coordinatorId, p_limit: 20 });
    if (error) throw dbError(error);
    return (data as Array<Record<string, unknown>>).map((row) => ({
      id: row['id'] as string, tripId: row['published_trip_id'] as string, tripTitle: row['trip_title'] as string, tripDestination: row['trip_destination'] as string,
      tripEnd: (row['trip_end'] as string | null) ?? undefined, authorName: row['author_name'] as string, authorInitials: row['author_initials'] as string,
      coordinatorRating: Number(row['coordinator_rating']), tripRating: Number(row['trip_rating']), body: row['body'] as string, createdAt: row['created_at'] as string,
    }));
  }

  async participantInitials(id: string): Promise<string[]> {
    if (!isUuid(id)) return [];
    const { data, error } = await this.db.rpc('published_trip_participant_initials', { p_published_trip_id: id });
    if (error) throw dbError(error);
    return (data as string[] | null) ?? [];
  }

  async recordView(id: string): Promise<void> {
    if (!isUuid(id)) return;
    const { error } = await this.db.rpc('record_trip_view', { p_published_trip_id: id });
    if (error) console.warn('[eventi] visualizzazione non registrata:', error.message);
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
  if (input.country !== undefined) row['country'] = input.country;
  if (input.region !== undefined) row['region'] = input.region;
  if (input.interests !== undefined) row['interests'] = input.interests;
  if (input.depositCents !== undefined) row['deposit_cents'] = input.depositCents;
  if (input.balanceDueDate !== undefined) row['balance_due_date'] = input.balanceDueDate || null;
  if (input.visibility !== undefined) row['visibility'] = input.visibility;
  if (input.placeStories !== undefined) row['place_stories'] = input.placeStories;
  if (input.ageMin !== undefined) row['age_min'] = input.ageMin;
  if (input.ageMax !== undefined) row['age_max'] = input.ageMax;
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
    const context = await contextFor(this.db, rows);
    return rows.map((row) => detailOf(row, context));
  }

  async list(): Promise<PublishedTrip[]> {
    const { data, error } = await this.db.from('published_trips').select(OWNER_COLUMNS).eq('coordinator_id', this.user.id).order('updated_at', { ascending: false });
    if (error) throw dbError(error);
    return this.withCard(data as PublishedRow[]);
  }

  async get(id: string): Promise<PublishedTrip | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from('published_trips').select(OWNER_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw dbError(error);
    if (!data || !(await this.manages(data as PublishedRow))) return null;
    return withStories(this.db, (await this.withCard([data as PublishedRow]))[0]);
  }

  /** Il viaggio è mio, oppure sono staff della sua agenzia (catalogo o ombrello): come le policy SQL. */
  private async manages(row: PublishedRow): Promise<boolean> {
    if (row.coordinator_id === this.user.id) return true;
    if (!row.agency_id) return false;
    const { data, error } = await this.db.rpc('agency_staff', { p_agency_id: row.agency_id });
    if (error) throw dbError(error);
    return Boolean(data);
  }

  async create(input: PublishedTripInput): Promise<PublishedTrip> {
    const ownership = input.agencyId
      ? { coordinator_id: null, agency_id: input.agencyId, agency_owned: true, organizer: 'agency' }
      : { coordinator_id: this.user.id };
    const { data, error } = await this.db.from('published_trips').insert({ ...inputToRow(input), ...ownership, status: 'draft' }).select(OWNER_COLUMNS).single();
    if (error) throw dbError(error);
    return withStories(this.db, (await this.withCard([data as PublishedRow]))[0]);
  }

  async update(id: string, patch: Partial<PublishedTripInput>): Promise<PublishedTrip | null> {
    if (!isUuid(id)) return null;
    if (!(await this.get(id))) return null;
    const { data, error } = await this.db.from('published_trips').update(inputToRow(patch)).eq('id', id).select(OWNER_COLUMNS).maybeSingle();
    if (error) throw dbError(error);
    return data ? withStories(this.db, (await this.withCard([data as PublishedRow]))[0]) : null;
  }

  async setStatus(id: string, status: PublishedTripStatus, scheduledFor?: string): Promise<PublishedTrip | null> {
    if (!isUuid(id)) return null;
    const changes: Record<string, unknown> = { status, scheduled_for: status === 'scheduled' ? scheduledFor ?? null : null };
    if (!(await this.get(id))) return null;
    const { data, error } = await this.db.from('published_trips').update(changes).eq('id', id).select(OWNER_COLUMNS).maybeSingle();
    if (error) throw dbError(error);
    return data ? withStories(this.db, (await this.withCard([data as PublishedRow]))[0]) : null;
  }

  async pricing(id: string): Promise<TripPricing | null> {
    if (!(await this.get(id))) return null;
    const { data, error } = await this.db.from('published_trip_pricing').select('cost_items, target_earnings_cents, updated_at').eq('published_trip_id', id).maybeSingle();
    if (error) throw dbError(error);
    return data ? toPricing(data as PricingRow) : { costs: [], targetEarningsCents: null };
  }

  async requestApproval(id: string): Promise<PublishedTrip | null> {
    if (!isUuid(id)) return null;
    const { error } = await this.db.rpc('request_agency_approval', { p_trip_id: id });
    if (error) throw dbError(error);
    return this.get(id);
  }

  async analytics(since: string): Promise<CoordinatorAnalytics> {
    const { data, error } = await this.db.rpc('coordinator_analytics', { p_since: since });
    if (error) throw dbError(error);
    const raw = (data ?? {}) as Partial<CoordinatorAnalytics>;
    return { events: raw.events ?? [], payments: raw.payments ?? [], posts: (raw.posts ?? []).map((post) => ({ ...post, views: Number(post.views), saves: Number(post.saves), bookings: Number(post.bookings) })) };
  }

  async remindBalance(requestId: string): Promise<string> {
    if (!isUuid(requestId)) throw dbError({ code: 'P0002', message: 'Richiesta non trovata.' });
    const { data, error } = await this.db.rpc('remind_balance', { p_request_id: requestId });
    if (error) throw dbError(error);
    return String(data);
  }

  async savePricing(id: string, pricing: TripPricing): Promise<TripPricing | null> {
    if (!(await this.get(id))) return null;
    const { data, error } = await this.db.from('published_trip_pricing')
      .upsert({ published_trip_id: id, cost_items: pricing.costs, target_earnings_cents: pricing.targetEarningsCents }, { onConflict: 'published_trip_id' })
      .select('cost_items, target_earnings_cents, updated_at').single();
    if (error) throw dbError(error);
    return toPricing(data as PricingRow);
  }
}

interface PricingRow { cost_items: unknown; target_earnings_cents: number | null; updated_at: string }

function toPricing(row: PricingRow): TripPricing {
  let costs: TripPricing['costs'] = [];
  try { costs = normalizeCostItems(row.cost_items); } catch { costs = []; }
  return { costs, targetEarningsCents: row.target_earnings_cents, updatedAt: row.updated_at };
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
    catalog: (user?: AuthUser): CatalogRepository => {
      if (!anon) throw dbError({ code: 'not_configured' });
      // Con l'accesso valgono le regole RLS dell'utente: vede anche i viaggi «Solo follower» di chi segue.
      return new SupabaseCatalogRepository(user ? userClient(config, user.accessToken) : anon);
    },
    coordinator: (user: AuthUser): CoordinatorRepository => new SupabaseCoordinatorRepository(userClient(config, user.accessToken), user),
    saved: (user: AuthUser): SavedTripsRepository => new SupabaseSavedTripsRepository(userClient(config, user.accessToken), user),
  };
}
