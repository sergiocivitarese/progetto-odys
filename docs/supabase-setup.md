# Collegare Odys a Supabase

Supabase custodisce gli account (registrazione, accesso, verifica email) e tutti i dati salvati:
profili, viaggi con lo storico delle versioni, idee salvate, preferenze e registro attività.
Serve farlo **una volta sola** per ogni ambiente (sviluppo, demo, produzione). Tempo: circa 15 minuti.

## 1. Crea il progetto
1. Vai su [supabase.com](https://supabase.com) e accedi (puoi usare l'account GitHub o un'email).
2. Premi **New project**.
3. Compila:
   - **Name**: `odys` (o `odys-sviluppo`, `odys-produzione`…).
   - **Database password**: premi *Generate a password* e **salvala** in un posto sicuro (gestore di password): servirà al passo 3.
   - **Region**: scegli **Central EU (Frankfurt)**, così i dati restano in Europa (GDPR).
4. Premi **Create new project** e attendi un paio di minuti.

## 2. Copia le chiavi del progetto
Apri **Project Settings → API Keys** (nelle versioni meno recenti della dashboard: **Project Settings → API**).

| Cosa copiare | Dove va nel file `.env` | Note |
|---|---|---|
| **Project URL** (es. `https://abcd1234.supabase.co`) | `SUPABASE_URL` | Pubblico |
| **Publishable key** oppure **anon public** | `SUPABASE_ANON_KEY` | Pubblica: può arrivare al browser, i permessi li decidono le regole del database |
| **Secret key** oppure **service_role** | `SUPABASE_SERVICE_ROLE_KEY` | **Segreta**: resta solo sul server. Serve per eliminare un account e per la cache del geocoding |

## 3. Copia l'indirizzo del database
1. In alto nella dashboard premi **Connect → Direct**.
2. Come metodo scegli **Session pooler** (funziona su tutte le reti), tipo **URI**.
3. Copia la stringa in `SUPABASE_DB_URL` **togliendo** la parte `:[YOUR-PASSWORD]`
   (es. `postgresql://postgres.abcd1234@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`).
4. Scrivi la password del database, così com'è, in `SUPABASE_DB_PASSWORD` (niente codifiche da fare a mano).
   Se non la ricordi: **Reset database password** nella stessa finestra.
Servono solo per creare le tabelle (passo 5).

## 4. Crea il file di configurazione
Nella cartella `progetto-odys/apps/api` copia `.env.example` e chiama la copia `.env`, poi incolla i valori:

```
SUPABASE_URL=https://abcd1234.supabase.co
SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
SUPABASE_DB_URL=postgresql://postgres.abcd1234@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
SUPABASE_DB_PASSWORD=la-password-del-database
```

Le chiavi si copiano con l'**icona di copia**: se selezioni il testo a mano rischi di copiare la versione
nascosta (`sb_secret_xxxx••••`). Una chiave valida è lunga decine di caratteri.

Il file `.env` è escluso dai pacchetti di consegna e non va mai condiviso o inviato per email.

## 5. Crea le tabelle
Dalla cartella `progetto-odys`:

```bash
npx -p node@22 npm run db:migrate
```

Deve comparire `✅ … migrazioni applicate.` Lanciarlo di nuovo è sicuro: applica solo le migrazioni nuove.
Le migrazioni creano soltanto: se trovassero tabelle con lo stesso nome si fermerebbero senza modificare nulla.

## 6. Configura l'accesso
In **Authentication → URL Configuration**:
- **Site URL**: `http://localhost:4200` (in produzione: l'indirizzo pubblico del sito).
- **Redirect URLs**: aggiungi `http://localhost:4200/**` e, per la demo da consegnare, `http://localhost:8080/**`.

In **Authentication → Sign In / Providers → Email**:
- lascia attivo **Confirm email** (verifica dell'indirizzo, requisito U-13);
- imposta **Minimum password length** a `8`.

Facoltativo ma consigliato: in **Authentication → Emails** traduci in italiano i testi delle email di conferma e di recupero password.

> **Limite delle email nel piano gratuito.** Il servizio email incluso in Supabase invia pochi messaggi l'ora ed è pensato per le prove. Prima di aprire la registrazione al pubblico configura un provider SMTP (es. Brevo, Postmark, Amazon SES) in **Authentication → Emails → SMTP Settings**.

## 7. Prova
```bash
npx -p node@22 npm run dev
```
Il terminale deve mostrare `Supabase: collegato`. Apri http://localhost:4200, premi **Accedi → Registrati gratis**, conferma l'email e salva un viaggio:
lo trovi in **Table Editor → trips**, con le versioni in `trip_versions` e le attività in `trip_activities`.

## Cosa c'è nel database

| Tabella | Contenuto |
|---|---|
| `profiles` | Nome, cognome, data di nascita, interessi, ruolo (viaggiatore, coordinatore, agenzia, amministratore) e stato dell'account |
| `consents` | Consensi a termini, privacy e marketing, con versione e data |
| `user_preferences` | Tema scelto e completamento dell'introduzione |
| `trips` | Viaggi salvati (itinerario completo); l'eliminazione è "morbida" e conserva lo storico |
| `trip_versions` | Ogni versione salvata di ogni itinerario, con il motivo della modifica |
| `trip_activities` | Le attività dell'ultima versione in forma di tabella (città, categoria, orari, luogo): la base per statistiche e futuri suggerimenti con l'AI |
| `saved_group_trips` | Idee di viaggio di gruppo salvate |
| `audit_log` | Registro delle azioni importanti, visibile all'utente e all'amministratore |
| `geocode_cache` | Luoghi già cercati, condivisi per ridurre le chiamate al provider (solo server) |
| `published_trips` | Viaggi pubblicati dai coordinatori: dati di vendita, stato, itinerario |
| `saved_published_trips` | Viaggi pubblicati salvati come idea dagli utenti |
| `coordinator_profiles` (vista) | Profilo pubblico dei coordinatori: nome, iniziale del cognome, presentazione (marcata "UNRESTRICTED" in dashboard: è voluto) |
| `odys_migrations` | Registro tecnico delle migrazioni applicate (non accessibile dall'API) |

Ogni tabella ha regole di accesso (RLS): ogni utente vede solo i propri dati; ruolo e stato
dell'account li modifica solo un amministratore. Per nominare il primo amministratore o un
coordinatore (attivazione manuale, C-03), in **Table Editor → profiles** imposta `role` a `admin` o
`coordinator` sulla riga dell'utente. Se l'elenco delle tabelle non si vede, allarga la finestra del browser.
