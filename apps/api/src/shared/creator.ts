import type { AuthUser } from './auth';
import type { CoordinatorCard, PublishedTripSummary } from './catalog';

/*
 * Contratti del Creator Studio (C-19…C-29, U-05, U-19…U-21, M-01…M-07).
 * Stati del post (§11.1): bozza e programmato visibili solo all'autore finché
 * l'ora di pubblicazione non è passata; archiviato ed eliminato escono dal feed.
 */

export type CreatorPostStatus = 'draft' | 'scheduled' | 'published' | 'archived';
export type CreatorMediaKind = 'image' | 'video';
export type CreatorMediaStatus = 'uploading' | 'ready' | 'failed';
export type CreatorLinkAccess = 'free' | 'paid';

/** Limiti operativi sui media (M-07). */
export const MEDIA_LIMITS = {
  maxPerPost: 10,
  imageBytes: 15 * 1024 * 1024,
  videoBytes: 100 * 1024 * 1024,
  videoMs: 60_000,
  imageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  videoTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
} as const;

export interface CreatorLocation {
  label: string;
  latitude?: number;
  longitude?: number;
  osmId?: string;
}

export interface CreatorMedia {
  id: string;
  postId: string;
  kind: CreatorMediaKind;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  sizeBytes?: number;
  sortOrder: number;
  status: CreatorMediaStatus;
  originalKey: string;
  displayKey?: string;
  thumbnailKey?: string;
  /** URL firmati a scadenza (M-06), aggiunti dal server per chi può vedere il file. */
  urls?: { original?: string; display?: string; thumbnail?: string };
}

export interface CreatorPost {
  id: string;
  authorId: string;
  status: CreatorPostStatus;
  /** Programmato e giunto all'ora → "published". */
  effectiveStatus: CreatorPostStatus;
  caption: string;
  location?: CreatorLocation;
  publishedTripId?: string;
  linkAccess: CreatorLinkAccess;
  rightsConfirmed: boolean;
  scheduledFor?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  media: CreatorMedia[];
}

/** Post come lo vede il pubblico o l'autore, con autore, viaggio collegato e interazioni. */
export interface CreatorPostView extends CreatorPost {
  author: CoordinatorCard;
  trip?: PublishedTripSummary | null;
  likes: number;
  liked?: boolean;
  saved?: boolean;
}

export interface CreatorPostInput {
  caption?: string;
  location?: CreatorLocation | null;
  publishedTripId?: string | null;
  linkAccess?: CreatorLinkAccess;
  rightsConfirmed?: boolean;
}

export interface CreatorMediaInput {
  kind: CreatorMediaKind;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  sizeBytes: number;
  sortOrder: number;
  /** Estensione del file originale (jpg, png, mp4…), per il percorso nell'archivio. */
  extension: string;
  /** Versione ottimizzata per la visualizzazione (le foto; i video non vengono transcodificati). */
  hasDisplay: boolean;
}

export interface FeedQuery {
  authorId?: string;
  /** Post pubblicati prima di questa data (paginazione). */
  before?: string;
  limit: number;
}

/** Bacheca privata dell'autore (C-21…C-29). */
export interface CreatorStudioRepository {
  list(): Promise<CreatorPost[]>;
  get(id: string): Promise<CreatorPost | null>;
  create(input: CreatorPostInput): Promise<CreatorPost>;
  update(id: string, patch: CreatorPostInput): Promise<CreatorPost | null>;
  setStatus(id: string, status: CreatorPostStatus, scheduledFor?: string): Promise<CreatorPost | null>;
  /** Eliminazione morbida: il post esce da ogni vista (§11.1 DELETED). */
  remove(id: string): Promise<boolean>;
  addMedia(postId: string, media: CreatorMediaInput): Promise<CreatorMedia>;
  setMediaStatus(postId: string, mediaId: string, status: CreatorMediaStatus): Promise<CreatorMedia | null>;
  /** Elimina la riga e restituisce i percorsi dei file da cancellare. */
  removeMedia(postId: string, mediaId: string): Promise<string[] | null>;
  reorderMedia(postId: string, mediaIds: string[]): Promise<CreatorMedia[] | null>;
}

/** Lettura pubblica: feed e dettaglio dei post visibili (U-05, U-19). */
export interface CreatorFeedRepository {
  feed(query: FeedQuery): Promise<CreatorPost[]>;
  get(id: string): Promise<CreatorPost | null>;
  likeCounts(ids: string[]): Promise<Map<string, number>>;
}

/** Like e salvataggi dell'utente (U-20). */
export interface CreatorInteractionsRepository {
  liked(ids: string[]): Promise<Set<string>>;
  saved(ids: string[]): Promise<Set<string>>;
  savedIds(): Promise<string[]>;
  setLike(id: string, on: boolean): Promise<void>;
  setSave(id: string, on: boolean): Promise<void>;
}

/** Archivio dei file: URL firmati e cancellazione, sempre con i permessi di chi chiede (M-06). */
export interface MediaStorage {
  signedUrls(keys: string[], user?: AuthUser): Promise<Map<string, string>>;
  remove(keys: string[], user: AuthUser): Promise<void>;
}

export interface CreatorStore {
  studio(user: AuthUser): CreatorStudioRepository;
  feed(user?: AuthUser): CreatorFeedRepository;
  interactions(user: AuthUser): CreatorInteractionsRepository;
  media(): MediaStorage;
}

/** Stato effettivo: un post programmato è pubblicato quando l'ora è passata. */
export function effectivePostStatus(status: CreatorPostStatus, scheduledFor?: string, now = Date.now()): CreatorPostStatus {
  return status === 'scheduled' && scheduledFor && Date.parse(scheduledFor) <= now ? 'published' : status;
}

/** Percorso di un file nell'archivio: <autore>/<post>/<media>/<versione>.<estensione>. */
export function mediaKey(authorId: string, postId: string, mediaId: string, version: 'original' | 'display' | 'thumbnail', extension: string): string {
  return `${authorId}/${postId}/${mediaId}/${version}.${extension}`;
}
