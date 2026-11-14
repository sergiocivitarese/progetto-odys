# Roadmap di Odys

Riferimenti: `docs/riferimenti/odys-requisiti-business-funzionali.docx` (requisiti U-, C-, A-, G-…), `docs/riferimenti/odys-specifiche-per-ruolo.pdf` (28 ottobre 2026: requisiti per ruolo TB-, TP-, CB-, CP-, AG-) e `docs/riferimenti/odys-app-mobile.pdf` (mockup delle schermate).
Si procede a fasi; ogni fase si chiude con una demo funzionante e i test verdi.

| Fase | Contenuto | Requisiti | Stato |
|---|---|---|---|
| 0 | Planner portato da Triply su Angular + Node: itinerario giorno per giorno, modifica, date, budget, alloggio, mappa, meteo, import/export | U-01, U-02, U-06, U-07, C-09, C-11, T-02…T-05, T-08 | ✅ Completata · ottobre: planner semplificato, suggerimenti OpenStreetMap, mappa e percorsi reali |
| 1 | **Account e persistenza**: registrazione con verifica email, maggiore età e consensi; accesso, recupero password; area personale; viaggi su Supabase con storico e ripristino; idee salvate; preferenze; registro attività; eliminazione account | U-08, U-10…U-13, S-01…S-06, C-04, G-06, T-01 | ✅ Completata |
| 2 | **Catalogo e viaggi di gruppo**: viaggi pubblicati, ricerca e ordinamento, dettaglio, salvataggio come idea, "usa come base", **richiesta di partecipazione** con posti disponibili | U-01…U-09, U-14, U-16, U-17, U-21, P-06 | ✅ Completata · il checkout (U-15, U-18) è nella Fase 7 |
| 3 | **Coordinatori**: candidatura online e approvazione dell'amministratore, linee guida versionate, profilo pubblico, offerte con validazioni e stati, **gestione partecipanti** | C-01…C-04, C-06…C-09, C-11…C-15 | ✅ Completata · verifica d'identità e documenti (C-02) da definire (§12) |
| 4 | **Creator Studio**: post foto/video/caroselli, stati DRAFT/SCHEDULED/PUBLISHED/ARCHIVED, bozze private, programmazione con conto alla rovescia, media su Supabase Storage (originale, versione ottimizzata, miniatura), feed Esplora, like e salvataggi, itinerario collegato | C-19…C-29, U-05, U-19…U-21, M-01…M-07, S-02 | ✅ Completata · itinerari a pagamento (P-05) con i pagamenti; nessuna transcodifica video |
| 5 | **Agenzie**: profilo organizzativo, team e permessi, catalogo multi-operatore | A-01…A-06 | Sostituita dal blocco R5 delle specifiche per ruolo |
| 6 | **Amministrazione e moderazione**: candidature, ruoli e stato degli account con registro, segnalazioni su post/viaggi/profili, coda di revisione, rimozione e sospensione | G-01…G-04, G-06, S-07 | ✅ Completata · cruscotto economico (G-05) con i pagamenti |
| 7 | Rinviati su decisione del cliente: **pagamenti** (checkout, commissioni, abbonamenti, payout), **AI** (generazione assistita degli itinerari), **chat di gruppo**, **Split**, **analytics** | U-15, U-18, P-01…P-05, C-05, C-10, C-16…C-18, A-07, A-08, G-05, T-06 | In attesa di decisioni (§12 dell'analisi) |

## Specifiche per ruolo (dal 28 ottobre 2026)
Il cliente ha riorganizzato il prodotto in cinque profili cumulativi. Si lavora sulla webapp esistente, impaginata prima per il mobile; gli ID sono quelli del PDF e vanno usati nei commit.

| Blocco | Contenuto | Requisiti | Stato |
|---|---|---|---|
| R0 | **Fondamenta**: piani e diritti decisi dal server, stile Orbit Route, barra di navigazione per ruolo | TP-10, AG-09 (predisposizione), elementi trasversali | ✅ Fatto · da collaudare |
| R1 | **Traveller Base**: Esplora, ricerca per intento, filtri, affinità, card e dettaglio, acconto (pagamento simulato), Prossimo viaggio, follower e recensioni | TB-01…TB-12 | ✅ Fatto · da collaudare con un account reale |
| R2 | **Traveller Premium**: generatore AI, viaggio salvato con meteo, mappa e storia dei luoghi, Split | TP-01…TP-09 | ✅ Fatto · da collaudare con un account reale (il generatore usa il motore locale, non ancora un modello AI) |
| R3 | **Coordinatore Base**: creazione del viaggio in 4 passi, prezzo con punto di pareggio, visibilità, kit social, feed profilo | CB-01…CB-11 | ✅ Fatto · da collaudare con un account reale: creazione in 4 passi con itinerario dal generatore o da un viaggio salvato e modificabile nell’offerta (CB-02, CB-03), costi e pareggio (CB-04), kit social (CB-06), posti venduti e avvisi (CB-07), feed profilo con badge verificato, lingue, highlight e schede Post · Video · Viaggi · Recensioni in griglia 4:5 (CB-09), invito alle statistiche (CB-11); candidatura, visibilità, partecipanti e post c’erano già |
| R4 | **Coordinatore Premium**: guadagni, indicatori, avvisi, funnel, post che vendono | CP-01…CP-06 | ✅ Fatto · da collaudare con un account reale: pagina Dati (`/dati`, diritto `analytics.coordinator`) con guadagni del periodo e variazione, prenotazioni per settimana, posti venduti, valutazione e follower, saldi da sollecitare e bozze incomplete, viaggi in vendita, funnel e post che vendono; numeri calcolati dagli eventi registrati dal server (migrazione 0019). CP-07 resta in Fase 2 |
| R5 | **Agenzia**: profilo, ruoli interni, catalogo multi-partenza, team, AI per i coordinatori, licenze a scaglioni, modalità ombrello | AG-01…AG-12 | Da fare (sostituisce la vecchia Fase 5) |
| Fase 2 | Chat di gruppo, suggerimenti dai dati | TB-13, CP-07 | Rinviata |

### Punti aperti del cliente e valore provvisorio usato nel codice
| Punto aperto | Valore provvisorio |
|---|---|
| Il limite di 12 include il coordinatore? | No: 12 partecipanti, coordinatore escluso |
| Split anche per i Base invitati? | Solo chi ha il diritto `split.use` (Premium e coordinatori) apre la cassa; i Base del gruppo compaiono nelle quote ma non la vedono |
| Chi scrive la storia dei luoghi | Il coordinatore, nell'editor del viaggio (deciso il 13 novembre 2026); il campo `source` distinguerà i testi generati. **Limite noto**: il Premium è verificato dall'API, ma la colonna `place_stories` è leggibile direttamente dal database da chi conosce la chiave pubblica: va chiusa con permessi di colonna |
| Fornitore AI del generatore | Nessuno: l'itinerario lo prepara il motore locale di Odys (`packages/domain/src/lib/tripGenerator.ts`), con costi indicativi dichiarati come tali |
| Prezzi e durata degli abbonamenti, prova gratuita | Nessun prezzo: il piano lo assegna l'amministratore dalla pagina Account |
| Scaglioni e prezzi delle licenze | Non ancora sviluppato |
| Commissione Odys e come compare nel prezzo | Stima del 10% compresa nella quota (`SERVICE_RATE` in `packages/domain/src/lib/tripPricing.ts`), mostrata solo al coordinatore nei conti del viaggio (CB-04); non viene trattenuta dai pagamenti |
| Algoritmo dell'affinità «X% per te» | Quota degli interessi del viaggio che l'utente condivide (`packages/domain/src/lib/affinity.ts`) |
| Rimborso dell'acconto, richiesta non confermata | Nessun rimborso automatico: il pagamento è simulato |
| Fornitore dei pagamenti | Simulato lato server dietro l'interfaccia `PaymentProvider`, da sostituire con quello reale |
| Regola di attribuzione delle prenotazioni ai post (CP-06) | Ultimo post dell’autore, collegato a quel viaggio, visto da chi prenota nei 30 giorni prima della conferma (`POST_ATTRIBUTION_DAYS`) |
| Compenso del coordinatore nella dashboard (CP-01) | Pagamenti confermati del periodo meno il servizio Odys stimato; i costi del viaggio non sono sottratti |
| «Sollecita» un saldo (CP-03) | Promemoria in app visibile in Prossimo viaggio, al massimo uno ogni 24 ore; nessuna email finché non c’è un fornitore di notifiche |
| Durata della riserva del posto nel checkout | 15 minuti |
| Conferma del pagamento simulato | La chiama il browser di chi paga (`confirm_simulated_payment`): **da togliere** quando arriva il fornitore reale, che conferma solo con il webhook (`confirm_payment`) |

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
