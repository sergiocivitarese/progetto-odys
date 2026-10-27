# Triply

Companion di viaggio offline-first costruita con Expo Router. Il piano di viaggio vive sul dispositivo: nessun account, nessuna sincronizzazione cloud e nessun provider esterno obbligatorio.

## Avvio locale

```bash
npm install
npx expo start
```

Premi `w` per aprire la versione Web, oppure scansiona il QR code con Expo Go per iOS/Android.

## Script disponibili

- `npm run typecheck` — verifica TypeScript.
- `npm test` — suite di test Node (`scripts/test-*.mjs`).
- `npm run build` — build statica.
- `npm run serve` — serve la build generata.

## Provider opzionali

Mappa, geocoding, routing e meteo funzionano tramite provider esterni opzionali. Senza chiavi configurate, l'app resta pienamente utilizzabile con fallback locali dichiarati (nessun dato viene inventato o presentato come confermato).

## Struttura

- `app/` — schermate Expo Router.
- `components/` — componenti UI condivisi.
- `lib/` — logica di dominio (itinerario, meteo, mappa, geocoding, trasferimenti).
- `hooks/` — hook React per stato locale e persistenza.
- `constants/` — design tokens Triply.
- `data/` — dati demo dichiarati come tali.
- `scripts/` — build, server statico e suite di test.
