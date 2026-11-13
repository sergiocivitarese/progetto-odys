-- =============================================================================
-- Odys · storia dei luoghi (TP-08): per ogni attrazione una descrizione, il
-- testo storico e «la storia in 3 tappe». Solo testo.
--
-- I testi li scrive il coordinatore sul proprio viaggio pubblicato (decisione
-- del 13 novembre 2026); il campo `source` di ogni storia permetterà di
-- distinguere quelli generati quando il cliente sceglierà un fornitore AI.
-- La lettura è un diritto del Traveller Premium (`trips.insights`): il filtro
-- lo applica l'API, che è l'unica a esporre il contenuto ai viaggiatori.
-- =============================================================================
alter table public.published_trips
  add column place_stories jsonb not null default '[]'::jsonb
    check (jsonb_typeof(place_stories) = 'array' and jsonb_array_length(place_stories) <= 30);

comment on column public.published_trips.place_stories is 'Storia dei luoghi: [{ id, day, title, intro, body, milestones: [{ when, text }], source }].';
