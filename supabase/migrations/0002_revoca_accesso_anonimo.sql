-- =============================================================================
-- Odys · difesa in profondità: i visitatori non autenticati (ruolo `anon`)
-- non hanno alcun permesso sulle tabelle dell'account. Le regole RLS restano;
-- questa revoca evita che un errore futuro in una policy esponga dati.
-- =============================================================================
revoke all on table
  public.profiles,
  public.consents,
  public.user_preferences,
  public.trips,
  public.trip_versions,
  public.trip_activities,
  public.saved_group_trips,
  public.audit_log,
  public.geocode_cache
from anon;

revoke execute on function public.save_trip(uuid, text, jsonb, text, text, text, boolean) from anon, public;
grant execute on function public.save_trip(uuid, text, jsonb, text, text, text, boolean) to authenticated;
