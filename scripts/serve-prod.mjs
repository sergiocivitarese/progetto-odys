// Serve la build di produzione della webapp (con il service worker attivo) e inoltra /api al backend.
// Uso: npm run build -w web && node scripts/serve-prod.mjs  →  http://localhost:4300
import { createServer, request } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('../apps/web/dist/web/browser/', import.meta.url).pathname;
const port = Number(process.env.PORT ?? 4300);
const api = new URL(process.env.API_URL ?? 'http://localhost:3000');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api')) {
    const upstream = request({ host: api.hostname, port: api.port, path: req.url, method: req.method, headers: { ...req.headers, host: api.host } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    // Backend spento: si chiude la connessione come farebbe una rete assente, così il service worker usa i dati salvati.
    upstream.on('error', () => res.socket?.destroy());
    req.pipe(upstream);
    return;
  }
  let file = join(root, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
  const exists = await stat(file).then((s) => s.isFile()).catch(() => false);
  if (!exists) file = join(root, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(await readFile(file));
}).listen(port, () => console.log(`Odys (build di produzione) su http://localhost:${port}`));
