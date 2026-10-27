/**
 * Crea la cartella della demo da consegnare al cliente:
 *   ../../odys-demo-cliente/   (accanto a progetto-odys)
 *
 * Uso (dalla radice del progetto):  npm run package:demo
 * Il cliente non ha bisogno del codice sorgente né di `npm install`: solo di Node.js.
 */
import { execSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const out = path.resolve(root, '..', 'odys-demo-cliente');
const appDir = path.join(out, 'app');

function step(message: string): void {
  console.log(`\n▶ ${message}`);
}

step('Pulizia della cartella di consegna');
if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(appDir, 'dati'), { recursive: true });

step('Build di produzione del sito Angular');
execSync('npx ng build -c production', { cwd: path.join(root, 'apps/web'), stdio: 'inherit' });
cpSync(path.join(root, 'apps/web/dist/web/browser'), path.join(appDir, 'web'), { recursive: true });

step('Server in un unico file (API + sito)');
await build({
  entryPoints: [path.join(root, 'apps/api/src/demo-server.ts')],
  outfile: path.join(appDir, 'server.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});

step('Collegamento a Supabase (solo indirizzo e chiave pubblica)');
// I viaggi ora sono nell'account Supabase dell'utente: la demo non contiene dati.
// Della configurazione del backend copiamo SOLO i valori pubblici: la chiave
// service_role e la stringa del database non lasciano mai il computer di sviluppo.
const apiEnvFile = path.join(root, 'apps/api/.env');
const apiEnv = existsSync(apiEnvFile) ? Object.fromEntries(readFileSync(apiEnvFile, 'utf8').split(/\r?\n/)
  .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)).filter((match): match is RegExpExecArray => match !== null)
  .map((match) => [match[1], match[2]])) : {};
const publicKeys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
writeFileSync(path.join(appDir, 'config.env'), [
  '# Configurazione della demo Odys: solo valori pubblici.',
  ...publicKeys.map((key) => `${key}=${apiEnv[key] ?? ''}`),
  '',
].join('\n'));
if (!apiEnv['SUPABASE_URL']) console.warn('  ⚠️  apps/api/.env non ha SUPABASE_URL: nella demo accesso e salvataggio saranno disattivati.');

step('Lanciatori per Mac e Windows');
const macLauncher = `#!/bin/bash
# Avvia la demo di Odys (Mac). Doppio clic su questo file.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/app" || exit 1
clear
echo ""
echo "  Odys · avvio della demo in corso..."
echo ""
if ! command -v node >/dev/null 2>&1; then
  echo "  ❌ Manca Node.js, il programma che serve per far funzionare Odys."
  echo "     Ora si apre la pagina per scaricarlo: installalo e poi riapri questo file."
  open "https://nodejs.org/it/download"
  echo ""
  read -n 1 -s -r -p "  Premi un tasto per chiudere..."
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "  ❌ La versione di Node.js installata è troppo vecchia ($(node -v))."
  echo "     Scarica e installa la versione LTS dalla pagina che si sta aprendo."
  open "https://nodejs.org/it/download"
  read -n 1 -s -r -p "  Premi un tasto per chiudere..."
  exit 1
fi
node server.cjs
`;
writeFileSync(path.join(out, 'Avvia Odys (Mac).command'), macLauncher);
chmodSync(path.join(out, 'Avvia Odys (Mac).command'), 0o755);

const winLauncher = [
  '@echo off',
  'chcp 65001 >nul',
  'title Odys - demo (lascia aperta questa finestra)',
  'cd /d "%~dp0app"',
  'echo.',
  'echo   Odys - avvio della demo in corso...',
  'echo.',
  'where node >nul 2>nul',
  'if errorlevel 1 (',
  '  echo   Manca Node.js, il programma che serve per far funzionare Odys.',
  '  echo   Ora si apre la pagina per scaricarlo: installalo e poi riapri questo file.',
  '  start "" "https://nodejs.org/it/download"',
  '  echo.',
  '  pause',
  '  exit /b 1',
  ')',
  'node server.cjs',
  'pause',
  '',
].join('\r\n');
writeFileSync(path.join(out, 'Avvia Odys (Windows).bat'), winLauncher);

step('Guida per il cliente');
// La guida è scritta come frammento (va anche online): qui la completiamo come pagina autonoma.
const guide = readFileSync(path.join(root, 'docs/guida-cliente.html'), 'utf8');
writeFileSync(path.join(out, 'LEGGIMI - Guida alla demo.html'), `<!doctype html>\n<html lang="it">\n<meta charset="utf-8">\n${guide}\n</html>\n`);

step('Zip da inviare');
const deliveryDir = path.resolve(root, '..', 'consegna');
mkdirSync(deliveryDir, { recursive: true });
const zipPath = path.join(deliveryDir, 'odys-demo-cliente.zip');
rmSync(zipPath, { force: true });
// ditto mantiene i permessi del lanciatore Mac (eseguibile).
execSync(`ditto -c -k --sequesterRsrc --keepParent "${out}" "${zipPath}"`);

console.log(`\n✅ Demo pronta in: ${out}\n   Zip da inviare: ${zipPath}\n`);
