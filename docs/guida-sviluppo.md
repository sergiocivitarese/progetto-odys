# Guida per chi continua lo sviluppo di Odys

Questa guida serve a chi riceve il progetto: come ottenere il codice, cosa installare, come avviare
la webapp, con quali account provarla, dove mettere le mani e cosa manca rispetto all’analisi funzionale.

Aggiornata al **18 novembre 2026**. Ramo principale: `main` (contiene tutto il lavoro delle specifiche per ruolo).

---

## 1. In breve

| Domanda | Risposta |
|---|---|
| Cosa serve installare | Solo **Node.js 22** (con npm) e **git**. Niente database locale, niente Docker. |
| Come la provo subito | `npm install` e poi `npm run dev:demo`: si apre su http://localhost:4200 con dati di prova e un pulsante «Entra come…» per ogni ruolo. Non servono né Supabase né chiavi. |
| Come lavoro con dati veri | Si collega l’API a un progetto Supabase con il file `apps/api/.env`, poi `npm run dev` (§ 4). |
| Account di test su Supabase | Si creano con `npm run db:seed-accounts`: uno per ruolo, email già confermata (§ 4.3). |
| A che punto siamo | Tutti i blocchi delle *Specifiche per ruolo* (R0–R5) sono sviluppati e coperti da test. Mancano il collaudo con account reali e le parti che il cliente ha rinviato: pagamenti veri, AI vera, chat, notifiche email (§ 8–9). |

---

## 2. Condividere il codice (per chi lo consegna)

1. **GitHub**: il repository `sergiocivitarese/progetto-odys` è privato. Da GitHub → *Settings → Collaborators → Add people*,
   invita l’account GitHub del collega. Lui accetta l’invito dalla email o da github.com/notifications.
2. **Ramo**: tutto il lavoro è in `main` (il ramo `ruoli-traveller-base` è stato unito il 18 novembre 2026).
   Per le modifiche nuove conviene un ramo per argomento e una *pull request* verso `main`.
3. **Cosa non c’è nel repository** (giusto così): il file `apps/api/.env` con le chiavi e le password, le cartelle
   `node_modules` e i build. Le chiavi **non** si mandano per chat o email: se servono, si usa un gestore di password condiviso.
4. **Supabase**: due strade, spiegate al § 4. La più sicura per tutti è che il collega usi **un suo progetto Supabase di sviluppo**:
   così non tocca i dati del progetto «Odys» e non servono chiavi condivise.

In alternativa a GitHub c’è `npm run package:source`, che crea `../consegna/odys-progetto-sorgente.zip`
(progetto pulito, senza `.env` né dipendenze). Con lo zip però si perde la storia dei commit: meglio GitHub.

---

## 3. Installazione (per chi riceve il progetto)

### Prerequisiti
- **Node.js 22** (va bene anche 20.19 o successivo). Controllo: `node -v`.
  Il modo più comodo per installarlo è [nvm](https://github.com/nvm-sh/nvm): nella cartella del progetto basta `nvm install` e `nvm use` (legge `.nvmrc`).
- **git** e un editor (consigliato VS Code con l’estensione *Angular Language Service*).
- Porte libere sul computer: **3000** (API) e **4200** (webapp).

### Primo avvio

```bash
git clone git@github.com:sergiocivitarese/progetto-odys.git
```

```bash
cd progetto-odys
```

```bash
npm install
```

```bash
npm run dev:demo
```

Apri http://localhost:4200/accedi e scegli con chi entrare:

| Account demo | Cosa ci si prova |
|---|---|
| Lia Bassi, viaggiatrice | Esplora, dettaglio, prenotazione con acconto (pagamento simulato), Prossimo viaggio, invito in agenzia da accettare nel profilo |
| Nora Conti, coordinatrice Premium | Area coordinatore, creazione del viaggio in 4 passi, prezzo e pareggio, kit social, partecipanti, pagina Dati, Creator Studio |
| Olga Ferri, titolare di agenzia | Agenzia «Sud Lento»: profilo, team e licenze, catalogo con partenze, proposte da approvare, dashboard, AI per i coordinatori, piano |
| Ada Rossi, amministratrice | Candidature, segnalazioni, ruoli e piani degli account |

In modalità demo i dati vivono **in memoria** nell’API (`apps/api/scripts/dev-memory.ts`): si ricreano a ogni avvio,
e le modifiche spariscono quando il server si ferma. Registrazione, recupero password e caricamento di foto e video
non sono disponibili (sono servizi di Supabase).

`Ctrl+C` nel terminale ferma tutto. Se le porte risultano occupate, lo script lo dice e indica come liberarle.

---

## 4. Lavorare con Supabase (dati veri)

Supabase fornisce gli account (registrazione, accesso, email), il database Postgres con le regole di accesso (RLS)
e l’archivio dei media. L’API lo usa se trova le chiavi in `apps/api/.env`. Il browser riceve solo l’indirizzo e la chiave pubblica.

### 4.1 Strada consigliata: un progetto Supabase di sviluppo tutto suo
1. Crea un progetto gratuito seguendo [supabase-setup.md](supabase-setup.md), passi 1–4: regione Francoforte, chiavi e indirizzo del database.
2. Copia `apps/api/.env.example` in `apps/api/.env` e compila `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` e `SUPABASE_DB_PASSWORD`.
3. Crea le tabelle (applica le 25 migrazioni di `supabase/migrations`, in ordine, una volta sola ciascuna):

   ```bash
   npm run db:migrate
   ```

4. Imposta in `.env` una password a tua scelta per gli account di test (`TEST_ACCOUNTS_PASSWORD`, almeno 10 caratteri) e creali:

   ```bash
   npm run db:seed-accounts
   ```

5. Configura l’accesso nella dashboard di Supabase (*Authentication → URL Configuration*: `http://localhost:4200`), come da supabase-setup.md, passo 6.
6. Avvia con le chiavi:

   ```bash
   npm run dev
   ```

### 4.2 Strada alternativa: usare il progetto «Odys» esistente
Il titolare del progetto invita il collega nell’organizzazione Supabase (*Organization → Team → Invite*).
Il collega copia le chiavi dalla dashboard nel suo `.env`. È la stessa base dati usata per le prove del cliente:
qui gli account di test vanno creati con criterio, e le migrazioni nuove si applicano solo dopo averle concordate.

### 4.3 Account di test
`npm run db:seed-accounts` crea, o riallinea se esistono già, questi account (dominio predefinito `odys.test`):

| Email | Profilo |
|---|---|
| `viaggiatore@odys.test` | Traveller Base |
| `viaggiatore-premium@odys.test` | Traveller Premium |
| `coordinatore@odys.test` | Coordinatore Base, candidatura approvata |
| `coordinatore-premium@odys.test` | Coordinatore Premium |
| `agenzia@odys.test` | Piano Agenzia (l’agenzia si crea da `/agenzia`) |
| `admin@odys.test` | Amministratore |

La password è quella scelta in `TEST_ACCOUNTS_PASSWORD`. Lo script usa la chiave `service_role`:
va lanciato **solo su progetti di sviluppo o di test**. Piani e ruoli si cambiano anche dall’app,
con l’account amministratore, nella pagina Account dell’utente.

### 4.4 Da sapere
- Il progetto gratuito di Supabase **va in pausa** dopo una settimana senza attività. Se accesso e catalogo smettono di funzionare, si riattiva dalla dashboard.
- Ogni modifica allo schema è una **nuova** migrazione `00NN_nome.sql`: le migrazioni già applicate non si modificano.

---

## 5. Comandi

| Comando | Cosa fa |
|---|---|
| `npm run dev:demo` | API in memoria con dati e account di prova + webapp (4200). Senza Supabase. |
| `npm run dev` | API collegata a Supabase (legge `apps/api/.env`) + webapp (4200) |
| `npm test` | test del dominio (67) e di API e database (97). Il database usa PGlite (Postgres in memoria), non Supabase. |
| `npm run typecheck` | controllo dei tipi di dominio e API |
| `npm run build` | build di produzione |
| `npm run db:migrate` | applica a Supabase le migrazioni non ancora applicate |
| `npm run db:seed-accounts` | crea gli account di test su Supabase |
| `npm run package:source` / `package:demo` | pacchetti zip del sorgente o della demo per il cliente |

Prima di ogni commit: `npm test` e `npm run typecheck` verdi, e la schermata cambiata provata nel browser.

---

## 6. Come è fatto il codice

Monorepo npm con tre parti. I dettagli stanno in [architettura.md](architettura.md), lo stile in [design-system.md](design-system.md).

| Cartella | Cosa contiene |
|---|---|
| `packages/domain` | Regole di business in TypeScript puro: itinerari, prezzi e pareggio, affinità, piani e diritti, agenzia, dashboard. Usato da API e webapp. |
| `apps/api` | Express 5. `src/modules/<area>/<area>.routes.ts` sono gli endpoint; `src/infra/supabase/*` è l’archivio reale, `src/infra/memory/*` quello in memoria per i test e la demo, **con le stesse regole**. |
| `apps/web` | Angular 20 (componenti standalone, signals). `src/app/features/<area>` sono le pagine, `core/` le chiamate all’API e lo stato, `shared/ui` i componenti. |
| `supabase/migrations` | Schema, regole RLS e funzioni SQL. Le azioni delicate (pagamenti, agenzia, ruoli) passano da funzioni `security definer`, che controllano chi le chiama. |

**Ricetta per una nuova funzione**:
1. regola nel dominio, con il suo test;
2. migrazione SQL;
3. metodo nel contratto in `apps/api/src/shared/*` e nelle due implementazioni, Supabase e memoria;
4. endpoint nel modulo, protetto da `requireEntitlement` se è riservato a un piano;
5. pagina o componente in `apps/web`, con `entitlementGuard` se serve;
6. test in `apps/api/test/api.test.ts` (memoria) e `database.test.ts` (SQL vero), dati demo in `dev-memory.ts`.

**Convenzioni**: testi dell’app e commenti in italiano; nei commit si cita l’ID del requisito (es. `AG-07`);
i diritti dei piani li decide sempre il server, la webapp li legge soltanto.

---

## 7. Documenti di riferimento

In `docs/riferimenti`:
- `odys-requisiti-business-funzionali.docx`: **analisi funzionale** di partenza (requisiti U-, C-, A-, G-, P-, M-, S-, T-), organizzata in fasi.
- `odys-specifiche-per-ruolo.pdf` (28 ottobre 2026): **specifiche per ruolo** che il cliente ha dato dopo. Requisiti TB-, TP-, CB-, CP-, AG-, e piano di lavoro attuale.
- `odys-app-mobile.pdf`: mockup delle schermate. `odys-brand-board.webp`: identità visiva.

Lo stato dettagliato, requisito per requisito, e le decisioni provvisorie sono in [roadmap.md](roadmap.md).

---

## 8. Dove siamo arrivati, rispetto all’analisi funzionale

### Analisi funzionale (fasi del documento business)

| Fase | Contenuto | Stato |
|---|---|---|
| 0 | Planner: itinerario giorno per giorno, mappa, meteo, percorsi, import/export | ✅ Fatto |
| 1 | Account: registrazione con verifica email e consensi, accesso, viaggi salvati con versioni, eliminazione account | ✅ Fatto |
| 2 | Catalogo dei viaggi di gruppo, ricerca, dettaglio, richiesta di partecipazione | ✅ Fatto |
| 3 | Coordinatori: candidatura e approvazione, linee guida, profilo pubblico, offerte, partecipanti | ✅ Fatto (verifica d’identità C-02 da definire) |
| 4 | Creator Studio: post, programmazione, media, feed, like | ✅ Fatto (nessuna transcodifica video) |
| 5 | Agenzie | ✅ Fatto, riscritto secondo le specifiche per ruolo (R5) |
| 6 | Amministrazione e moderazione | ✅ Fatto (cruscotto economico G-05 dopo i pagamenti veri) |
| 7 | Pagamenti, AI, chat, Split, analytics | 🟡 In parte: checkout e acconto ci sono ma **simulati**; Split e analytics del coordinatore fatti; AI con motore locale; chat rinviata |

### Specifiche per ruolo (piano attuale)

| Blocco | Requisiti | Stato |
|---|---|---|
| R0 Fondamenta: piani e diritti, stile, navigazione per ruolo | TP-10, AG-09 | ✅ Fatto |
| R1 Traveller Base | TB-01…TB-12 | ✅ Fatto |
| R2 Traveller Premium | TP-01…TP-09 | ✅ Fatto (generatore con motore locale) |
| R3 Coordinatore Base | CB-01…CB-11 | ✅ Fatto |
| R4 Coordinatore Premium | CP-01…CP-06 | ✅ Fatto |
| R5 Agenzia | AG-01…AG-12 | ✅ Fatto |
| Fase 2 del cliente | TB-13 (chat di gruppo), CP-07 (suggerimenti dai dati) | ⏳ Rinviata dal cliente |

«Fatto» vuol dire sviluppato, coperto da test e provato nel browser con i dati demo.
Con un account reale sono state provate in sola lettura le schermate di viaggiatore e coordinatore.
Le azioni che scrivono dati vanno ancora collaudate su Supabase.

---

## 9. Cosa manca

### Da fare subito
1. **Collaudo con account reali** su Supabase, con gli account del § 4.3: prenotazione e acconto, candidatura e approvazione,
   creazione e pubblicazione di un viaggio, Creator Studio con caricamento media, agenzia completa (inviti, licenze, ombrello, proposte), segnalazioni.
2. **Chiudere un limite noto**: la colonna `place_stories` è leggibile direttamente dal database con la chiave pubblica.
   Va protetta con permessi di colonna (vedi roadmap, punti aperti).

### Decisioni che aspettano il cliente (oggi c’è un valore provvisorio)
Prezzi e durata degli abbonamenti, prezzi delle licenze agenzia e dei piani Start/Pro/Business, commissione Odys (oggi stimata al 10%),
rimborsi dell’acconto, regola di attribuzione delle vendite ai post, limite dei 12 partecipanti.
L’elenco completo, con il valore usato nel codice, è nella tabella «Punti aperti» della roadmap.

### Integrazioni rinviate (Fase 7 e Fase 2 del cliente)
| Cosa | Dove si innesta |
|---|---|
| Pagamenti veri (checkout, abbonamenti, licenze, payout ai coordinatori) | Interfaccia `PaymentProvider` nell’API. Va tolta la conferma dal browser `confirm_simulated_payment`: al suo posto, conferma solo dal webhook (`confirm_payment`). |
| AI vera per il generatore e per l’agenzia | `packages/domain/src/lib/tripGenerator.ts` è il motore locale da affiancare o sostituire |
| Notifiche email (inviti in agenzia, solleciti dei saldi) | Oggi compaiono solo nell’app |
| Chat di gruppo (TB-13), suggerimenti dai dati (CP-07) | Rinviati dal cliente |
| Verifica d’identità dei coordinatori (C-02), transcodifica video, cruscotto economico (G-05) | Da definire con il cliente |

---

## 10. Problemi comuni

| Sintomo | Soluzione |
|---|---|
| «Odys richiede Node.js 20.19 o superiore» | `nvm install 22 && nvm use 22`, oppure `npx -p node@22 npm run dev` |
| «La porta 3000 e 4200 è già in uso» | Odys è già avviato in un altro terminale: chiudilo o usa il comando che lo script suggerisce |
| La pagina Accedi dice «Accesso non ancora attivo» | L’API non trova le chiavi Supabase: controlla `apps/api/.env`, oppure usa `npm run dev:demo` |
| Accesso e catalogo smettono di funzionare all’improvviso | Il progetto Supabase gratuito è in pausa: riattivalo dalla dashboard |
| Una pagina mostra «errore» dopo un aggiornamento del codice | Mancano migrazioni: `npm run db:migrate` |
| Nella build di produzione (`prod-web`, porta 4300) si vede una versione vecchia | È la cache del service worker: ricarica forzata, oppure DevTools → Application → *Unregister* |
