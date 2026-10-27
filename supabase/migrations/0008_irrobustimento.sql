-- =============================================================================
-- Odys · irrobustimento dopo il controllo di sicurezza di Supabase.
-- Le funzioni dei trigger non devono essere richiamabili dall'API (/rest/v1/rpc).
-- =============================================================================
revoke execute on function public.handle_new_user() from anon, authenticated, public;
