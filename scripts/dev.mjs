#!/usr/bin/env node
/**
 * Avvia backend (http://localhost:3000) e frontend (http://localhost:4200) insieme.
 * Uso: `npm run dev` dalla cartella del progetto.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 19)) {
  console.error(`\nOdys richiede Node.js 20.19 o superiore (trovato ${process.versions.node}).`);
  console.error('Installa Node 22 (es. `nvm install 22`) oppure esegui: npx -p node@22 npm run dev\n');
  process.exit(1);
}

// Se le porte sono già occupate (Odys già avviato in un altro terminale) lo diciamo subito.
const busy = [];
for (const port of [3000, 4200]) {
  const inUse = await new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => server.close(() => resolve(false)));
    server.listen(port);
  });
  if (inUse) busy.push(port);
}
if (busy.length) {
  console.error(`\nLa porta ${busy.join(' e ')} è già in uso: probabilmente Odys è già avviato.`);
  console.error('Apri http://localhost:4200 oppure chiudi l’altra istanza (Ctrl+C nel suo terminale) e riprova.');
  console.error(`Per liberare le porte: lsof -ti tcp:${busy.join(',')} | xargs kill\n`);
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const services = [
  { name: 'api', color: '\x1b[38;2;216;246;78m', args: ['run', 'dev', '-w', '@odys/api'] },
  { name: 'web', color: '\x1b[38;2;49;87;255m', args: ['run', 'start', '-w', 'web', '--', '--port', '4200'] },
];

const children = services.map(({ name, color, args }) => {
  const child = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, target) => stream.on('data', (chunk) => {
    chunk.toString().split('\n').filter(Boolean).forEach((line) => target.write(`${prefix}${line}\n`));
  });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}terminato (codice ${code})`);
    shutdown(code ?? 0);
  });
  return child;
});

function shutdown(code) {
  children.forEach((child) => { if (!child.killed) child.kill('SIGTERM'); });
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
