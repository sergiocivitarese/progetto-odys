import { randomUUID } from 'node:crypto';
import { HttpError } from '../../shared/http';
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
} from '../../shared/creator';
import type { MemoryDatabase } from './memory-store';

/*
 * Creator Studio in memoria, con le stesse regole delle funzioni SQL
 * (`creator_posts_guard`, visibilità pubblica, like solo su post visibili).
 */

interface MemoryPost extends CreatorPost {
  deleted: boolean;
}

export class MemoryCreatorData {
  readonly posts = new Map<string, MemoryPost>();
  readonly likes = new Set<string>();
  readonly saves = new Set<string>();
  readonly removedKeys: string[] = [];
}

function snapshot(post: MemoryPost): CreatorPost {
  const { deleted: _deleted, ...rest } = structuredClone(post);
  return { ...rest, effectiveStatus: effectivePostStatus(rest.status, rest.scheduledFor), media: rest.media.sort((a, b) => a.sortOrder - b.sortOrder) };
}

function isPublic(post: MemoryPost): boolean {
  return !post.deleted && effectivePostStatus(post.status, post.scheduledFor) === 'published';
}

function applyInput(post: MemoryPost, input: CreatorPostInput): void {
  if (input.caption !== undefined) post.caption = input.caption;
  if (input.location !== undefined) post.location = input.location ?? undefined;
  if (input.publishedTripId !== undefined) post.publishedTripId = input.publishedTripId ?? undefined;
  if (input.linkAccess !== undefined) post.linkAccess = input.linkAccess;
  if (input.rightsConfirmed !== undefined) post.rightsConfirmed = input.rightsConfirmed;
}

class MemoryStudioRepository implements CreatorStudioRepository {
  constructor(private readonly db: MemoryDatabase, private readonly data: MemoryCreatorData, private readonly userId: string) {}

  private owned(id: string): MemoryPost | undefined {
    const post = this.data.posts.get(id);
    return post && post.authorId === this.userId && !post.deleted ? post : undefined;
  }

  private checkTrip(input: CreatorPostInput): void {
    if (input.publishedTripId && this.db.published.get(input.publishedTripId)?.coordinatorId !== this.userId) {
      throw new HttpError(422, 'Puoi collegare solo uno dei tuoi viaggi pubblicati.');
    }
  }

  async list() {
    return [...this.data.posts.values()].filter((post) => post.authorId === this.userId && !post.deleted)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(snapshot);
  }

  async get(id: string) {
    const post = this.owned(id);
    return post ? snapshot(post) : null;
  }

  async create(input: CreatorPostInput) {
    const role = this.db.user(this.userId).profile.role;
    if (role !== 'coordinator' && role !== 'admin') throw new HttpError(403, 'Operazione non consentita.');
    this.checkTrip(input);
    const now = new Date().toISOString();
    const post: MemoryPost = { id: randomUUID(), authorId: this.userId, status: 'draft', effectiveStatus: 'draft', caption: '', linkAccess: 'free', rightsConfirmed: false, createdAt: now, updatedAt: now, media: [], deleted: false };
    applyInput(post, input);
    this.data.posts.set(post.id, post);
    return snapshot(post);
  }

  async update(id: string, patch: CreatorPostInput) {
    const post = this.owned(id);
    if (!post) return null;
    this.checkTrip(patch);
    applyInput(post, patch);
    post.updatedAt = new Date().toISOString();
    return snapshot(post);
  }

  async setStatus(id: string, status: CreatorPostStatus, scheduledFor?: string) {
    const post = this.owned(id);
    if (!post) return null;
    if (status === 'scheduled' || status === 'published') {
      if (post.media.some((media) => media.status !== 'ready')) throw new HttpError(422, 'Attendi il caricamento di tutti i media prima di pubblicare.');
      if (!post.media.length) throw new HttpError(422, 'Aggiungi almeno una foto o un video prima di pubblicare.');
      if (!post.rightsConfirmed) throw new HttpError(422, 'Conferma di avere i diritti e i consensi per i contenuti pubblicati.');
    }
    post.status = status;
    post.scheduledFor = status === 'scheduled' ? scheduledFor : undefined;
    post.publishedAt = status === 'published' ? new Date().toISOString() : status === 'scheduled' ? scheduledFor : status === 'draft' ? undefined : post.publishedAt;
    post.updatedAt = new Date().toISOString();
    return snapshot(post);
  }

  async remove(id: string) {
    const post = this.owned(id);
    if (!post) return false;
    post.deleted = true;
    post.status = 'archived';
    return true;
  }

  async addMedia(postId: string, input: CreatorMediaInput) {
    const post = this.owned(postId);
    if (!post) throw new HttpError(404, 'Elemento non trovato.');
    const id = randomUUID();
    const media: CreatorMedia = {
      id, postId, kind: input.kind, mimeType: input.mimeType, width: input.width, height: input.height, durationMs: input.durationMs,
      sizeBytes: input.sizeBytes, sortOrder: input.sortOrder, status: 'uploading',
      originalKey: mediaKey(this.userId, postId, id, 'original', input.extension),
      displayKey: input.hasDisplay ? mediaKey(this.userId, postId, id, 'display', 'webp') : undefined,
      thumbnailKey: mediaKey(this.userId, postId, id, 'thumbnail', 'webp'),
    };
    post.media.push(media);
    return structuredClone(media);
  }

  async setMediaStatus(postId: string, mediaId: string, status: CreatorMediaStatus) {
    const media = this.owned(postId)?.media.find((item) => item.id === mediaId);
    if (!media) return null;
    media.status = status;
    return structuredClone(media);
  }

  async removeMedia(postId: string, mediaId: string) {
    const post = this.owned(postId);
    const media = post?.media.find((item) => item.id === mediaId);
    if (!post || !media) return null;
    post.media = post.media.filter((item) => item.id !== mediaId);
    return [media.originalKey, media.displayKey, media.thumbnailKey].filter((key): key is string => Boolean(key));
  }

  async reorderMedia(postId: string, mediaIds: string[]) {
    const post = this.owned(postId);
    if (!post) return null;
    mediaIds.forEach((id, index) => { const media = post.media.find((item) => item.id === id); if (media) media.sortOrder = index; });
    return snapshot(post).media;
  }
}

class MemoryFeedRepository implements CreatorFeedRepository {
  constructor(private readonly data: MemoryCreatorData, private readonly viewerId?: string) {}

  async feed(query: FeedQuery) {
    return [...this.data.posts.values()]
      .filter(isPublic)
      .filter((post) => !query.authorId || post.authorId === query.authorId)
      .filter((post) => !query.before || (post.publishedAt ?? '') < query.before)
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
      .slice(0, query.limit)
      .map(snapshot);
  }

  async get(id: string) {
    const post = this.data.posts.get(id);
    return post && (isPublic(post) || (post.authorId === this.viewerId && !post.deleted)) ? snapshot(post) : null;
  }

  async likeCounts(ids: string[]) {
    const counts = new Map<string, number>();
    for (const key of this.data.likes) {
      const postId = key.split('|')[1];
      const post = this.data.posts.get(postId);
      if (ids.includes(postId) && post && isPublic(post)) counts.set(postId, (counts.get(postId) ?? 0) + 1);
    }
    return counts;
  }
}

class MemoryInteractionsRepository implements CreatorInteractionsRepository {
  constructor(private readonly data: MemoryCreatorData, private readonly userId: string) {}
  private key(id: string) { return `${this.userId}|${id}`; }
  async liked(ids: string[]) { return new Set(ids.filter((id) => this.data.likes.has(this.key(id)))); }
  async saved(ids: string[]) { return new Set(ids.filter((id) => this.data.saves.has(this.key(id)))); }
  async savedIds() { return [...this.data.saves].filter((key) => key.startsWith(`${this.userId}|`)).map((key) => key.split('|')[1]).reverse(); }
  private toggle(set: Set<string>, id: string, on: boolean) {
    const post = this.data.posts.get(id);
    if (on && (!post || !isPublic(post))) throw new HttpError(404, 'Elemento non trovato.');
    if (on) set.add(this.key(id)); else set.delete(this.key(id));
  }
  async setLike(id: string, on: boolean) { this.toggle(this.data.likes, id, on); }
  async setSave(id: string, on: boolean) { this.toggle(this.data.saves, id, on); }
}

export function memoryCreator(db: MemoryDatabase, data: MemoryCreatorData): CreatorStore {
  return {
    studio: (user) => new MemoryStudioRepository(db, data, user.id),
    feed: (user) => new MemoryFeedRepository(data, user?.id),
    interactions: (user) => new MemoryInteractionsRepository(data, user.id),
    media: () => ({
      async signedUrls(keys: string[]) { return new Map(keys.map((key) => [key, `memory://${key}`])); },
      async remove(keys: string[]) { data.removedKeys.push(...keys); },
    }),
  };
}
