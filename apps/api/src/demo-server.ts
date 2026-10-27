/**
 * Server "tutto in uno" per la demo da consegnare: API + sito Angular già compilato
 * sulla stessa porta, apertura automatica del browser. Viene impacchettato in un
 * unico file da `scripts/package-demo.mjs` e non richiede `npm install`.
 *
 * Struttura attesa accanto al file impacchettato:
 *   server.cjs   ← questo server
 *   web/         ← build di produzione di apps/web
 *   config.env   ← indirizzo e chiave pubblica di Supabase (mai la chiave segreta)
 */
import { exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import express from 'express';
import { createApp } from './app';
import { loadConfig } from './config/env';

const baseDir = path.dirname(path.resolve(process.argv[1] ?? '.'));
const webDir = path.join(baseDir, 'web');
const preferredPort = Number.parseInt(process.env.PORT ?? '8080', 10);

/** Legge `config.env` (righe CHIAVE=valore) senza sovrascrivere variabili già impostate. */
function loadConfigFile(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !line.trim().startsWith('#') && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}
loadConfigFile(path.join(baseDir, 'config.env'));

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

async function findPort(start: number): Promise<number> {
  for (let port = start; port < start + 20; port += 1) {
    if (await isFree(port)) return port;
  }
  throw new Error('Nessuna porta libera trovata.');
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(command, () => undefined);
}

async function main(): Promise<void> {
  if (!existsSync(path.join(webDir, 'index.html'))) {
    console.error(`Cartella del sito non trovata: ${webDir}`);
    process.exit(1);
  }
  const port = await findPort(preferredPort);
  const config = { ...loadConfig({ ...process.env, DATA_DIR: path.join(baseDir, 'dati') }), port, corsOrigin: [] };
  if (!config.supabase.url) console.log('  ℹ️  Accesso e salvataggio disattivati: config.env non contiene SUPABASE_URL.');
  const app = createApp(config);

  app.use(express.static(webDir, { index: false, maxAge: '1h' }));
  // Tutte le pagine dell'app (es. /pianifica, /itinerario/…) sono servite da index.html.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(webDir, 'index.html'));
  });

  app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log('');
    console.log('  ✅ Odys è pronta!');
    console.log(`  Si sta aprendo il browser su ${url}`);
    console.log('  Se non si apre da solo, copia questo indirizzo nel browser.');
    console.log('');
    console.log('  ⚠️  Lascia aperta questa finestra mentre usi la demo.');
    console.log('     Per chiudere Odys chiudi questa finestra.');
    console.log('');
    if (process.env.ODYS_NO_BROWSER !== '1') openBrowser(url);
  });
}

void main();
