-- Client Portal Access — let a real staff session grant/revoke directly from
-- the app, instead of the desktop panel only generating copy-paste SQL.
--
-- WHY THIS WAS BLOCKED UNTIL NOW
--   pi_client_access has only ever granted SELECT to `authenticated` (see
--   sql/2026-07-13_client_access_by_email.sql) — never INSERT or DELETE.
--   That wasn't an oversight: `authenticated` is shared between real staff
--   logins (index.html/mobile.html) and OTP-logged-in portal clients, with
--   no way to tell them apart. Opening write access to that ROLE, before
--   now, would have let a client grant themselves access to any other
--   project too — the exact self-grant hole
--   sql/2026-07-04_portal_links.sql's own comment on pi_portal_links warns
--   about ("Letting that role mint or revoke links would let anyone with
--   one URL manufacture others").
--
-- WHAT CHANGED
--   sql/2026-08-31_portal_client_isolation.sql added pi_is_portal_client(),
--   which tells the database whether the CURRENT authenticated session is a
--   real staff login or a portal client (by JWT email against this very
--   table). That makes it safe to open write access narrowly: a client
--   session's own pi_is_portal_client() is true, so `with check
--   (not pi_is_portal_client())` rejects their insert/delete outright,
--   regardless of which project_id they try. A staff session's is false, so
--   theirs succeeds.
--
-- WHY INSERT + DELETE, NOT UPDATE
--   A grant is an (email, project_id) pair under
--   pi_client_access_email_project_uniq — access changes are add-a-row /
--   remove-a-row, never an edit of an existing row's email or project. The
--   desktop panel's "reconcile to exactly these checked projects" flow is
--   built from exactly those two primitives.
--
-- The anon SELECT policy (the separately documented Phase-1 trade-off,
-- test/tests/17-grants.test.js's ALLOWED map, letting the desktop admin UI
-- list every grant via the anon key) is UNCHANGED and deliberately
-- untouched here.
--
-- The authenticated SELECT policy is NOT left alone, and this is the part
-- that isn't obvious. sql/2026-07-13_client_access_by_email.sql's
-- "client reads own grants by email" policy scopes to
-- `lower(email) = lower(auth.jwt() ->> 'email')` — correct for a client
-- reading their OWN grant, but for DELETE/UPDATE, PostgreSQL requires a row
-- to also pass an applicable SELECT policy before the command's own USING
-- clause is even consulted (documented Postgres RLS behavior: a row must be
-- "visible" to be updated or deleted). Staff's own email never matches any
-- grant row, so that SELECT policy ANDs into every staff DELETE and zeroes
-- it out — verified live with EXPLAIN ANALYZE before shipping this: the
-- delete reports success (no error, 0 rows affected) but silently removes
-- nothing. A DELETE-only policy on this table can never work without also
-- widening staff's SELECT visibility, so this migration adds that too —
-- OR'd with the existing client_own policy, so a client session (whose own
-- pi_is_portal_client() is true) gets no additional visibility from it at
-- all; only a real staff session sees every row.
--
-- Idempotent — safe to run more than once.

drop policy if exists pi_client_access_staff_select on pi_client_access;
create policy pi_client_access_staff_select on pi_client_access
  for select to authenticated
  using (not pi_is_portal_client());

drop policy if exists pi_client_access_staff_insert on pi_client_access;
create policy pi_client_access_staff_insert on pi_client_access
  for insert to authenticated
  with check (not pi_is_portal_client());

drop policy if exists pi_client_access_staff_delete on pi_client_access;
create policy pi_client_access_staff_delete on pi_client_access
  for delete to authenticated
  using (not pi_is_portal_client());

grant insert, delete on pi_client_access to authenticated;

-- ── Verify (run after) ───────────────────────────────────────────────────────
--   select has_table_privilege('authenticated','pi_client_access','INSERT') ins,
--          has_table_privilege('authenticated','pi_client_access','DELETE') del;
-- Both should read true. anon should show false for both (unchanged, not
-- granted here) — has_table_privilege('anon','pi_client_access','INSERT') and
-- ('DELETE') should still be false.
