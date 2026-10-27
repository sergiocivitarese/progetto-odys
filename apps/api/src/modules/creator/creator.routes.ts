import { Router, type Request, type Response } from 'express';
import { bearerToken, currentUser, requireAuth, type AuthProvider, type AuthUser } from '../../shared/auth';
import type { CoordinatorCard } from '../../shared/catalog';
import {
  MEDIA_LIMITS,
  type CreatorLinkAccess,
  type CreatorLocation,
  type CreatorMediaInput,
  type CreatorPost,
  type CreatorPostInput,
  type CreatorPostStatus,
  type CreatorPostView,
} from '../../shared/creator';
import type { DataStore } from '../../shared/data';
import { handle, HttpError, requireObject } from '../../shared/http';

const FEED_PAGE = 24;

/** Utente della richiesta se ha inviato un token valido; altrimenti visitatore. */
async function optionalUser(auth: AuthProvider, req: Request): Promise<AuthUser | undefined> {
  const token = bearerToken(req);
  if (!token || !auth.configured) return undefined;
  const user = await auth.verify(token).catch(() => null);
  return user ? { ...user, accessToken: token } : undefined;
}

/** Aggiunge URL firmati, autore, viaggio collegato, like e salvataggi (per chi legge). */
async function decorate(store: DataStore, posts: CreatorPost[], viewer?: AuthUser): Promise<CreatorPostView[]> {
  if (!posts.length) return [];
  const ids = posts.map((post) => post.id);
  const keys = posts.flatMap((post) => post.media.flatMap((media) => [media.thumbnailKey, media.displayKey ?? media.originalKey].filter((key): key is string => Boolean(key))));
  const catalog = store.catalog();
  const authorIds = Array.from(new Set(posts.map((post) => post.authorId)));
  const tripIds = Array.from(new Set(posts.map((post) => post.publishedTripId).filter((id): id is string => Boolean(id))));
  const [urls, likes, liked, saved, authors, trips] = await Promise.all([
    store.media().signedUrls(keys, viewer),
    store.feed(viewer).likeCounts(ids).catch(() => new Map<string, number>()),
    viewer ? store.interactions(viewer).liked(ids) : Promise.resolve(new Set<string>()),
    viewer ? store.interactions(viewer).saved(ids) : Promise.resolve(new Set<string>()),
    Promise.all(authorIds.map(async (id) => [id, await catalog.coordinator(id).catch(() => null)] as const)),
    tripIds.length ? catalog.getMany(tripIds).catch(() => []) : Promise.resolve([]),
  ]);
  const authorById = new Map(authors);
  const tripById = new Map(trips.map((trip) => [trip.id, trip]));
  return posts.map((post) => ({
    ...post,
    media: post.media.map((media) => ({
      ...media,
      urls: {
        thumbnail: media.thumbnailKey ? urls.get(media.thumbnailKey) : undefined,
        display: urls.get(media.displayKey ?? media.originalKey),
      },
    })),
    author: authorById.get(post.authorId) ?? ({ id: post.authorId, displayName: 'Coordinatore Odys', interests: [] } satisfies CoordinatorCard),
    trip: post.publishedTripId ? tripById.get(post.publishedTripId) ?? null : undefined,
    likes: likes.get(post.id) ?? 0,
    liked: viewer ? liked.has(post.id) : undefined,
    saved: viewer ? saved.has(post.id) : undefined,
  }));
}

/**
 * Feed pubblico dei post (U-05, U-19) e interazioni (U-20): leggibile senza
 * accesso; like e salvataggi richiedono l'accesso (U-10).
 */
export function postsRouter(auth: AuthProvider, store: DataStore): Router {
  const router = Router();

  router.get('/', handle(async (req, res) => {
    const viewer = await optionalUser(auth, req);
    const author = typeof req.query['author'] === 'string' ? req.query['author'] : undefined;
    const before = typeof req.query['before'] === 'string' ? req.query['before'] : undefined;
    const posts = await store.feed(viewer).feed({ authorId: author, before, limit: FEED_PAGE });
    res.json(await decorate(store, posts, viewer));
  }));

  router.get('/saved', requireAuth(auth), handle(async (_req, res) => {
    const user = currentUser(res);
    const ids = await store.interactions(user).savedIds();
    const feed = store.feed(user);
    const posts = (await Promise.all(ids.map((id) => feed.get(id)))).filter((post): post is CreatorPost => post !== null && post.effectiveStatus === 'published');
    res.json(await decorate(store, posts, user));
  }));

  router.get('/:id', handle(async (req, res) => {
    const viewer = await optionalUser(auth, req);
    const post = await store.feed(viewer).get(String(req.params.id));
    if (!post) throw new HttpError(404, 'Contenuto non trovato o non più disponibile.');
    res.json((await decorate(store, [post], viewer))[0]);
  }));

  for (const [path, kind] of [['like', 'like'], ['save', 'save']] as const) {
    router.put(`/:id/${path}`, requireAuth(auth), handle(async (req, res) => {
      const interactions = store.interactions(currentUser(res));
      await (kind === 'like' ? interactions.setLike(String(req.params.id), true) : interactions.setSave(String(req.params.id), true));
      res.status(204).end();
    }));
    router.delete(`/:id/${path}`, requireAuth(auth), handle(async (req, res) => {
      const interactions = store.interactions(currentUser(res));
      await (kind === 'like' ? interactions.setLike(String(req.params.id), false) : interactions.setSave(String(req.params.id), false));
      res.status(204).end();
    }));
  }

  return router;
}

function text(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `Campo ${field} non valido.`);
  if (value.length > max) throw new HttpError(422, `Il campo ${field} può avere al massimo ${max} caratteri.`);
  return value;
}

function finite(value: unknown, min: number, max: number): number | undefined {
  const number = Number(value);
  return value !== undefined && value !== null && Number.isFinite(number) && number >= min && number <= max ? number : undefined;
}

/** Valida i dati del post inviati dal Creator Studio. */
function postInput(body: unknown): CreatorPostInput {
  const raw = requireObject<Record<string, unknown>>(body, 'Richiesta non valida.');
  const input: CreatorPostInput = { caption: text(raw['caption'], 'didascalia', 2200) };
  if (raw['location'] !== undefined) {
    if (raw['location'] === null) input.location = null;
    else {
      const location = requireObject<Record<string, unknown>>(raw['location'], 'Luogo non valido.');
      const label = text(location['label'], 'luogo', 160)?.trim();
      const latitude = finite(location['latitude'], -90, 90);
      const longitude = finite(location['longitude'], -180, 180);
      const osmId = typeof location['osmId'] === 'string' && /^(node|way|relation)\/\d+$/.test(location['osmId']) ? location['osmId'] : undefined;
      input.location = label ? { label, ...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}), osmId } satisfies CreatorLocation : null;
    }
  }
  if (raw['publishedTripId'] !== undefined) {
    if (raw['publishedTripId'] !== null && typeof raw['publishedTripId'] !== 'string') throw new HttpError(400, 'Viaggio collegato non valido.');
    input.publishedTripId = (raw['publishedTripId'] as string | null) || null;
  }
  if (raw['linkAccess'] !== undefined) {
    if (raw['linkAccess'] !== 'free' && raw['linkAccess'] !== 'paid') throw new HttpError(400, 'Accesso all’itinerario non valido.');
    // P-05: l'itinerario a pagamento arriverà con i pagamenti; per ora solo accesso libero.
    if (raw['linkAccess'] === 'paid') throw new HttpError(422, 'Gli itinerari a pagamento saranno disponibili con i pagamenti online.');
    input.linkAccess = raw['linkAccess'] as CreatorLinkAccess;
  }
  if (raw['rightsConfirmed'] !== undefined) input.rightsConfirmed = raw['rightsConfirmed'] === true;
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as CreatorPostInput;
}

/** Valida i metadati di un media prima del caricamento (M-03, M-07). */
function mediaInput(body: unknown, count: number): CreatorMediaInput {
  const raw = requireObject<Record<string, unknown>>(body, 'Richiesta non valida.');
  if (count >= MEDIA_LIMITS.maxPerPost) throw new HttpError(422, `Un post può contenere al massimo ${MEDIA_LIMITS.maxPerPost} foto o video.`);
  const mimeType = String(raw['mimeType'] ?? '');
  const kind = (MEDIA_LIMITS.imageTypes as readonly string[]).includes(mimeType) ? 'image' : (MEDIA_LIMITS.videoTypes as readonly string[]).includes(mimeType) ? 'video' : null;
  if (!kind) throw new HttpError(422, 'Formato non supportato: usa foto JPG, PNG, WebP o HEIC e video MP4, MOV o WebM.');
  const sizeBytes = finite(raw['sizeBytes'], 1, MEDIA_LIMITS.videoBytes);
  if (sizeBytes === undefined || sizeBytes > (kind === 'image' ? MEDIA_LIMITS.imageBytes : MEDIA_LIMITS.videoBytes)) {
    throw new HttpError(422, kind === 'image' ? 'Le foto possono pesare al massimo 15 MB.' : 'I video possono pesare al massimo 100 MB.');
  }
  const durationMs = finite(raw['durationMs'], 0, 90_000);
  if (kind === 'video' && durationMs !== undefined && durationMs > MEDIA_LIMITS.videoMs) throw new HttpError(422, 'I video possono durare al massimo 60 secondi.');
  const extension = String(raw['extension'] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || (kind === 'image' ? 'jpg' : 'mp4');
  return {
    kind,
    mimeType,
    width: finite(raw['width'], 1, 10_000),
    height: finite(raw['height'], 1, 10_000),
    durationMs: kind === 'video' ? durationMs : undefined,
    sizeBytes,
    sortOrder: Math.min(count, MEDIA_LIMITS.maxPerPost - 1),
    extension,
    hasDisplay: kind === 'image',
  };
}

const STATUS_ACTIONS: Record<string, CreatorPostStatus> = { publish: 'published', schedule: 'scheduled', unpublish: 'draft', archive: 'archived' };

/**
 * Creator Studio (C-19…C-29): bacheca privata dell'autore. Riservato ai
 * coordinatori che hanno accettato le linee guida (C-04).
 */
export function studioRouter(auth: AuthProvider, store: DataStore): Router {
  const router = Router();
  router.use(requireAuth(auth));
  router.use(handle(async (_req, res, next) => {
    const coordinator = store.coordinator(currentUser(res));
    if (!(await coordinator.isCoordinator())) throw new HttpError(403, 'Il Creator Studio è riservato ai coordinatori approvati.');
    if (!(await coordinator.hasAcceptedGuidelines())) throw new HttpError(428, 'Accetta le linee guida del coordinatore per continuare.');
    next();
  }));
  const studio = (res: Response) => store.studio(currentUser(res));
  const view = async (res: Response, post: CreatorPost) => (await decorate(store, [post], currentUser(res)))[0];
  const owned = async (res: Response, id: string) => {
    const post = await studio(res).get(id);
    if (!post) throw new HttpError(404, 'Contenuto non trovato.');
    return post;
  };

  router.get('/posts', handle(async (_req, res) => res.json(await decorate(store, await studio(res).list(), currentUser(res)))));

  router.post('/posts', handle(async (req, res) => {
    const post = await studio(res).create(postInput(req.body ?? {}));
    await store.account(currentUser(res)).record({ action: 'creator_post.create', entity: 'creator_post', entityId: post.id });
    res.status(201).json(await view(res, post));
  }));

  router.get('/posts/:id', handle(async (req, res) => res.json(await view(res, await owned(res, String(req.params.id))))));

  router.patch('/posts/:id', handle(async (req, res) => {
    const updated = await studio(res).update(String(req.params.id), postInput(req.body));
    if (!updated) throw new HttpError(404, 'Contenuto non trovato.');
    res.json(await view(res, updated));
  }));

  router.delete('/posts/:id', handle(async (req, res) => {
    const post = await owned(res, String(req.params.id));
    if (!(await studio(res).remove(post.id))) throw new HttpError(404, 'Contenuto non trovato.');
    await store.account(currentUser(res)).record({ action: 'creator_post.delete', entity: 'creator_post', entityId: post.id });
    res.status(204).end();
  }));

  // C-29: azioni coerenti con lo stato (pubblica, programma, torna in bozza, archivia).
  router.post('/posts/:id/:action', handle(async (req, res, next) => {
    const status = STATUS_ACTIONS[String(req.params.action)];
    if (!status) { next(); return; } // es. /media: gestito più sotto
    let scheduledFor: string | undefined;
    if (status === 'scheduled') {
      const { scheduledFor: value } = requireObject<{ scheduledFor?: unknown }>(req.body, 'Richiesta non valida.');
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new HttpError(400, 'Data e ora di pubblicazione non valide.');
      if (Date.parse(value) <= Date.now()) throw new HttpError(422, 'Scegli una data e un’ora di pubblicazione future.');
      scheduledFor = new Date(value).toISOString();
    }
    const post = await owned(res, String(req.params.id));
    const updated = await studio(res).setStatus(post.id, status, scheduledFor);
    if (!updated) throw new HttpError(404, 'Contenuto non trovato.');
    await store.account(currentUser(res)).record({ action: `creator_post.${req.params.action}`, entity: 'creator_post', entityId: post.id });
    res.json(await view(res, updated));
  }));

  // Media (M-01…M-04): il server assegna i percorsi; il browser carica i file nell'archivio
  // con i propri permessi e poi conferma il caricamento (o lo segnala come fallito).
  router.post('/posts/:id/media', handle(async (req, res) => {
    const post = await owned(res, String(req.params.id));
    if (post.status !== 'draft') throw new HttpError(422, 'Riporta il post in bozza per modificarne i media.');
    res.status(201).json(await studio(res).addMedia(post.id, mediaInput(req.body, post.media.length)));
  }));

  router.patch('/posts/:id/media/:mediaId', handle(async (req, res) => {
    const { status } = requireObject<{ status?: unknown }>(req.body, 'Richiesta non valida.');
    if (status !== 'ready' && status !== 'failed') throw new HttpError(400, 'Stato del media non valido.');
    const media = await studio(res).setMediaStatus(String(req.params.id), String(req.params.mediaId), status);
    if (!media) throw new HttpError(404, 'Media non trovato.');
    res.json(media);
  }));

  router.delete('/posts/:id/media/:mediaId', handle(async (req, res) => {
    const post = await owned(res, String(req.params.id));
    if (post.status !== 'draft') throw new HttpError(422, 'Riporta il post in bozza per modificarne i media.');
    const keys = await studio(res).removeMedia(post.id, String(req.params.mediaId));
    if (!keys) throw new HttpError(404, 'Media non trovato.');
    // M-04: i file non più collegati vengono cancellati dall'archivio.
    await store.media().remove(keys, currentUser(res));
    res.status(204).end();
  }));

  router.put('/posts/:id/media-order', handle(async (req, res) => {
    const { ids } = requireObject<{ ids?: unknown }>(req.body, 'Richiesta non valida.');
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) throw new HttpError(400, 'Ordine non valido.');
    const post = await owned(res, String(req.params.id));
    const media = await studio(res).reorderMedia(post.id, ids as string[]);
    if (!media) throw new HttpError(404, 'Contenuto non trovato.');
    res.json(media);
  }));

  return router;
}
