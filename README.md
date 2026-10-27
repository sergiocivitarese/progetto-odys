# Odys — Plan. Discover. Experience.

Riscrittura completa del planner **Triply** (Expo/React Native) sulla nuova piattaforma Odys:

| Livello | Tecnologia | Cartella |
|---|---|---|
| Frontend | **Angular 20** (standalone components, signals, lazy loading), responsive mobile + desktop | `apps/web` |
| Backend | **Node.js + Express 5** (TypeScript, moduli per dominio) | `apps/api` |
| Dominio condiviso | TypeScript puro, usato da frontend e backend | `packages/domain` |
| Account e dati | **Supabase** (Auth + Postgres con RLS), schema versionato | `supabase/migrations` |
| Progetto originale | copia intatta di Triply, solo come riferimento (non inclusa nel pacchetto di consegna) | `legacy-triply` |

La logica esistente è stata **portata, non reinventata**: generazione dell'itinerario, tratte, mappa, meteo,
geocoding, riposizionamento, import/export e regole di modifica sono le stesse del progetto Triply
(i 49 test originali che verificavano il codice reale girano ora sul pacchetto `@odys/domain`).

## Avvio rapido

Serve **Node.js 20.19+** (consigliato 22, vedi `.nvmrc`).

```bash
npm install
npm run dev
```

- Frontend: http://localhost:4200
- Backend: http://localhost:3000/api/health

Se sul computer c'è una versione di Node più vecchia, senza installare nulla:

```bash
npx -p node@22 npm run dev
```

### Account e salvataggio (Supabase)

Login, registrazione e viaggi salvati richiedono un progetto Supabase: segui
[docs/supabase-setup.md](docs/supabase-setup.md) (circa 15 minuti, una volta sola), poi crea le tabelle con:

```bash
npx -p node@22 npm run db:migrate
```

Senza Supabase l'app parte lo stesso: si può esplorare e pianificare, ma non accedere né salvare.

### Provider opzionali

Senza nessuna chiave l'app usa servizi gratuiti: Photon (OpenStreetMap) per suggerimenti e posizioni,
OSRM sui server OpenStreetMap per i percorsi, le tile OpenStreetMap per la mappa e Open-Meteo per il meteo.
Sono pensati per un uso moderato: con molto traffico copia `apps/api/.env.example` in `apps/api/.env`
e aggiungi le chiavi (Geoapify, GraphHopper) oppure gli indirizzi di istanze proprie (`PHOTON_URL`, `OSRM_URL`).
Le chiavi restano **solo sul server**: il browser non le vede mai.

## Script

| Comando | Cosa fa |
|---|---|
| `npm run dev` | avvia backend e frontend insieme |
| `npm test` | test del dominio (65) e di database e API (34) |
| `npm run db:migrate` | applica le migrazioni SQL al database Supabase |
| `npm run typecheck` | controllo dei tipi di dominio e API |
| `npm run build` | build di produzione (API + web) |
| `npm run package:source` | crea `../consegna/odys-progetto-sorgente.zip`: il progetto completo e pulito da consegnare |
| `npm run package:demo` | crea `../odys-demo-cliente` e `../consegna/odys-demo-cliente.zip`: demo pronta (doppio clic, serve solo Node.js) con guida per il cliente |

## Dove sono i dati

Account, profili, viaggi (con tutte le versioni), idee salvate, preferenze e registro attività
sono su Supabase: schema e regole di accesso in `supabase/migrations`, descrizione delle tabelle in
[docs/supabase-setup.md](docs/supabase-setup.md). Il backend usa contratti (`TripsRepository`,
`AccountRepository`, `AuthProvider`): i test usano un archivio in memoria con lo stesso comportamento.

## Documentazione

- [Architettura e guida ai blocchi](docs/architettura.md): come è organizzato il codice e come aggiungere o modificare una parte.
- [Design system](docs/design-system.md): palette, tipografia, token, componenti e stati dei dati.
- [Collegare Supabase](docs/supabase-setup.md): account, database, chiavi e configurazione dell'accesso.
- [Roadmap](docs/roadmap.md): fasi dell'analisi funzionale e stato di avanzamento.
- [docs/riferimenti](docs/riferimenti): analisi funzionale (`odys-requisiti-business-funzionali.docx`) e brand board (`odys-brand-board.webp`).
