/**
 * Applica le migrazioni SQL di `supabase/migrations` al database Supabase.
 * Uso: `npm run db:migrate` (richiede SUPABASE_DB_URL in apps/api/.env).
 *
 * Ogni file viene eseguito una sola volta, in una transazione, e registrato
 * nella tabella `public.odys_migrations`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const rawUrl = process.env.SUPABASE_DB_URL?.trim();
const dbPassword = process.env.SUPABASE_DB_PASSWORD ?? '';
if (!rawUrl) {
  console.error('\nManca SUPABASE_DB_URL in apps/api/.env (Supabase → Connect → Direct → Session pooler → URI).\n');
  process.exit(1);
}
// La password può stare in una riga a parte (SUPABASE_DB_PASSWORD): così non va codificata a mano.
const parsedUrl = new URL(rawUrl);
if (dbPassword) parsedUrl.password = encodeURIComponent(dbPassword);
if (!parsedUrl.password || parsedUrl.password.includes('YOUR-PASSWORD')) {
  console.error('\nManca la password del database: compila SUPABASE_DB_PASSWORD in apps/api/.env.\n');
  process.exit(1);
}
const dbUrl = parsedUrl.toString();

const migrationsDir = path.resolve(import.meta.dirname, '../../../supabase/migrations');
const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
const sql = postgres(dbUrl, { max: 1, onnotice: () => undefined, prepare: false });

try {
  await sql`create table if not exists public.odys_migrations (name text primary key, applied_at timestamptz not null default now())`;
  // Tabella tecnica: mai esposta all'API pubblica.
  await sql`alter table public.odys_migrations enable row level security`;
  await sql`revoke all on table public.odys_migrations from anon, authenticated`;
  const applied = new Set((await sql<{ name: string }[]>`select name from public.odys_migrations`).map((row) => row.name));
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    console.log(`▶ ${file}`);
    const content = readFileSync(path.join(migrationsDir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`insert into public.odys_migrations (name) values (${file})`;
    });
    count += 1;
  }
  console.log(count ? `\n✅ ${count} migrazioni applicate.` : '\n✅ Database già aggiornato.');
} catch (error) {
  console.error('\n❌ Migrazione non riuscita:', (error as Error).message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
