import { Router } from 'express';
import { currentUser, requireAuth, type AuthProvider } from '../../shared/auth';
import type { DataStore, ProfilePatch, ThemePreference } from '../../shared/data';
import { handle, HttpError, requireObject } from '../../shared/http';

const THEMES: ThemePreference[] = ['light', 'dark', 'system'];

function cleanText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `Campo ${field} non valido.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `Il campo ${field} può avere al massimo ${max} caratteri.`);
  return trimmed;
}

/**
 * Area personale (U-12): profilo, preferenze, idee salvate, registro attività
 * ed eliminazione dell'account (S-04).
 */
export function accountRouter(auth: AuthProvider, store: DataStore): Router {
  const router = Router();
  router.use(requireAuth(auth));
  const repo = (res: Parameters<typeof currentUser>[0]) => store.account(currentUser(res));

  router.get('/', handle(async (_req, res) => {
    const account = repo(res);
    const [profile, preferences] = await Promise.all([account.getProfile(), account.getPreferences()]);
    if (!profile) throw new HttpError(404, 'Profilo non trovato.');
    res.json({ profile, preferences });
  }));

  router.patch('/', handle(async (req, res) => {
    const body = requireObject<Record<string, unknown>>(req.body, 'Richiesta non valida.');
    const patch: ProfilePatch = {
      firstName: cleanText(body['firstName'], 'nome', 80),
      lastName: cleanText(body['lastName'], 'cognome', 80),
      bio: cleanText(body['bio'], 'presentazione', 600),
      publicHeadline: cleanText(body['publicHeadline'], 'frase di presentazione', 120),
    };
    if (body['interests'] !== undefined) {
      if (!Array.isArray(body['interests']) || !body['interests'].every((item) => typeof item === 'string')) throw new HttpError(400, 'Interessi non validi.');
      patch.interests = Array.from(new Set((body['interests'] as string[]).map((item) => item.trim()).filter(Boolean))).slice(0, 20);
    }
    const account = repo(res);
    const profile = await account.updateProfile(patch);
    await account.record({ action: 'profile.update', entity: 'profile', entityId: profile.id, metadata: { fields: Object.keys(patch).filter((key) => patch[key as keyof ProfilePatch] !== undefined) } });
    res.json(profile);
  }));

  router.put('/preferences', handle(async (req, res) => {
    const body = requireObject<{ theme?: unknown; onboardingCompleted?: unknown }>(req.body, 'Richiesta non valida.');
    if (body.theme !== undefined && !THEMES.includes(body.theme as ThemePreference)) throw new HttpError(400, 'Tema non valido.');
    res.json(await repo(res).updatePreferences({
      theme: body.theme as ThemePreference | undefined,
      onboardingCompletedAt: body.onboardingCompleted === true ? new Date().toISOString() : undefined,
    }));
  }));

  router.get('/activity', handle(async (_req, res) => res.json(await repo(res).listActivity(100))));

  // Viaggi pubblicati salvati (U-08): l'idea resta dell'autore e si aggiorna con lui.
  router.get('/saved-trips', handle(async (_req, res) => {
    const user = currentUser(res);
    const ids = await store.saved(user).listIds();
    res.json(await store.catalog().getMany(ids));
  }));
  router.put('/saved-trips/:id', handle(async (req, res) => {
    await store.saved(currentUser(res)).save(String(req.params.id));
    res.status(204).end();
  }));
  router.delete('/saved-trips/:id', handle(async (req, res) => {
    await store.saved(currentUser(res)).remove(String(req.params.id));
    res.status(204).end();
  }));

  // Le mie richieste di partecipazione con lo stato aggiornato (U-12, U-16).
  router.get('/participations', handle(async (_req, res) => {
    const requests = await store.participation(currentUser(res)).mine();
    const trips = await store.catalog().getMany(requests.map((request) => request.tripId));
    const byId = new Map(trips.map((trip) => [trip.id, trip]));
    res.json(requests.map((request) => ({ ...request, trip: byId.get(request.tripId) ?? null })));
  }));

  router.get('/saved-ideas', handle(async (_req, res) => res.json(await repo(res).listSavedIdeas())));
  router.put('/saved-ideas/:id', handle(async (req, res) => {
    const id = String(req.params.id);
    if (!/^[a-z0-9-]{1,80}$/i.test(id)) throw new HttpError(400, 'Idea non valida.');
    await repo(res).saveIdea(id);
    res.status(204).end();
  }));
  router.delete('/saved-ideas/:id', handle(async (req, res) => {
    await repo(res).removeIdea(String(req.params.id));
    res.status(204).end();
  }));

  /** Eliminazione definitiva dell'account e di tutti i suoi dati (S-04). */
  router.delete('/', handle(async (req, res) => {
    const { confirm } = requireObject<{ confirm?: unknown }>(req.body ?? {}, 'Richiesta non valida.');
    if (confirm !== 'ELIMINA') throw new HttpError(400, 'Per confermare scrivi ELIMINA.');
    const user = currentUser(res);
    await auth.deleteUser(user.id);
    console.log(`[account] account eliminato su richiesta dell'utente ${user.id}`);
    res.status(204).end();
  }));

  return router;
}
