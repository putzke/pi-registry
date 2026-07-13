-- Client Portal — Phase 1: grant access by EMAIL (no pre-invite needed)
--
-- Lets the consultant grant a client a single magic-link login that spans one
-- or more projects, WITHOUT first creating the Supabase Auth user by hand. A
-- grant is keyed by email; when the client logs in via OTP, their JWT email is
-- matched against the grant rows by Row Level Security.
--
-- SAFE / ADDITIVE. Run once in the Supabase SQL Editor.
--
-- Provisioning stays manual for Phase 1 (Option C): the desktop app's
-- Settings > Client Portal Access screen generates the INSERT/DELETE SQL below
-- for you to paste here. The public anon key is NEVER allowed to write grants,
-- so a client can never grant themselves access.

-- ── 1. Schema: add email, allow user_id to be unknown at grant time ──────────
alter table pi_client_access add column if not exists email text;
alter table pi_client_access alter column user_id drop not null;

create index if not exists idx_pi_client_access_email on pi_client_access(lower(email));

-- Idempotent re-grants: one row per (email, project).
do $$ begin
  if not exists (select 1 from pg_constraint where conname='pi_client_access_email_project_uniq') then
    alter table pi_client_access add constraint pi_client_access_email_project_uniq unique (email, project_id);
  end if;
end $$;

-- ── 2. Portal login reads its OWN grants, matched by JWT email ───────────────
-- Replaces the old user_id-based read policy. Case-insensitive.
drop policy if exists "client can read own access grants" on pi_client_access;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='pi_client_access' and policyname='client reads own grants by email') then
    create policy "client reads own grants by email"
      on pi_client_access for select to authenticated
      using (lower(email) = lower(auth.jwt() ->> 'email'));
  end if;
end $$;

-- ── 3. Internal admin UI (anon key) lists all grants so you can manage them ──
-- PHASE-1 TRADEOFF: this exposes client emails + which projects they map to
-- to the anon role, consistent with the app's current permissive model. It is
-- SELECT ONLY — no insert/update/delete is granted to anon, so grants can only
-- be created via service-role SQL (the paste-in step). Tighten this in Phase 3
-- (move the admin read to an authenticated-admin role or an Edge Function).
do $$ begin
  if not exists (select 1 from pg_policies where tablename='pi_client_access' and policyname='admin lists grants (anon)') then
    create policy "admin lists grants (anon)"
      on pi_client_access for select to anon using (true);
  end if;
end $$;
grant select on pi_client_access to anon, authenticated;

-- ── Notes ───────────────────────────────────────────────────────────────────
-- • Reading the actual project data (deliverables, reports, etc.) already works
--   for a logged-in client under the existing permissive policies — so the
--   multi-project login is FUNCTIONAL after this migration. True per-table
--   isolation (scoping each portal table to the client's granted projects) is
--   the separate Phase 3 hardening.
-- • Any earlier grants inserted with only user_id (and no email) will no longer
--   match the email policy — backfill their email column if you need them.
