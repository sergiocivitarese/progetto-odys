/**
 * Crea (o riallinea) gli account di test su un progetto Supabase: uno per ruolo,
 * con email già confermata, così chi sviluppa può provare ogni area dell'app.
 *
 * Uso: npm run db:seed-accounts (dalla radice). Richiede in apps/api/.env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   → chiavi del progetto
 *   TEST_ACCOUNTS_PASSWORD                     → password comune degli account (almeno 10 caratteri)
 *   TEST_ACCOUNTS_DOMAIN (facoltativo)         → dominio delle email, predefinito «odys.test»
 *
 * Si può rilanciare: gli account esistenti non vengono ricreati, ruolo, piani e
 * candidatura vengono solo riallineati. Non inviare email: la conferma è già fatta.
 * Da usare solo su progetti di sviluppo o di test, mai su quello con utenti reali.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const password = process.env.TEST_ACCOUNTS_PASSWORD ?? '';
const domain = (process.env.TEST_ACCOUNTS_DOMAIN ?? 'odys.test').trim();

if (!url || !serviceKey) {
  console.error('\nMancano SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY in apps/api/.env.\n');
  process.exit(1);
}
if (password.length < 10) {
  console.error('\nImposta TEST_ACCOUNTS_PASSWORD in apps/api/.env (almeno 10 caratteri): sarà la password di tutti gli account di test.\n');
  process.exit(1);
}

type Plan = 'traveller_premium' | 'coordinator_premium' | 'agency';
interface TestAccount {
  key: string;
  firstName: string;
  lastName: string;
  role: 'traveler' | 'coordinator' | 'admin';
  plans: Plan[];
  /** Candidatura da coordinatore già approvata (badge «verificato»). */
  approvedCoordinator?: boolean;
  description: string;
}

const ACCOUNTS: TestAccount[] = [
  { key: 'viaggiatore', firstName: 'Luca', lastName: 'Test', role: 'traveler', plans: [], description: 'Traveller Base' },
  { key: 'viaggiatore-premium', firstName: 'Marta', lastName: 'Test', role: 'traveler', plans: ['traveller_premium'], description: 'Traveller Premium' },
  { key: 'coordinatore', firstName: 'Nora', lastName: 'Test', role: 'coordinator', plans: [], approvedCoordinator: true, description: 'Coordinatore Base, candidatura approvata' },
  { key: 'coordinatore-premium', firstName: 'Paolo', lastName: 'Test', role: 'coordinator', plans: ['coordinator_premium'], approvedCoordinator: true, description: 'Coordinatore Premium' },
  { key: 'agenzia', firstName: 'Olga', lastName: 'Test', role: 'traveler', plans: ['agency'], description: 'Piano Agenzia: crea l’agenzia da /agenzia' },
  { key: 'admin', firstName: 'Ada', lastName: 'Test', role: 'admin', plans: [], description: 'Amministratore: candidature, segnalazioni, ruoli' },
];

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserId(email: string): Promise<string | null> {
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const user = data.users.find((item) => item.email?.toLowerCase() === email);
    if (user) return user.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensure(account: TestAccount): Promise<string> {
  const email = `${account.key}@${domain}`.toLowerCase();
  let id = await findUserId(email);
  if (!id) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: account.firstName, last_name: account.lastName, birth_date: '1990-01-01', accepted_terms: true, consent_version: '2026-10' },
    });
    if (error) throw new Error(`${email}: ${error.message}`);
    id = data.user.id;
  }

  const check = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`${email} · ${label}: ${error.message}`);
  };
  check('ruolo', (await supabase.from('profiles').update({ role: account.role, status: 'active' }).eq('id', id)).error);

  for (const plan of account.plans) {
    const existing = await supabase.from('subscriptions').select('id').eq('user_id', id).eq('plan', plan).eq('status', 'active').limit(1);
    check('piano', existing.error);
    if (!existing.data?.length) check('piano', (await supabase.from('subscriptions').insert({ user_id: id, plan, status: 'active', source: 'admin' })).error);
  }

  if (account.approvedCoordinator) {
    const existing = await supabase.from('coordinator_applications').select('id').eq('user_id', id).eq('status', 'approved').limit(1);
    check('candidatura', existing.error);
    if (!existing.data?.length) {
      check('candidatura', (await supabase.from('coordinator_applications').insert({
        user_id: id,
        status: 'approved',
        motivation: 'Account di test: organizzo viaggi in piccoli gruppi per provare l’area coordinatore.',
        experience: 'Account creato dallo script degli account di test.',
        trips_led: 5,
        languages: ['Italiano', 'Inglese'],
        guidelines_version: 'test',
        decided_at: new Date().toISOString(),
      })).error);
    }
  }
  return email;
}

try {
  console.log(`\nAccount di test su ${new URL(url).host} (password: TEST_ACCOUNTS_PASSWORD)\n`);
  for (const account of ACCOUNTS) {
    const email = await ensure(account);
    console.log(`  ✓ ${email.padEnd(34)} ${account.description}`);
  }
  console.log('\nAccedi da http://localhost:4200/accedi con una di queste email.\n');
} catch (error) {
  console.error('\n❌', (error as Error).message, '\n');
  process.exitCode = 1;
}
