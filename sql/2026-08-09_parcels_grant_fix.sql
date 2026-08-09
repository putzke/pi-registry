-- ═══════════════════════════════════════════════════════════════════════════
-- FIX — pi_parcels / pi_parcel_owners were granted to `anon` only.
--
-- THE BUG
--   sql/2026-08-07_parcels.sql granted the two parcel tables to `anon` and gave
--   them RLS policies `for all to anon`. That is only half the story. The
--   desktop app signs in through Supabase auth, and getAuthHeaders() sends the
--   user's access token instead of the anon key when a session exists — so
--   PostgREST runs those requests as `authenticated`, not `anon`.
--
--   With no grant and no policy for that role, a signed-in consultant reading
--   pi_parcels gets nothing back. The rows are in the database and the client
--   portal (which really is anonymous) shows them, but the Parcels view renders
--   "No parcels on this project yet" — a silent, total failure, because sbGet()
--   turns a failed read into an empty array.
--
--   Every other table in this schema is granted to BOTH roles. The parcels
--   migration was the only one that wasn't, and its own comment warned about
--   the mirror-image mistake (forgetting `anon`) while making this one.
--
-- WHAT THIS DOES
--   Grants the same privileges to `authenticated`, and widens the two policies
--   to cover both roles. Nothing is revoked; the portal keeps working exactly
--   as it does now.
--
-- Idempotent: safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

grant select, insert, update, delete on pi_parcels       to authenticated;
grant select, insert, update, delete on pi_parcel_owners to authenticated;

-- Identity columns draw from sequences; the write path needs them too.
grant usage, select on all sequences in schema public to anon, authenticated;

-- Widen the existing policies rather than adding a second pair, so there is one
-- policy per table to reason about. ALTER POLICY errors if the policy is
-- missing, so create it when this runs against a database that never had it.
do $$
begin
  if exists (select 1 from pg_policies
              where tablename = 'pi_parcels' and policyname = 'pi_parcels_anon_all') then
    alter policy pi_parcels_anon_all on pi_parcels to anon, authenticated;
  else
    create policy pi_parcels_anon_all on pi_parcels
      for all to anon, authenticated using (true) with check (true);
  end if;

  if exists (select 1 from pg_policies
              where tablename = 'pi_parcel_owners' and policyname = 'pi_parcel_owners_anon_all') then
    alter policy pi_parcel_owners_anon_all on pi_parcel_owners to anon, authenticated;
  else
    create policy pi_parcel_owners_anon_all on pi_parcel_owners
      for all to anon, authenticated using (true) with check (true);
  end if;
end $$;

-- Verify: both roles should report true on all four privileges.
--   select r.rolname, p.priv,
--          has_table_privilege(r.rolname, 'pi_parcels', p.priv) parcels,
--          has_table_privilege(r.rolname, 'pi_parcel_owners', p.priv) owners
--     from (values ('anon'),('authenticated')) r(rolname),
--          (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(priv)
--    order by 1, 2;
