import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../../config/env';
import type { AuthUser } from '../../shared/auth';
import {
  effectivePostStatus,
  mediaKey,
  type CreatorFeedRepository,
  type CreatorInteractionsRepository,
  type CreatorMedia,
  type CreatorMediaInput,
  type CreatorMediaStatus,
  type CreatorPost,
  type CreatorPostInput,
  type CreatorPostStatus,
  type CreatorStore,
  type CreatorStudioRepository,
  type FeedQuery,
  type MediaStorage,
} from '../../shared/creator';
import { dbError, userClient } from './client';

const BUCKET = 'creator-media';
const SIGNED_URL_SECONDS = 60 * 60;

interface PostRow {
  id: string;
  author_id: string;
  status: CreatorPostStatus;
  caption: string;
  location_label: string | null;
  location_latitude: number | null;
  location_longitude: number | null;
  location_osm_id: string | null;
  published_trip_id: string | null;
  link_access: 'free' | 'paid';
  rights_confirmed_at: string | null;
  scheduled_for: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  creator_post_media?: MediaRow[];
}

interface MediaRow {
  id: string;
  post_id: string;
  kind: 'image' | 'video';
  mime_type: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  size_bytes: number | null;
  sort_order: number;
  status: CreatorMediaStatus;
  original_key: string;
  display_key: string | null;
  thumbnail_key: string | null;
  created_at: string;
}

const MEDIA_COLUMNS = 'id, post_id, kind, mime_type, width, height, duration_ms, size_bytes, sort_order, status, original_key, display_key, thumbnail_key, created_at';
const POST_COLUMNS = `id, author_id, status, caption, location_label, location_latitude, location_longitude, location_osm_id, published_trip_id, link_access, rights_confirmed_at, scheduled_for, published_at, created_at, updated_at, creator_post_media (${MEDIA_COLUMNS})`;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function toMedia(row: MediaRow): CreatorMedia {
  return {
    id: row.id,
    postId: row.post_id,
    kind: row.kind,
    mimeType: row.mime_type,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
    sortOrder: row.sort_order,
    status: row.status,
    originalKey: row.original_key,
    displayKey: row.display_key ?? undefined,
    thumbnailKey: row.thumbnail_key ?? undefined,
  };
}

function toPost(row: PostRow): CreatorPost {
  const media = (row.creator_post_media ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
    .map(toMedia);
  return {
    id: row.id,
    authorId: row.author_id,
    status: row.status,
    effectiveStatus: effectivePostStatus(row.status, row.scheduled_for ?? undefined),
    caption: row.caption,
    location: row.location_label ? {
      label: row.location_label,
      latitude: row.location_latitude ?? undefined,
      longitude: row.location_longitude ?? undefined,
      osmId: row.location_osm_id ?? undefined,
    } : undefined,
    publishedTripId: row.published_trip_id ?? undefined,
    linkAccess: row.link_access,
    rightsConfirmed: Boolean(row.rights_confirmed_at),
    scheduledFor: row.scheduled_for ?? undefined,
    publishedAt: row.published_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    media,
  };
}

function inputToRow(input: CreatorPostInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (input.caption !== undefined) row['caption'] = input.caption;
  if (input.location !== undefined) {
    row['location_label'] = input.location?.label ?? null;
    row['location_latitude'] = input.location?.latitude ?? null;
    row['location_longitude'] = input.location?.longitude ?? null;
    row['location_osm_id'] = input.location?.osmId ?? null;
  }
  if (input.publishedTripId !== undefined) row['published_trip_id'] = input.publishedTripId;
  if (input.linkAccess !== undefined) row['link_access'] = input.linkAccess;
  if (input.rightsConfirmed !== undefined) row['rights_confirmed_at'] = input.rightsConfirmed ? new Date().toISOString() : null;
  return row;
}

/** Bacheca dell'autore: client con il suo token, le regole RLS limitano ai propri post. */
class SupabaseStudioRepository implements CreatorStudioRepository {
  constructor(private readonly db: SupabaseClient, private readonly user: AuthUser) {}

  private posts() {
    return this.db.from('creator_posts').select(POST_COLUMNS).eq('author_id', this.user.id).is('deleted_at', null);
  }

  async list(): Promise<CreatorPost[]> {
    const { data, error } = await this.posts().order('updated_at', { ascending: false });
    if (error) throw dbError(error);
    return (data as PostRow[]).map(toPost);
  }

  async get(id: string): Promise<CreatorPost | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.posts().eq('id', id).maybeSingle();
    if (error) throw dbError(error);
    return data ? toPost(data as PostRow) : null;
  }

  async create(input: CreatorPostInput): Promise<CreatorPost> {
    const { data, error } = await this.db.from('creator_posts').insert({ ...inputToRow(input), author_id: this.user.id, status: 'draft' }).select(POST_COLUMNS).single();
    if (error) throw dbError(error);
    return toPost(data as PostRow);
  }

  async update(id: string, patch: CreatorPostInput): Promise<CreatorPost | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from('creator_posts').update(inputToRow(patch)).eq('id', id).eq('author_id', this.user.id).is('deleted_at', null).select(POST_COLUMNS).maybeSingle();
    if (error) throw dbError(error);
    return data ? toPost(data as PostRow) : null;
  }

  async setStatus(id: string, status: CreatorPostStatus, scheduledFor?: string): Promise<CreatorPost | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from('creator_posts').update({ status, scheduled_for: status === 'scheduled' ? scheduledFor ?? null : null })
      .eq('id', id).eq('author_id', this.user.id).is('deleted_at', null).select(POST_COLUMNS).maybeSingle();
    if (error) throw dbError(error);
    return data ? toPost(data as PostRow) : null;
  }

  async remove(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { data, error } = await this.db.from('creator_posts').update({ deleted_at: new Date().toISOString(), status: 'archived' }).eq('id', id).eq('author_id', this.user.id).is('deleted_at', null).select('id');
    if (error) throw dbError(error);
    return Boolean(data?.length);
  }

  async addMedia(postId: string, media: CreatorMediaInput): Promise<CreatorMedia> {
    const id = randomUUID();
    const { data, error } = await this.db.from('creator_post_media').insert({
      id,
      post_id: postId,
      author_id: this.user.id,
      kind: media.kind,
      mime_type: media.mimeType,
      width: media.width ?? null,
      height: media.height ?? null,
      duration_ms: media.durationMs ?? null,
      size_bytes: media.sizeBytes,
      sort_order: media.sortOrder,
      original_key: mediaKey(this.user.id, postId, id, 'original', media.extension),
      display_key: media.hasDisplay ? mediaKey(this.user.id, postId, id, 'display', 'webp') : null,
      thumbnail_key: mediaKey(this.user.id, postId, id, 'thumbnail', 'webp'),
      status: 'uploading',
    }).select(MEDIA_COLUMNS).single();
    if (error) throw dbError(error);
    return toMedia(data as MediaRow);
  }

  async setMediaStatus(postId: string, mediaId: string, status: CreatorMediaStatus): Promise<CreatorMedia | null> {
    if (!isUuid(mediaId)) return null;
    const { data, error } = await this.db.from('creator_post_media').update({ status }).eq('id', mediaId).eq('post_id', postId).select(MEDIA_COLUMNS).maybeSingle();
    if (error) throw dbError(error);
    return data ? toMedia(data as MediaRow) : null;
  }

  async removeMedia(postId: string, mediaId: string): Promise<string[] | null> {
    if (!isUuid(mediaId)) return null;
    const { data, error } = await this.db.from('creator_post_media').delete().eq('id', mediaId).eq('post_id', postId).select(MEDIA_COLUMNS);
    if (error) throw dbError(error);
    const row = (data as MediaRow[])[0];
    return row ? [row.original_key, row.display_key, row.thumbnail_key].filter((key): key is string => Boolean(key)) : null;
  }

  async reorderMedia(postId: string, mediaIds: string[]): Promise<CreatorMedia[] | null> {
    for (const [index, id] of mediaIds.entries()) {
      if (!isUuid(id)) return null;
      const { error } = await this.db.from('creator_post_media').update({ sort_order: index }).eq('id', id).eq('post_id', postId);
      if (error) throw dbError(error);
    }
    return (await this.get(postId))?.media ?? null;
  }
}

/** Feed pubblico (o dell'utente collegato): le regole RLS mostrano solo i post visibili. */
class SupabaseFeedRepository implements CreatorFeedRepository {
  constructor(private readonly db: SupabaseClient) {}

  async feed(query: FeedQuery): Promise<CreatorPost[]> {
    let request = this.db.from('creator_posts').select(POST_COLUMNS).is('deleted_at', null).in('status', ['published', 'scheduled'])
      .lte('published_at', new Date().toISOString());
    if (query.authorId && isUuid(query.authorId)) request = request.eq('author_id', query.authorId);
    if (query.before && !Number.isNaN(Date.parse(query.before))) request = request.lt('published_at', query.before);
    const { data, error } = await request.order('published_at', { ascending: false }).limit(query.limit);
    if (error) throw dbError(error);
    return (data as PostRow[]).map(toPost).filter((post) => post.effectiveStatus === 'published');
  }

  async get(id: string): Promise<CreatorPost | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from('creator_posts').select(POST_COLUMNS).eq('id', id).is('deleted_at', null).maybeSingle();
    if (error) throw dbError(error);
    return data ? toPost(data as PostRow) : null;
  }

  async likeCounts(ids: string[]): Promise<Map<string, number>> {
    const valid = ids.filter(isUuid);
    if (!valid.length) return new Map();
    const { data, error } = await this.db.rpc('creator_post_like_counts', { p_post_ids: valid });
    if (error) throw dbError(error);
    return new Map((data as Array<{ post_id: string; likes: number }>).map((row) => [row.post_id, row.likes]));
  }
}

class SupabaseInteractionsRepository implements CreatorInteractionsRepository {
  constructor(private readonly db: SupabaseClient, private readonly user: AuthUser) {}

  private async ids(table: 'creator_post_likes' | 'creator_post_saves', ids: string[]): Promise<Set<string>> {
    const valid = ids.filter(isUuid);
    if (!valid.length) return new Set();
    const { data, error } = await this.db.from(table).select('post_id').eq('user_id', this.user.id).in('post_id', valid);
    if (error) throw dbError(error);
    return new Set((data ?? []).map((row) => row.post_id as string));
  }

  liked(ids: string[]) { return this.ids('creator_post_likes', ids); }
  saved(ids: string[]) { return this.ids('creator_post_saves', ids); }

  async savedIds(): Promise<string[]> {
    const { data, error } = await this.db.from('creator_post_saves').select('post_id').eq('user_id', this.user.id).order('created_at', { ascending: false });
    if (error) throw dbError(error);
    return (data ?? []).map((row) => row.post_id as string);
  }

  private async toggle(table: 'creator_post_likes' | 'creator_post_saves', id: string, on: boolean): Promise<void> {
    if (!isUuid(id)) throw dbError({ code: 'P0002' });
    const { error } = on
      ? await this.db.from(table).upsert({ user_id: this.user.id, post_id: id })
      : await this.db.from(table).delete().eq('user_id', this.user.id).eq('post_id', id);
    // Post non visibile (bozza altrui, eliminato): la regola RLS rifiuta l'inserimento.
    if (error) throw dbError(error.code === '42501' || error.code === '23503' ? { code: 'P0002' } : error);
  }

  setLike(id: string, on: boolean) { return this.toggle('creator_post_likes', id, on); }
  setSave(id: string, on: boolean) { return this.toggle('creator_post_saves', id, on); }
}

/** URL firmati dell'archivio privato: valgono le regole di lettura di chi li chiede. */
class SupabaseMediaStorage implements MediaStorage {
  constructor(private readonly config: AppConfig, private readonly anon: SupabaseClient | null) {}

  async signedUrls(keys: string[], user?: AuthUser): Promise<Map<string, string>> {
    const unique = Array.from(new Set(keys.filter(Boolean)));
    const client = user ? userClient(this.config, user.accessToken) : this.anon;
    if (!unique.length || !client) return new Map();
    const { data, error } = await client.storage.from(BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
    if (error) {
      console.warn('[storage] URL firmati non disponibili:', error.message);
      return new Map();
    }
    return new Map((data ?? []).flatMap((item): Array<[string, string]> => item.signedUrl && item.path ? [[item.path, item.signedUrl]] : []));
  }

  async remove(keys: string[], user: AuthUser): Promise<void> {
    if (!keys.length) return;
    const { error } = await userClient(this.config, user.accessToken).storage.from(BUCKET).remove(keys);
    if (error) console.warn('[storage] pulizia dei file non riuscita:', error.message);
  }
}

const SERVER_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

export function supabaseCreator(config: AppConfig): CreatorStore {
  const anon = config.supabase.url && config.supabase.anonKey ? createClient(config.supabase.url, config.supabase.anonKey, SERVER_OPTIONS) : null;
  const storage = new SupabaseMediaStorage(config, anon);
  return {
    studio: (user) => new SupabaseStudioRepository(userClient(config, user.accessToken), user),
    feed: (user) => {
      const client = user ? userClient(config, user.accessToken) : anon;
      if (!client) throw dbError({ code: 'not_configured' });
      return new SupabaseFeedRepository(client);
    },
    interactions: (user) => new SupabaseInteractionsRepository(userClient(config, user.accessToken), user),
    media: () => storage,
  };
}
