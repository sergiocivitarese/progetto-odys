/**
 * API di Odys con l'archivio in memoria, per provare le schermate riservate
 * (area coordinatore) senza un account reale né scritture su Supabase.
 *
 * Uso: npm run dev:memory -w @odys/api   →   http://localhost:3000
 * Nel browser (app su :4200 o :4300) basta impostare nella console:
 *   localStorage.setItem('odys-auth', JSON.stringify({ access_token: 'demo-coordinatore', refresh_token: 'demo',
 *     token_type: 'bearer', expires_in: 31536000, expires_at: 4102444800, user: { id: 'demo-coordinatore', email: 'coordinatrice@odys.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } }))
 * e ricaricare. Il token vale solo per questo server e i dati spariscono al riavvio.
 */
import { FALLBACK_TRIP_FORM } from '@odys/domain';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config/env';
import { MemoryDatabase, memoryAuthProvider, memoryDataStore } from '../src/infra/memory/memory-store';

const TOKEN = 'demo-coordinatore';
const config = loadConfig();
const db = new MemoryDatabase();
const userId = db.addUser(TOKEN, 'demo-coordinatore', 'coordinatrice@odys.test');
Object.assign(db.user(userId).profile, { role: 'coordinator', firstName: 'Nora', lastName: 'Conti' });
Object.assign(db.user(userId).profile, { bio: 'Accompagno piccoli gruppi nel Sud Italia da dieci anni: ritmo lento, cucina di casa, luoghi fuori dalle guide.', interests: ['Storia', 'Cibo', 'Natura'] });
// Candidatura approvata: badge «verificato» e lingue nel profilo pubblico (CB-09).
db.applications.push({
  id: 'demo-candidatura', userId, status: 'approved', createdAt: new Date().toISOString(), decidedAt: new Date().toISOString(),
  motivation: 'Organizzo viaggi lenti in piccoli gruppi.', experience: 'Dieci anni di viaggi di gruppo nel Sud Italia.', tripsLed: 24,
  languages: ['Italiano', 'Inglese', 'Spagnolo'], links: [], guidelinesVersion: 'demo',
});

const app = createApp(config, { auth: memoryAuthProvider(db), store: memoryDataStore(db) });
const server = app.listen(config.port, async () => {
  const base = `http://localhost:${config.port}/api`;
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    return (response.status === 204 ? undefined : await response.json()) as T;
  };
  const year = new Date().getFullYear() + 1;
  await call('POST', '/coordinator/guidelines', {});
  const itinerary = await call('POST', '/itineraries/generate', { form: { ...FALLBACK_TRIP_FORM, destination: 'Matera' } });
  const own = await call<{ id: string }>('POST', '/trips', { itinerary });
  const onSale = await call<{ id: string }>('POST', '/coordinator/trips', {
    sourceTripId: own.id, title: 'Matera e i Sassi in piccolo gruppo', price: 690, capacity: 12, country: 'Italia', interests: ['Storia', 'Cibo'],
    summary: 'Quattro giorni tra Sassi, chiese rupestri e cucina lucana, con ritmo lento.', startDate: `${year}-04-02`, endDate: `${year}-04-05`,
  });
  await call('POST', `/coordinator/trips/${onSale.id}/publish`, {});
  await call('PUT', `/coordinator/trips/${onSale.id}/pricing`, {
    costs: [
      { label: 'Masseria 3 notti', category: 'alloggi', basis: 'per_person', amountCents: 24000 },
      { label: 'Pulmino con autista', category: 'trasporti', basis: 'group', amountCents: 120000 },
      { label: 'Guida ai Sassi', category: 'attivita', basis: 'group', amountCents: 30000 },
      { label: 'Il mio viaggio', category: 'altro', basis: 'group', amountCents: 25000 },
    ],
    targetEarningsCents: 150000,
  });
  await call('POST', '/coordinator/trips', { sourceTripId: own.id, title: 'Bozza: Basilicata d’autunno', price: 540, capacity: 8 });
  console.log(`Odys API in memoria su ${base} · coordinatrice di prova: token «${TOKEN}»`);
});

process.on('SIGTERM', () => server.close());
