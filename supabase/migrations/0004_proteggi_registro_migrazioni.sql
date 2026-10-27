-- =============================================================================
-- Odys · la tabella tecnica delle migrazioni non deve essere raggiungibile
-- dall'API pubblica: RLS attivo senza policy e nessun permesso ai ruoli API.
-- =============================================================================
alter table public.odys_migrations enable row level security;
revoke all on table public.odys_migrations from anon, authenticated;
