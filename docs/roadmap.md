# Roadmap di Odys

Riferimento: `docs/riferimenti/odys-requisiti-business-funzionali.docx`.
Si procede a fasi; ogni fase si chiude con una demo funzionante e i test verdi.

| Fase | Contenuto | Requisiti | Stato |
|---|---|---|---|
| 0 | Planner portato da Triply su Angular + Node: itinerario giorno per giorno, modifica, date, budget, alloggio, mappa, meteo, import/export | U-01, U-02, U-06, U-07, C-09, C-11, T-02…T-05, T-08 | ✅ Completata |
| **1** | **Account e persistenza**: registrazione con verifica email, maggiore età e consensi; accesso, recupero password; area personale; viaggi su Supabase con storico delle versioni e ripristino; attività strutturate per l'AI; idee salvate; preferenze; registro attività; eliminazione account | U-08, U-10…U-13, S-01…S-06, C-04, G-06, T-01 | ✅ Completata e collegata a Supabase |
| 2 | **Catalogo e viaggi di gruppo reali**: viaggi pubblicati dai coordinatori, ricerca e ordinamento, pagina dettaglio (date, quota, posti, incluso/escluso, itinerario giorno per giorno), salvataggio come idea, "usa come base" | U-01…U-09, U-17, U-21, P-06 | ✅ Completata · resta la **richiesta di partecipazione** (U-14, U-16), che dipende dai pagamenti |
| 3 | **Coordinatori**: ruolo attivato dall'amministratore, linee guida accettate e versionate, profilo pubblico, creazione dell'offerta da un itinerario con validazioni, stati bozza/programmato/pubblicato/in corso/concluso/annullato/archiviato | C-01 (parziale), C-03, C-04, C-06…C-09, C-12…C-14 | 🟡 In corso · mancano candidatura online (C-01, C-02), gestione partecipanti (C-15) |
| 4 | **Creator Studio**: post foto/video/caroselli, stati DRAFT/SCHEDULED/PUBLISHED, programmazione, media su Supabase Storage con versioni ottimizzate, feed pubblico, like e salvataggi | C-19…C-29, U-05, U-19…U-21, M-01…M-07 | Da fare |
| 5 | **Agenzie**: profilo organizzativo, team e permessi, catalogo multi-operatore | A-01…A-06 | Da fare |
| 6 | **Amministrazione e moderazione**: candidature, ruoli e stati degli account, segnalazioni, code di revisione | G-01…G-06, S-07 | Da fare |
| 7 | Rinviati su decisione del cliente: **pagamenti** (checkout, commissioni, abbonamenti, payout), **AI** (generazione assistita degli itinerari), **chat di gruppo**, **Split**, **analytics** | U-15, U-18, P-01…P-06, C-05, C-10, C-16…C-18, A-07, A-08, T-06 | In attesa di decisioni (§12 dell'analisi) |

## Dove siamo arrivati (4 ottobre 2026)
- Supabase collegato e configurato (progetto "Odys", Europa); migrazioni 0001–0004 applicate.
- Primo account creato e confermato; un viaggio salvato con storico (3 versioni) e attività strutturate.
- L'account di Sergio è stato promosso a **coordinatore** dalla dashboard.
- **Prossimo passo del collaudo**: dall'area coordinatore accettare le linee guida, creare e pubblicare un viaggio da "Portogallo2", poi con un secondo account verificare in "Viaggi di gruppo" il salvataggio come idea e "Usa come base".

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
