import { inject, Injectable } from '@angular/core';
import { ApiClient } from './api-client';
import type { CoordinatorCard, PublishedTripSummary } from './catalog.api';

/*
 * Creator Studio e feed dei contenuti (C-19…C-29, U-05, U-19…U-21).
 */

export type PostStatus = 'draft' | 'scheduled' | 'published' | 'archived';
export type MediaKind = 'image' | 'video';
export type MediaStatus = 'uploading' | 'ready' | 'failed';

export interface PostLocation {
  label: string;
  latitude?: number;
  longitude?: number;
  osmId?: string;
}

export interface PostMedia {
  id: string;
  postId: string;
  kind: MediaKind;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  sortOrder: number;
  status: MediaStatus;
  originalKey: string;
  displayKey?: string;
  thumbnailKey?: string;
  urls?: { display?: string; thumbnail?: string };
}

export interface Post {
  id: string;
  authorId: string;
  status: PostStatus;
  effectiveStatus: PostStatus;
  caption: string;
  location?: PostLocation;
  publishedTripId?: string;
  linkAccess: 'free' | 'paid';
  rightsConfirmed: boolean;
  scheduledFor?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  media: PostMedia[];
  author: CoordinatorCard;
  trip?: PublishedTripSummary | null;
  likes: number;
  liked?: boolean;
  saved?: boolean;
}

export interface PostForm {
  caption?: string;
  location?: PostLocation | null;
  publishedTripId?: string | null;
  rightsConfirmed?: boolean;
}

export interface MediaRequest {
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  extension: string;
}

export type PostAction = 'publish' | 'schedule' | 'unpublish' | 'archive';

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  draft: 'Bozza',
  scheduled: 'Programmato',
  published: 'Pubblicato',
  archived: 'Archiviato',
};

/** Endpoint `/api/posts` (feed pubblico, like e salvataggi) e `/api/studio` (bacheca dell'autore). */
@Injectable({ providedIn: 'root' })
export class CreatorApi {
  private readonly api = inject(ApiClient);

  feed(author?: string, before?: string) { return this.api.get<Post[]>('/posts', { author, before }); }
  post(id: string) { return this.api.get<Post>(`/posts/${encodeURIComponent(id)}`); }
  savedPosts() { return this.api.get<Post[]>('/posts/saved'); }
  setLike(id: string, on: boolean) { return on ? this.api.put<void>(`/posts/${encodeURIComponent(id)}/like`, {}) : this.api.delete(`/posts/${encodeURIComponent(id)}/like`); }
  setSave(id: string, on: boolean) { return on ? this.api.put<void>(`/posts/${encodeURIComponent(id)}/save`, {}) : this.api.delete(`/posts/${encodeURIComponent(id)}/save`); }

  myPosts() { return this.api.get<Post[]>('/studio/posts'); }
  myPost(id: string) { return this.api.get<Post>(`/studio/posts/${encodeURIComponent(id)}`); }
  createPost(form: PostForm = {}) { return this.api.post<Post>('/studio/posts', form); }
  updatePost(id: string, form: PostForm) { return this.api.patch<Post>(`/studio/posts/${encodeURIComponent(id)}`, form); }
  deletePost(id: string) { return this.api.delete(`/studio/posts/${encodeURIComponent(id)}`); }
  changeStatus(id: string, action: PostAction, scheduledFor?: string) {
    return this.api.post<Post>(`/studio/posts/${encodeURIComponent(id)}/${action}`, scheduledFor ? { scheduledFor } : {});
  }
  addMedia(id: string, media: MediaRequest) { return this.api.post<PostMedia>(`/studio/posts/${encodeURIComponent(id)}/media`, media); }
  setMediaStatus(id: string, mediaId: string, status: 'ready' | 'failed') { return this.api.patch<PostMedia>(`/studio/posts/${encodeURIComponent(id)}/media/${encodeURIComponent(mediaId)}`, { status }); }
  removeMedia(id: string, mediaId: string) { return this.api.delete(`/studio/posts/${encodeURIComponent(id)}/media/${encodeURIComponent(mediaId)}`); }
  reorderMedia(id: string, ids: string[]) { return this.api.put<PostMedia[]>(`/studio/posts/${encodeURIComponent(id)}/media-order`, { ids }); }
}
