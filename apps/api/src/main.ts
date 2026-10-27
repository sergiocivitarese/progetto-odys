import { createApp } from './app';
import { loadConfig, supabaseConfigured } from './config/env';

const config = loadConfig();
const app = createApp(config);

app.listen(config.port, () => {
  const providers = Object.entries(config.keys).map(([name, key]) => `${name}:${key ? 'on' : 'off'}`).join(' ');
  console.log(`Odys API in ascolto su http://localhost:${config.port} · provider ${providers}`);
  console.log(supabaseConfigured(config)
    ? `Supabase: collegato (${config.supabase.url})${config.supabase.serviceRoleKey ? '' : ' · senza chiave service_role: eliminazione account disattivata'}`
    : 'Supabase: NON configurato → login e salvataggio disattivati. Compila SUPABASE_URL e SUPABASE_ANON_KEY in apps/api/.env');
});
