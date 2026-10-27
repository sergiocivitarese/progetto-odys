# Architettura di Odys

Il progetto è un **monorepo npm** con tre blocchi indipendenti:

```
progetto-odys/
├── packages/domain/     ← regole di business (TypeScript puro, nessun framework)
├── apps/api/            ← backend Node.js/Express: persistenza, provider esterni, ricalcoli
├── apps/web/            ← frontend Angular: interfaccia responsive
└── legacy-triply/       ← progetto originale, solo consultazione
```

Il principio è: **la logica vive una volta sola** in `@odys/domain`. Il backend la usa per generare
e ricalcolare i piani; il frontend la usa per le modifiche istantanee in bozza e per le etichette.

```
 Browser (Angular)                      Server (Node)
┌────────────────────────┐   HTTP    ┌──────────────────────────┐
│ features/* (pagine)    │  /api/*   │ modules/* (router)       │
│   ↓ usano               │ ───────▶ │   ↓ usano                │
│ core/ (API + stato)    │           │ servizi + repository     │
│ shared/ (UI)           │           │                          │
└──────────┬─────────────┘           └───────────┬──────────────┘
           └──────────── @odys/domain ───────────┘
```

---

## 1. `packages/domain` — il dominio

| File | Contenuto |
|---|---|
| `types/travel.ts` | Il modello dati (viaggio, giornata, attività, tratta, luogo, meteo, mappa). Nel progetto Triply questo file mancava: è stato ricostruito dal codice. |
| `lib/generateItinerary.ts` | Generazione del piano dal modulo, validazioni di date/orari/budget, tratte. |
| `lib/itineraryEditing.ts` | Regole della schermata itinerario come funzioni pure: aggiungi/sposta/elimina attività, date, budget, alloggio, completamenti. |
| `lib/tripForm.ts` | Regole del modulo "Pianifica il mio viaggio". |
| `lib/savedTrips.ts` | Salvataggio, migrazione dei piani vecchi, ordinamento. |
| `lib/routeModel.ts`, `mapModel.ts`, `repositioning.ts` | Nodi, tratte, mappa, proposta di riposizionamento. |
| `lib/weather.ts`, `geocoding.ts`, `routing.ts` | Adattatori dei provider (Open-Meteo, Geoapify, GraphHopper). |
| `lib/tripTransfer.ts` | Export/import JSON (compatibile con gli export Triply v5). |

Regola: **nessun accesso a rete, storage o variabili d'ambiente** decide qualcosa qui dentro; chi usa il
dominio passa chiavi e dipendenze (es. `new GeocodingClient(adapter, cacheStore)`).

Test: `packages/domain/test` (`npm test -w @odys/domain`).

---

## 2. `apps/api` — il backend

Ogni area funzionale è un **modulo** in `src/modules/<nome>/` con un router Express:

| Modulo | Endpoint | Cosa fa |
|---|---|---|
| `account` | `GET/PATCH/DELETE /api/me`, `PUT /api/me/preferences`, `/me/activity`, `/me/saved-ideas` | Profilo, preferenze, idee salvate, registro attività, eliminazione account |
| `published` | `GET /api/catalog/trips`, `/trips/:id`, `/coordinators/:id` (pubblici), `POST /trips/:id/copy` | Catalogo dei viaggi pubblicati, profili dei coordinatori, "usa come base" |
| `coordinator` | `GET /api/coordinator/status`, `POST /guidelines`, `GET/POST /trips`, `GET/PUT /trips/:id`, `POST /trips/:id/(publish|schedule|unpublish|cancel|archive)` | Area coordinatore: offerte, linee guida, stati di pubblicazione |
| `trips` | `GET/POST /api/trips`, `GET/PUT/PATCH/DELETE /api/trips/:id`, `/import`, `/:id/export`, `/:id/versions`, `/:id/versions/:v/restore` | Viaggi dell'utente con storico delle versioni |
| `itinerary` | `POST /api/itineraries/generate`, `/dates/*`, `/budget`, `/origin/*`, `/finalize`, `/reposition` | Generazione e ricalcoli |
| `geo` | `GET /api/geo/search`, `POST /api/geo/enrich`, `/confirm` | Geocoding Geoapify con cache su file |
| `weather` | `POST /api/weather/refresh` | Meteo Open-Meteo per giornata |
| `routing` | `POST /api/routes/calculate` | Percorso online GraphHopper di una tratta |
| `maps` | `GET /api/maps/static` | Proxy mappa statica MapTiler |
| `catalog` | `GET /api/config`, `/group-trips`, `/places/:id` | Configurazione pubblica e contenuti demo |

Composizione in `src/app.ts`. Errori: lancia `new HttpError(status, 'messaggio leggibile')` e il
gestore centrale risponde `{ "error": "..." }` (il frontend lo mostra all'utente).

### Accesso e dati (Supabase)
- Il browser fa login con Supabase Auth e invia il token al backend (`Authorization: Bearer …`).
- `requireAuth` (`src/shared/auth.ts`) verifica il token; le rotte riservate lo usano (U-10).
- Ogni query parte con **il token dell'utente** (`infra/supabase/client.ts → userClient`): sono le regole RLS
  del database a decidere cosa può leggere o scrivere. La chiave `service_role` resta solo sul server e
  si usa solo per eliminare un account e per la cache del geocoding.
- Contratti in `src/shared/data.ts`; implementazioni in `infra/supabase` (reale) e `infra/memory` (test).
- Schema: `supabase/migrations/*.sql`, applicato con `npm run db:migrate`. La funzione SQL `save_trip`
  salva il viaggio, crea la versione e rigenera `trip_activities` in un'unica transazione.

Test: `test/database.test.ts` esegue le migrazioni su un Postgres in memoria (PGlite) e verifica
registrazione, età minima, versioni e RLS; `test/api.test.ts` prova le rotte con l'archivio in memoria.

### Aggiungere un modulo API
1. Crea `src/modules/esempio/esempio.routes.ts` che esporta `esempioRouter(): Router`.
2. Se serve logica di business, mettila in `packages/domain` e usala dal router.
3. Monta il router in `src/app.ts`: `app.use('/api/esempio', esempioRouter());`
4. Aggiungi un test in `test/api.test.ts`.

---

## 3. `apps/web` — il frontend Angular

Angular moderno senza NgModule: ogni pezzo di interfaccia è un **componente standalone** che dichiara
da solo cosa usa (`imports: [...]`). Lo stato è gestito con i **signals** (`signal`, `computed`), che
aggiornano l'interfaccia automaticamente.

```
src/app/
├── core/                 ← servizi globali (uno per app)
│   ├── api/              ← client HTTP tipizzati: TripsApi, ItineraryApi, AccountApi, ServicesApi
│   ├── auth/             ← sessione Supabase (AuthStore), token sulle chiamate, guard delle pagine riservate
│   ├── state/            ← stato condiviso: TripsStore, AccountStore, PlanDraftStore, ThemeStore, ConfigStore
│   └── layout/           ← shell (header desktop + tab bar mobile), onboarding
├── shared/               ← blocchi riusabili, senza logica di pagina
│   ├── ui/               ← design system: button, chip, text-field, status-badge, dialog, notice…
│   └── travel/           ← blocchi di dominio riusabili: trip-card, dialoghi rinomina/elimina
├── features/             ← una cartella per sezione dell'app (caricata solo quando serve)
│   ├── home/             ← /           Home
│   ├── planner/          ← /pianifica  Pianifica il mio viaggio
│   ├── itinerary/        ← /itinerario/:id  Itinerario (store + 14 componenti)
│   ├── trips/            ← /viaggi     I miei viaggi
│   ├── place/            ← /luogo/:id  Guida luogo
│   ├── groups/           ← /gruppi, /gruppi/:id  Viaggi pubblicati e dettaglio
│   ├── auth/             ← /accedi, /registrati, recupero e nuova password, conferma email
│   ├── coordinators/     ← /coordinatori/:id  Profilo pubblico del coordinatore
│   ├── coordinator/      ← /coordinatore      Area coordinatore (elenco, nuovo, modifica)
│   ├── account/          ← /account    Area personale
│   ├── legal/            ← /privacy, /termini
│   └── not-found/
└── app.routes.ts         ← mappa delle pagine
```

### Le tre regole dei blocchi
1. **`shared/ui` non conosce le pagine**: riceve dati con `input()` ed emette eventi con `output()`.
2. **Le feature non si importano a vicenda**: se due feature usano lo stesso blocco, spostalo in `shared/`.
3. **Le pagine non chiamano HTTP direttamente**: passano da `core/api` o da uno store.

### Anatomia di un componente

```ts
@Component({
  selector: 'odys-trip-card',            // come lo usi nell'HTML: <odys-trip-card>
  imports: [ButtonComponent, IconComponent],  // gli altri blocchi che usa
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `...`,                        // oppure templateUrl: './x.html'
  styles: `...`,                          // stili isolati: non "sporcano" il resto dell'app
})
export class TripCardComponent {
  readonly trip = input.required<SavedTrip>();   // dato in ingresso
  readonly open = output<SavedTrip>();           // evento in uscita
}
```

Uso: `<odys-trip-card [trip]="t" (open)="apri($event)" />`

### Come fare le modifiche più comuni

**Cambiare un colore, un raggio o un font in tutta l'app**
→ `src/styles/_tokens.scss`. I componenti usano solo i token (`var(--color-primary)`), mai valori fissi.

**Modificare un blocco esistente** (es. la card attività)
→ `features/itinerary/components/activity-card.component.ts`. Il template è nel file; gli input in alto
dicono quali dati riceve. La modifica vale ovunque il blocco è usato.

**Aggiungere un blocco a una pagina**
1. Crea `features/<feature>/components/mio-blocco.component.ts` (copia la struttura di un blocco vicino).
2. Aggiungilo agli `imports` della pagina e usalo nel template: `<odys-mio-blocco [dato]="..." />`.

**Aggiungere una nuova pagina/sezione**
1. Crea `features/nuova/nuova.page.ts` (componente con `export default class`).
2. Crea `features/nuova/nuova.routes.ts`:
   ```ts
   export default [{ path: '', loadComponent: () => import('./nuova.page') }] satisfies Routes;
   ```
3. Aggiungi la rotta in `app.routes.ts` e, se serve, la voce di menu in `core/layout/shell/nav-items.ts`.

**Aggiungere un'icona** → registrala in `shared/ui/icon.component.ts` (catalogo su lucide.dev).

**Aggiungere una chiamata al backend** → metodo in `core/api/*.api.ts`, poi usalo da uno store.

### Lo store della pagina itinerario
`features/itinerary/itinerary.store.ts` concentra stato e casi d'uso della pagina più complessa:
- `plan` = piano salvato, `draft` = bozza in modalità modifica, `visiblePlan` = quello mostrato;
- le modifiche in bozza usano le funzioni pure di `@odys/domain` (istantanee, senza rete);
- "Salva modifiche" chiama il backend (`/finalize` ricalcola le tratte dei giorni toccati, poi `PUT /trips/:id`).

È fornito a livello di pagina (`providers: [ItineraryStore]`), quindi ogni apertura ha il proprio stato.

---

## 4. Mappatura con l'analisi funzionale

Coperto ora (logica portata da Triply):
- **U-01/U-02** home pubblica e pianificazione senza login;
- **U-06/U-07** dettaglio itinerario giorno per giorno (attività, orari, trasferimenti, note);
- **C-09/C-11** creazione manuale e modifica di ogni giornata e attività;
- **T-02** stati espliciti di caricamento, vuoto, errore;
- **T-03** TypeScript, typecheck e validazione dei dati in ingresso (import, API);
- **T-04** interfaccia responsive mobile + desktop;
- **T-05** accessibilità di base (ruoli, etichette, focus, contrasto, stato mai affidato al solo colore);
- **T-08** provider isolati da contratti (`GeoapifyAdapterContract`, `WeatherProviderAdapter`, `TripsRepository`);
- **S-03** chiavi dei provider solo lato server.

Predisposto ma non implementato (nuove logiche, da definire): autenticazione e ruoli, marketplace e
booking, pagamenti, profili coordinator, Creator Studio, agenzie, amministrazione, AI.
Sono moduli aggiuntivi: ognuno diventa un modulo in `apps/api/src/modules` + una feature in `apps/web/src/app/features`.
