# Roadmap di Odys

Riferimento: `docs/riferimenti/odys-requisiti-business-funzionali.docx`.
Si procede a fasi; ogni fase si chiude con una demo funzionante e i test verdi.

| Fase | Contenuto | Requisiti | Stato |
|---|---|---|---|
| 0 | Planner portato da Triply su Angular + Node: itinerario giorno per giorno, modifica, date, budget, alloggio, mappa, meteo, import/export | U-01, U-02, U-06, U-07, C-09, C-11, T-02…T-05, T-08 | ✅ Completata · ottobre: planner semplificato, suggerimenti OpenStreetMap, mappa e percorsi reali |
| 1 | **Account e persistenza**: registrazione con verifica email, maggiore età e consensi; accesso, recupero password; area personale; viaggi su Supabase con storico e ripristino; idee salvate; preferenze; registro attività; eliminazione account | U-08, U-10…U-13, S-01…S-06, C-04, G-06, T-01 | ✅ Completata |
| 2 | **Catalogo e viaggi di gruppo**: viaggi pubblicati, ricerca e ordinamento, dettaglio, salvataggio come idea, "usa come base", **richiesta di partecipazione** con posti disponibili | U-01…U-09, U-14, U-16, U-17, U-21, P-06 | ✅ Completata · il checkout (U-15, U-18) è nella Fase 7 |
| 3 | **Coordinatori**: candidatura online e approvazione dell'amministratore, linee guida versionate, profilo pubblico, offerte con validazioni e stati, **gestione partecipanti** | C-01…C-04, C-06…C-09, C-11…C-15 | ✅ Completata · verifica d'identità e documenti (C-02) da definire (§12) |
| 4 | **Creator Studio**: post foto/video/caroselli, stati DRAFT/SCHEDULED/PUBLISHED/ARCHIVED, bozze private, programmazione con conto alla rovescia, media su Supabase Storage (originale, versione ottimizzata, miniatura), feed Esplora, like e salvataggi, itinerario collegato | C-19…C-29, U-05, U-19…U-21, M-01…M-07, S-02 | ✅ Completata · itinerari a pagamento (P-05) con i pagamenti; nessuna transcodifica video |
| 5 | **Agenzie**: profilo organizzativo, team e permessi, catalogo multi-operatore | A-01…A-06 | Da fare |
| 6 | **Amministrazione e moderazione**: candidature, ruoli e stato degli account con registro, segnalazioni su post/viaggi/profili, coda di revisione, rimozione e sospensione | G-01…G-04, G-06, S-07 | ✅ Completata · cruscotto economico (G-05) con i pagamenti |
| 7 | Rinviati su decisione del cliente: **pagamenti** (checkout, commissioni, abbonamenti, payout), **AI** (generazione assistita degli itinerari), **chat di gruppo**, **Split**, **analytics** | U-15, U-18, P-01…P-05, C-05, C-10, C-16…C-18, A-07, A-08, G-05, T-06 | In attesa di decisioni (§12 dell'analisi) |

## Dove siamo arrivati (27 ottobre 2026)
- Supabase "Odys" (Europa): migrazioni 0001–0008 applicate. Il progetto gratuito va in pausa dopo giorni senza attività: se login e catalogo smettono di funzionare, riattivarlo dalla dashboard.
- Codice su GitHub (`sergiocivitarese/progetto-odys`), un commit per ogni blocco di lavoro.
- Servizi esterni gratuiti senza chiavi: Photon e OSRM su OpenStreetMap, tile OpenStreetMap, Open-Meteo (dettagli in `apps/api/.env.example`).
- **Da collaudare con un account reale**: richiesta di partecipazione, candidatura e approvazione, Creator Studio (caricamento media), segnalazioni e pagine dell'amministratore. Per l'amministrazione serve un account con ruolo `admin` (dalla dashboard o dalla pagina Account di un altro amministratore).

## Note sulla Fase 4 e 6
- I media si caricano dal browser direttamente nell'archivio privato `creator-media`, nella cartella `<autore>/<post>/<media>/`; il server assegna i percorsi e restituisce solo URL firmati a scadenza. Le foto vengono ottimizzate nel browser (versione da 1440 px e miniatura quadrata 480 px, WebP); i video restano originali (massimo 60 secondi e 100 MB).
- Un post programmato diventa visibile all'ora indicata senza processi esterni (come i viaggi pubblicati).
- Una decisione su una segnalazione chiude tutte le segnalazioni aperte sullo stesso contenuto ed entra nel registro attività; chi segnala non vede la nota interna.

## Note sulla Fase 2–3
- I viaggi pubblicati sono una copia dell'itinerario del coordinatore: "Aggiorna dal mio viaggio" riallinea l'offerta all'ultima versione.
- Lo stato "in corso" e "concluso" deriva dalle date: nessun processo in background da gestire. Anche la pubblicazione programmata diventa visibile all'ora indicata senza processi esterni.
- "Salva idea" crea un segnalibro (l'idea resta del coordinatore e si aggiorna con lui); "Usa come base" crea una copia tra i viaggi dell'utente, registrata nello storico come "copied".
- Il profilo pubblico mostra solo nome, iniziale del cognome, frase di presentazione, bio e interessi (vista `coordinator_profiles`).

## Note sulla Fase 1
- I viaggi salvati vivono ora nell'account (Supabase) e non più in un file locale.
- Ogni salvataggio crea una versione; meteo, arricchimenti automatici e avanzamento del viaggio aggiornano il piano senza riempire lo storico.
- `trip_activities` contiene una riga per ogni attività (destinazione, città, categoria, orario, luogo, coordinate, completamento): è la base dati pensata per i suggerimenti con l'AI della Fase 7.
- Il login non è richiesto per esplorare e pianificare (U-10): viene chiesto solo per salvare, e dopo l'accesso l'utente torna esattamente dov'era (U-11).
