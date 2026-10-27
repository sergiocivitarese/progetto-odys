/**
 * Crea il pacchetto completo del progetto da consegnare al cliente:
 *   ../consegna/odys-progetto-sorgente.zip
 *
 * Contiene solo i file che servono per sviluppare Odys: codice, configurazione,
 * documentazione e riferimenti. Esclude tutto ciò che si rigenera (dipendenze,
 * build, cache), i dati di test locali e la copia del vecchio progetto.
 *
 * Uso (dalla radice del progetto):  npm run package:source
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const deliveryDir = path.resolve(root, '..', 'consegna');
const zipPath = path.join(deliveryDir, 'odys-progetto-sorgente.zip');

/** Cartelle e file mai inclusi nel pacchetto. */
const EXCLUDED = new Set([
  'node_modules', 'dist', '.angular', 'out-tsc', '.expo', '.claude', '.DS_Store',
  'legacy-triply',            // progetto originale: resta come riferimento solo nella cartella di lavoro
  'dev.log', '.env',
]);
const EXCLUDED_PATHS = new Set([path.join('apps', 'api', 'data')]); // viaggi di prova salvati in locale

const staging = mkdtempSync(path.join(os.tmpdir(), 'odys-source-'));
const target = path.join(staging, 'odys-progetto');

cpSync(root, target, {
  recursive: true,
  filter: (source) => {
    const relative = path.relative(root, source);
    if (!relative) return true;
    if (EXCLUDED_PATHS.has(relative)) return false;
    return !relative.split(path.sep).some((part) => EXCLUDED.has(part) || part.endsWith('.log'));
  },
});

// Documenti di riferimento raccolti in docs/riferimenti invece che nella radice.
mkdirSync(path.join(target, 'docs', 'riferimenti'), { recursive: true });
for (const file of ['odys-requisiti-business-funzionali.docx', 'odys-brand-board.webp']) {
  const from = path.join(target, file);
  if (existsSync(from)) {
    cpSync(from, path.join(target, 'docs', 'riferimenti', file));
    rmSync(from);
  }
}

mkdirSync(deliveryDir, { recursive: true });
rmSync(zipPath, { force: true });
// --norsrc/--noextattr: niente file nascosti "._" di macOS nello zip.
execFileSync('ditto', ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', target, zipPath]);
rmSync(staging, { recursive: true, force: true });

console.log(`✅ Pacchetto sorgente pronto: ${zipPath}`);
