/**
 * Crea gli zip della demo per chi non programma, uno per Windows e uno per Mac:
 *   ../consegna/Odys-Demo-Windows-<giorno>-<mese>-<anno>.zip
 *   ../consegna/Odys-Demo-Mac-<giorno>-<mese>-<anno>.zip       (accanto a progetto-odys)
 *
 * Uso (dalla radice del progetto):  npm run package:demo
 * Dentro: «Avvia Odys.bat» o «Avvia Odys.command», la guida passo passo e la cartella app (sito + server
 * in un unico file). Serve solo Node.js. La demo gira in modalità demo: dati e
 * account di prova in memoria, «Entra come…», nessun collegamento a Supabase.
 */
import { execSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const deliveryDir = path.resolve(root, '..', 'consegna');
const out = path.join(deliveryDir, 'Odys-Demo');
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

step('Configurazione: modalità demo');
// Modalità demo: niente chiavi né indirizzi di Supabase nello zip.
writeFileSync(path.join(appDir, 'config.env'), ['# Configurazione della demo Odys: dati e account di prova in memoria.', 'ODYS_MODE=demo', ''].join('\n'));

step('Lanciatori');
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
  'for /f "tokens=1 delims=v." %%v in (\'node -v\') do set NODE_MAJOR=%%v',
  'if %NODE_MAJOR% LSS 20 (',
  '  echo   La versione di Node.js installata e\' troppo vecchia. Installa la versione LTS dalla pagina che si sta aprendo.',
  '  start "" "https://nodejs.org/it/download"',
  '  echo.',
  '  pause',
  '  exit /b 1',
  ')',
  'node server.cjs',
  'pause',
  '',
].join('\r\n');

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

// La guida è scritta come frammento: qui la completiamo come pagina autonoma, con le sole istruzioni del sistema scelto.
const guide = readFileSync(path.join(root, 'docs/guida-cliente.html'), 'utf8');
const guideFor = (os: 'win' | 'mac') => `<!doctype html>\n<html lang="it">\n<meta charset="utf-8">\n${guide.replace('<main class="wrap" id="guide" data-os="win">', `<main class="wrap" id="guide" data-os="${os}">`)}\n</html>\n`;

const months = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const today = new Date();
const date = `${today.getDate()}-${months[today.getMonth()]}-${today.getFullYear()}`;
const targets = [
  { os: 'win' as const, name: 'Windows', launcher: 'Avvia Odys.bat', content: winLauncher },
  { os: 'mac' as const, name: 'Mac', launcher: 'Avvia Odys.command', content: macLauncher },
];
const zips: string[] = [];
for (const target of targets) {
  step(`Zip per ${target.name}`);
  writeFileSync(path.join(out, target.launcher), target.content);
  if (target.os === 'mac') chmodSync(path.join(out, target.launcher), 0o755);
  writeFileSync(path.join(out, 'LEGGIMI - Guida alla demo.html'), guideFor(target.os));
  const zipPath = path.join(deliveryDir, `Odys-Demo-${target.name}-${date}.zip`);
  // Uno zip per sistema: le demo precedenti si tolgono.
  for (const file of readdirSync(deliveryDir)) if (new RegExp(`^Odys-Demo-${target.name}-.*\\.zip$`).test(file)) rmSync(path.join(deliveryDir, file));
  // zip standard: niente cartelle __MACOSX, e il lanciatore Mac resta eseguibile.
  execSync(`zip -rq -X "${zipPath}" "Odys-Demo" -x "*.DS_Store"`, { cwd: deliveryDir });
  rmSync(path.join(out, target.launcher));
  zips.push(zipPath);
}
rmSync(out, { recursive: true, force: true });

console.log(`\n✅ Zip da inviare:\n   ${zips.join('\n   ')}\n`);
