-- FIX: "permission denied for table pi_client_summaries" in the client portal.
--
-- Cause: sql/2026-07-05_client_summaries.sql created the table and its RLS
-- policies but omitted the table-level GRANTs to the anon role. In Postgres
-- the GRANT (privilege) gate is checked BEFORE row-level security, so a missing
-- GRANT produces "permission denied for table ..." regardless of the policies.
-- Every other portal table (see 2026-07-04_portal_links.sql) has explicit
-- `grant ... to anon;` lines; this table was missed.
--
-- This script is idempotent — safe to run multiple times. Run it in the
-- Supabase SQL Editor (Project > SQL Editor > New query).

-- Ensure RLS is on (no-op if already enabled).
alter table pi_client_summaries enable row level security;

-- Recreate the four policies only if missing (create policy has no IF NOT EXISTS,
-- so guard each with a catalog check to keep this re-runnable).
do $$ begin
  if not exists (select 1 from pg_policies where tablename='pi_client_summaries' and policyname='anon read pi_client_summaries') then
    create policy "anon read pi_client_summaries"   on pi_client_summaries for select using (true);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='pi_client_summaries' and policyname='anon insert pi_client_summaries') then
    create policy "anon insert pi_client_summaries" on pi_client_summaries for insert with check (true);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='pi_client_summaries' and policyname='anon update pi_client_summaries') then
    create policy "anon update pi_client_summaries" on pi_client_summaries for update using (true);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='pi_client_summaries' and policyname='anon delete pi_client_summaries') then
    create policy "anon delete pi_client_summaries" on pi_client_summaries for delete using (true);
  end if;
end $$;

-- ── The actual fix: the missing table-level privileges ──────────────────────
-- anon  = the public client portal (read) AND the internal PM app, which also
--         uses the anon key to publish summaries (insert/update).
-- authenticated = magic-link client logins (read).
grant select, insert, update, delete on pi_client_summaries to anon;
grant select, insert, update, delete on pi_client_summaries to authenticated;

-- NOTE (security): this matches the app's existing permissive model, where the
-- anon key has broad read/write across pi_ tables and the portal token is
-- validated client-side. Tightening this to server-side, token-scoped access
-- (so a tokenholder for project A cannot read project B) is a separate, larger
-- hardening task tracked for the multi-tenant / RLS work — not addressed here.
