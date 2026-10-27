# Verifica Android della cartografia offline

## Scopo

Questa procedura verifica su un dispositivo Android reale la mappa MapLibre con uno style MapTiler e il relativo pacchetto offline. Non usare Expo Go: non include il modulo nativo MapLibre né il gestore dei pacchetti offline.

Non sono ammessi login, cloud, sincronizzazione tra dispositivi, `tile.openstreetmap.org`, download automatici o aree senza limiti.

## Stato della verifica in questo ambiente

La prova Android reale non è stata eseguita in questa sessione: l’ambiente Replit non espone `adb`, non ha `ANDROID_HOME`/`ANDROID_SDK_ROOT` configurati e non ha un dispositivo Android collegato. Di conseguenza non è stata creata né installata una development build, non è stato scaricato alcun pacchetto e non vengono dichiarati dimensione reale, esito offline o screenshot di collaudo.

I controlli eseguibili localmente sono passati:

- `pnpm run typecheck`;
- `pnpm test` (71 test);
- `pnpm exec expo config --json`, con package `com.travelplanner.app` e plugin `@maplibre/maplibre-react-native`;
- export Web e avvio del preview.

Questi controlli non sostituiscono i passaggi su dispositivo descritti sotto. Il registro resta da compilare esclusivamente dopo un collaudo Android reale.

## Prerequisiti

- Un telefono Android collegato via USB con debug USB attivo.
- Android SDK e `adb` disponibili sulla macchina di build.
- Una chiave pubblica MapTiler limitata all’app, configurata come `EXPO_PUBLIC_MAPTILER_KEY`.
- Rete attiva solo per la fase di download.

## Creare e installare la development build

Da `artifacts/travel-companion`:

```bash
pnpm android:prebuild
pnpm android:device
```

In un ambiente EAS già configurato, l’alternativa è:

```bash
eas build --profile development --platform android
```

Installare l’APK prodotto sul telefono. La configurazione Expo registra il config plugin `@maplibre/maplibre-react-native`; la versione installata richiede Expo 54+, React 19.1+ e React Native 0.80+, già presenti nel progetto.

## Download controllato

1. Aprire un viaggio con almeno un nodo geolocalizzato e una tratta.
2. Nella sezione “Mappa del viaggio”, scegliere **Scarica area limitata**.
3. Verificare il riepilogo prima della conferma:
   - area: **Centro storico di Roma**;
   - bounding box: `12.470,41.896`–`12.492,41.908`;
   - zoom minimo 13 e massimo 16;
   - provider: MapTiler;
   - stima dimensione e numero di risorse.
4. Confermare esplicitamente il download.
5. Verificare i passaggi Preparazione → Download in corso → Disponibile oppure Errore/Annullato.

Il download è per una sola area piccola. Nessun pacchetto viene avviato all’apertura dell’app, alla modifica del viaggio o al cambio di schermata.

## Verifica offline

1. Con la rete attiva, attendere che il pacchetto risulti “Disponibile”.
2. Chiudere completamente l’app:

   ```bash
   adb shell am force-stop com.travelplanner.app
   ```

3. Disabilitare entrambe le connessioni:

   ```bash
   adb shell svc wifi disable
   adb shell svc data disable
   ```

   In alternativa, usare la modalità aereo dal telefono.
4. Riaprire l’app dal launcher.
5. Verificare che siano visibili senza rete:
   - la basemap dell’area scaricata;
   - marker, nodi e tratte del viaggio;
   - selezione dei nodi dalla timeline;
   - `© MapTiler © OpenStreetMap contributors`.
6. Verificare che un nodo fuori dalla bounding box resti nell’itinerario ma non sia dichiarato coperto dalla basemap.
7. Eliminare il pacchetto dalla UI e verificare che il viaggio resti locale e lo stato torni a **“Cartografia offline non scaricata”**.
8. Ripetere con Annulla durante il download e con rete disattivata prima del download. Nessun risultato parziale deve risultare “Disponibile”.

Riattivare le connessioni al termine:

```bash
adb shell svc wifi enable
adb shell svc data enable
```

## Registro del collaudo

Compilare questo blocco solo dopo un test reale:

| Campo | Valore |
| --- | --- |
| Data e ora | Da compilare |
| Dispositivo / Android | Da compilare |
| Build / commit | Da compilare |
| Area e zoom | Centro storico di Roma, 13–16 |
| Provider e style/versione | MapTiler streets-v2 v1 |
| Stima / dimensione reale | Da compilare |
| Esito download online | Da compilare |
| Esito riapertura offline | Da compilare |
| Attribuzione visibile | Da compilare |
| Screenshot | Da allegare |
| Errori o note | Da compilare |

Non dichiarare la cartografia offline disponibile al pubblico finché tutti i passaggi del collaudo Android non sono superati.