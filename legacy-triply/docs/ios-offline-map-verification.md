# Verifica iOS della cartografia offline

## Stato

**Cartografia offline iOS da verificare su iPhone reale.**

L’implementazione MapLibre nativa e MapTiler è predisposta per iOS e Android. In questo ambiente non è disponibile Xcode con un iPhone collegato, quindi non viene dichiarata verificata la disponibilità offline. Expo Go e il preview Web non sono prove valide per questa verifica.

## Prerequisiti

- Un Mac con Xcode, command-line tools e CocoaPods installati.
- Un iPhone reale collegato via USB o disponibile come device di sviluppo, con Developer Mode attivo.
- Una chiave pubblica MapTiler limitata all’app, configurata come `EXPO_PUBLIC_MAPTILER_KEY`.
- Rete attiva solo per preparare il pacchetto.

## Creare e installare la development build

Da `artifacts/travel-companion` su macOS:

```bash
pnpm ios:prebuild
pnpm ios:device
```

In un ambiente EAS già configurato, usare:

```bash
eas build --profile development --platform ios
```

Installare la development build sull’iPhone. La configurazione Expo registra il config plugin condiviso `@maplibre/maplibre-react-native`; non è presente un’implementazione o una permission specifica solo Android.

Non usare Expo Go per dichiarare verificata la cartografia offline: il modulo nativo MapLibre e il gestore dei pacchetti offline non sono inclusi in Expo Go. La schermata mostra comunque l’itinerario locale e, in assenza di pacchetto, **“Cartografia offline non scaricata”**.

## Download controllato

1. Aprire o creare un viaggio con almeno un nodo geolocalizzato e una tratta.
2. In “Mappa del viaggio”, scegliere **Scarica area limitata**.
3. Prima della conferma controllare:
   - area: **Centro storico di Roma**;
   - bounding box: `12.470,41.896`–`12.492,41.908`;
   - zoom minimo 13 e massimo 16;
   - provider: MapTiler;
   - stima di dimensione e numero di risorse.
4. Premere **Conferma** e verificare la sequenza **Preparazione → Download in corso → Disponibile**.
5. Durante il download premere **Annulla download** e verificare **Annullato**; il viaggio deve restare invariato.
6. Ripetere con rete indisponibile o una chiave MapTiler non valida in ambiente di test e verificare **Errore** con messaggio leggibile e azione **Riprova download**. Non deve risultare disponibile un pacchetto incompleto.
7. Provare un retry: il vecchio pack deve essere eliminato prima della nuova creazione. Se la cancellazione non è verificabile, il retry deve fermarsi senza creare un secondo pack.

Il download è limitato alla sola area di Roma definita nel codice. Nessun pacchetto parte automaticamente all’apertura dell’app, alla modifica del viaggio o al cambio filtro.

## Verifica offline su iPhone

1. Con rete attiva, attendere lo stato **Disponibile**.
2. Chiudere completamente Travel Companion dall’app switcher, non lasciarla solo in background.
3. Disattivare Wi-Fi e dati mobili dall’iPhone. Se il pannello lo rende più chiaro, attivare la modalità aereo dopo avere verificato che sia possibile riattivare il Bluetooth solo se necessario per il device.
4. Riaprire l’app dal launcher.
5. Nella stessa area verificare senza rete:
   - basemap MapTiler dell’area scaricata;
   - marker e nodi del viaggio;
   - tratte visibili e coerenti;
   - filtri della mappa e timeline;
   - selezione di un nodo dalla timeline e relativo dettaglio;
   - attribuzione **© MapTiler © OpenStreetMap contributors**.
6. Verificare che un nodo fuori dal bounding box non venga dichiarato coperto dalla basemap e resti comunque parte dell’itinerario locale.
7. Dalla UI premere **Elimina pacchetto**.
8. Verificare che:
   - il pacchetto sparisca;
   - lo stato torni a **“Cartografia offline non scaricata”**;
   - viaggio, attività, marker, tratte e timeline restino presenti;
   - nessun dato del viaggio venga cancellato.

Riattivare Wi-Fi e dati mobili al termine e chiudere nuovamente l’app per confermare che il ritorno online non modifichi il piano locale.

## Registro del collaudo

Compilare solo dopo il test su iPhone reale:

| Campo | Valore |
| --- | --- |
| Data e ora | Da compilare |
| Modello iPhone / versione iOS | Da compilare |
| Build / commit | Da compilare |
| Area e zoom | Centro storico di Roma, 13–16 |
| Provider e style/versione | MapTiler streets-v2 v1 |
| Stima / dimensione reale | Da compilare |
| Esito progresso e completamento | Da compilare |
| Esito errore e retry | Da compilare |
| Esito annullamento | Da compilare |
| Esito cancellazione senza perdita viaggio | Da compilare |
| Esito riapertura offline | Da compilare |
| Basemap, marker, tratte, timeline | Da compilare |
| Attribuzione visibile | Da compilare |
| Screenshot | Da allegare |
| Errori o note | Da compilare |

Fino alla compilazione positiva del registro, riportare sempre: **“Cartografia offline iOS da verificare su iPhone reale”.**