-- =============================================================================
-- Odys · feed profilo del coordinatore (CB-09): lingue e badge verificato.
--
-- Le lingue sono quelle dichiarate nella candidatura approvata più recente;
-- «verificato» vuol dire che il coordinatore è passato dalla candidatura
-- (profilo, identità, documenti) e l'amministratore l'ha approvata. Gli
-- ambassador abilitati direttamente dall'amministratore non hanno il badge.
-- Le colonne nuove si aggiungono in coda: la vista resta compatibile.
-- =============================================================================

create or replace view public.coordinator_profiles
with (security_invoker = false)
as
  select
    p.id,
    p.first_name,
    left(p.last_name, 1) as last_initial,
    p.public_headline,
    p.bio,
    p.interests,
    p.avatar_url,
    p.created_at,
    (select round(avg(v.coordinator_rating)::numeric, 1) from public.trip_reviews v join public.published_trips t on t.id = v.published_trip_id where t.coordinator_id = p.id) as rating,
    (select count(*)::integer from public.trip_reviews v join public.published_trips t on t.id = v.published_trip_id where t.coordinator_id = p.id) as reviews_count,
    (select count(*)::integer from public.coordinator_follows f where f.coordinator_id = p.id) as followers,
    (select count(*)::integer from public.published_trips t where t.coordinator_id = p.id and t.status in ('published', 'active', 'completed') and t.end_date < current_date) as trips_completed,
    coalesce((select a.languages from public.coordinator_applications a where a.user_id = p.id and a.status = 'approved' order by a.decided_at desc nulls last, a.created_at desc limit 1), '{}') as languages,
    exists (select 1 from public.coordinator_applications a where a.user_id = p.id and a.status = 'approved') as verified
  from public.profiles p
  where p.role in ('coordinator', 'admin') and p.status = 'active';

grant select on public.coordinator_profiles to anon, authenticated;
