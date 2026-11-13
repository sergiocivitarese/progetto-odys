-- =============================================================================
-- Odys · nuovi stati della prenotazione (specifiche per ruolo, «Stati di una
-- prenotazione»): Posto riservato → Richiesta inviata → Confermata → Saldata.
--
-- In un file a parte: Postgres non permette di usare un valore appena aggiunto
-- a un enum nella stessa transazione che lo crea.
-- =============================================================================
alter type public.participation_status add value if not exists 'reserved' before 'pending';
alter type public.participation_status add value if not exists 'balance_paid' after 'confirmed';
