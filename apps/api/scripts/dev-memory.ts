/**
 * Modalità demo di Odys: API con l'archivio in memoria e dati di prova, senza
 * Supabase né chiavi. Per provare tutti i ruoli (viaggiatrice, coordinatrice,
 * agenzia, amministratore) senza account reali.
 *
 * Uso: npm run dev:demo (dalla radice: API su :3000 e app su :4200)
 * La pagina «Accedi» mostra i pulsanti «Entra come…»: il token vale solo per
 * questo server e i dati spariscono al riavvio.
 */
import { createApp } from '../src/app';
import { loadConfig } from '../src/config/env';
import { createDemoDatabase, demoPayments, seedDemoData } from '../src/demo/demo-data';
import { memoryAuthProvider, memoryDataStore } from '../src/infra/memory/memory-store';

const config = loadConfig();
const { db, demoUsers } = createDemoDatabase();
const app = createApp(config, { auth: memoryAuthProvider(db), store: memoryDataStore(db), demoUsers, payments: demoPayments });
const server = app.listen(config.port, async () => {
  const base = `http://localhost:${config.port}/api`;
  await seedDemoData(base, db);
  console.log(`Odys in modalità demo: API in memoria su ${base}, dati di prova pronti.`);
  console.log('Apri http://localhost:4200/accedi e scegli «Entra come…» (viaggiatrice, coordinatrice, agenzia, amministratrice).');
});

process.on('SIGTERM', () => server.close());
