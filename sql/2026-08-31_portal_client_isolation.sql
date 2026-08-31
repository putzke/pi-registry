-- ═══════════════════════════════════════════════════════════════════════════
-- Real server-side isolation for the PI Client Portal (both access paths)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- THE GAP THIS CLOSES
--   RLS on every portal-facing table has been "permissive" in the specific
--   sense CLAUDE.md's security note already flagged — but the audit behind
--   this migration found it is worse than "unscoped," on both paths:
--
--   1. TOKEN PATH (pi_portal_links, anon role). pi_parcels and
--      pi_parcel_owners carry `for all to anon, authenticated using (true)
--      with check (true)` — anon can read AND WRITE any project's parcel
--      data. pi_client_summaries has the same shape. pi_report_archive's
--      existing anon_portal_read policy scopes by project but never checks
--      client_visible, so a raw REST call that skips the app's own
--      `client_visible=eq.true` filter reads every archived report,
--      shared or not.
--
--   2. EMAIL-GRANT PATH (pi_client_access, authenticated role). The ONE
--      piece of real per-table scoping that predates this migration —
--      pi_deliverables' "client viewer can read own project deliverables"
--      policy from sql/2026-07-02_client_portal_step1.sql — matches on
--      `user_id = auth.uid()`. sql/2026-07-13_client_access_by_email.sql
--      switched grant provisioning to email-only and never backfills
--      user_id, so that column has been NULL on every grant created since.
--      The policy has matched nothing since Phase 1 shipped. Today, an
--      OTP-logged-in client's isolation is enforced by NOTHING but
--      client-portal.html's own client-side query filters.
--
--   The reason (2) can't be fixed by just adding a scoped policy: an
--   OTP-logged-in client and a signed-in staff member both land on the SAME
--   Postgres role, `authenticated` (index.html/mobile.html always require
--   login — DEV_BYPASS is false — so `authenticated` already means "some
--   real Supabase Auth session", staff or client, nothing else). RLS
--   policies are OR'd together and can only ever grant MORE access, never
--   less — so a table that already has a blanket `for ... to authenticated
--   using (true)` policy (which staff need) stays fully open to a client's
--   JWT no matter how carefully a second, scoped policy is written on top.
--   The blanket policy itself has to be rewritten to exclude a client
--   session, which requires a way to tell the two apart.
--
-- THE MECHANISM: pi_is_portal_client()
--   No new auth-side tagging is needed — pi_client_access.email already IS
--   the client roster. The function below is true iff the caller's JWT
--   email exists in pi_client_access. Staff policies become
--   `using (not pi_is_portal_client())`; the new client policies become
--   `using (pi_is_portal_client() and project_id in (their granted
--   projects))`. SECURITY DEFINER so it works regardless of
--   pi_client_access's own RLS; STABLE so the planner evaluates it once per
--   statement, not once per row.
--
--   ── Operational caveat, read this before granting portal access ──
--   Never insert a pi_client_access row under a STAFF member's own login
--   email. pi_is_portal_client() would then be true for their session, and
--   every blanket "staff" policy below (`not pi_is_portal_client()`) would
--   stop applying to their own account — silently downgrading them to the
--   scoped client view on every table. Use a separate email, or the token
--   link, to preview the client experience.
--
-- WHAT THIS DOES, PER TABLE (pi_projects, pi_deliverables, pi_issues,
-- pi_commitments, pi_comment_periods, pi_public_comments, pi_meetings,
-- pi_interactions, pi_parcels, pi_parcel_owners, pi_client_summaries,
-- pi_report_archive):
--   1. Ensure RLS is enabled.
--   2. Dynamically drop any existing policy on that table, for anon or
--      authenticated, whose condition is a bare `true` — by inspecting
--      pg_policies rather than guessing today's actual policy names (some
--      of these tables were created via the Supabase dashboard, which this
--      repo's SQL files never saw). This is deliberately narrow: it only
--      removes unconditional-access policies, so anything already scoped
--      (like the existing anon_portal_read policies) is left untouched.
--   3. Recreate three named policies:
--        <table>_staff_all         — authenticated, not a portal client: full
--                                     CRUD, unchanged from today's behavior.
--        <table>_anon_portal_read  — anon, SELECT only, scoped to
--                                     pi_portal_links (unauthenticated token
--                                     path).
--        <table>_client_portal_read — authenticated AND a portal client,
--                                     SELECT only, scoped to pi_client_access
--                                     by JWT email (magic-link path).
--   4. Revoke INSERT/UPDATE/DELETE from anon. client-portal.html never
--      writes to any pi_* table (verified: its only POSTs are to
--      /auth/v1/otp and /auth/v1/token, never /rest/v1/) and index.html /
--      mobile.html always authenticate before touching data, so nothing
--      legitimate relies on anon write access on these tables.
--
-- pi_tribal_consultations gets staff-only access, full stop — no anon or
-- client policy at all. It already had an anon_portal_read policy from
-- sql/2026-07-04_portal_links.sql, but the table is not on the portal's NAV
-- (client-portal.html's renderTribal() exists but nothing calls it — same
-- "parked" shape as index.html's own hidden tribal view) and tribal
-- consultation is a government-to-government process CLAUDE.md already
-- treats as too sensitive for a half-validated surface. Removing its portal
-- exposure here matches that decision rather than leaving a raw-REST path
-- to it that the UI was already deliberately built to avoid.
--
-- OUT OF SCOPE, DELIBERATELY:
--   * pi_stakeholders, pi_groups, and other tables the portal never reads
--     are untouched — hardening those is the broader anon/multi-tenant
--     project CLAUDE.md describes, not this one.
--   * pi_client_access's "admin lists grants (anon)" policy (an accepted,
--     already-documented Phase-1 trade-off letting the desktop admin UI list
--     every grant) is left exactly as it is. pi_portal_links itself is NOT
--     left alone — see the dedicated section below for why its anon SELECT
--     had to go entirely, not just be scoped.
--   * This does not add column-level curation. RLS gates ROWS, not
--     COLUMNS — a portal client with access to their own project's
--     pi_projects row still gets every column PostgREST is asked for, same
--     as the token path already behaves today. If any of these tables ever
--     carry an internal-only column that shouldn't reach the client even
--     for their own project, that needs a view, which is a separate
--     decision.
--
-- Idempotent — safe to run more than once. Run in the Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The role-distinguishing function ─────────────────────────────────────────
create or replace function pi_is_portal_client()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from pi_client_access
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

grant execute on function pi_is_portal_client() to anon, authenticated;

-- ── pi_portal_links was directly listable by anon — the actual credential,
-- not just the projects behind it ───────────────────────────────────────────
-- sql/2026-07-04_portal_links.sql's own anon_select policy is `for select to
-- anon using (true)` — no filter at all. Its comment says "UUID is
-- unguessable; token validated client-side", but that reasoning only holds if
-- a caller has to GUESS the UUID. A bare `using (true)` SELECT policy doesn't
-- require one: `select token, project_id from pi_portal_links` with no WHERE
-- clause returns the FULL table to anyone holding the public anon key — every
-- project's real token, not a guess at all. Confirmed live in this
-- migration's own verification harness before this fix. This is more severe
-- than anything else in this file: the other tables' anon_portal_read
-- policies at least require the CALLER to already know a project's row
-- exists; this one hands out the credential itself.
--
-- Fix: anon can no longer SELECT pi_portal_links directly. Two SECURITY
-- DEFINER functions replace that access with exactly what's legitimate:
--   pi_resolve_portal_token(uuid) — the one lookup bootFromToken() actually
--     needs (token in, project_id out, or null). Learning the mapping for
--     ONE token you already hold is fine; listing all of them isn't.
--   pi_portal_project_ids() — lets the other tables' policies keep scoping
--     by "does this project have an active link" without querying
--     pi_portal_links directly (which anon can no longer do at all — a plain
--     USING clause subquery runs under the CALLING role's own grants, so
--     revoking anon's SELECT here would otherwise break every other table's
--     anon_portal_read policy, not just tighten this one).
--
-- ── A gap this does NOT close, and can't from here — read before assuming
-- "server-side isolation" is complete for the token path ──────────────────
-- pi_portal_project_ids() preserves the SAME scoping the other tables already
-- had: "this project has SOME active portal link", not "the caller proved
-- possession of THIS project's specific token." A raw REST call scoped to a
-- project_id the caller never received a link for, but which happens to have
-- ANY client using the portal, still passes RLS today. Closing that
-- requires the caller's held token to be checked on every single request —
-- e.g. client-portal.html sending it as a custom header PostgREST exposes to
-- RLS via the `request.headers` GUC (a real, documented PostgREST mechanism,
-- not proposed here from guesswork), with every anon policy in this file
-- comparing against `pi_resolve_portal_token` on that header value instead of
-- the current "any linked project" check. It is NOT implemented in this
-- migration because it cannot be verified from this sandbox: this
-- environment cannot reach the live Supabase project, so there is no way to
-- confirm here that Supabase's Kong/PostgREST layer actually forwards a
-- custom header through to that GUC before shipping a security control that
-- depends on it — this codebase has already shipped one integration wrong
-- once from search-result confidence instead of a live check (see the UGRC
-- endpoint story in CLAUDE.md) and this is the same mistake shape. Project
-- ids are small sequential integers, so this residual gap is closeable by
-- guessing/enumeration, not just by holding a leaked token. Verify the
-- header GUC live, then extend every anon_portal_read policy below —
-- treat this as the next task on this project, not a someday item.
create or replace function pi_resolve_portal_token(t uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select project_id from pi_portal_links where token = t;
$$;

create or replace function pi_portal_project_ids()
returns table(project_id text)
language sql
stable
security definer
set search_path = public
as $$
  select project_id::text from pi_portal_links;
$$;

grant execute on function pi_resolve_portal_token(uuid) to anon, authenticated;
grant execute on function pi_portal_project_ids() to anon, authenticated;

drop policy if exists "anon_select" on pi_portal_links;
revoke select on pi_portal_links from anon;

-- ── Shared helper: drop any unconditional-access policy on a table ──────────
-- Matches a bare `using (true)` and/or `with check (true)` for anon or
-- authenticated, by whatever name it currently has. Leaves any already-scoped
-- policy alone.
create or replace function _pi_drop_blanket_policies(tbl regclass)
returns void
language plpgsql
as $$
declare
  rec record;
begin
  for rec in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = tbl::text
      and (qual = 'true' or with_check = 'true')
      and (roles @> array['anon']::name[] or roles @> array['authenticated']::name[])
  loop
    execute format('drop policy %I on %s', rec.policyname, tbl);
  end loop;
end;
$$;

-- ── pi_projects (scoped column: id) ──────────────────────────────────────────
alter table pi_projects enable row level security;
select _pi_drop_blanket_policies('pi_projects');

drop policy if exists "anon_portal_read" on pi_projects;
drop policy if exists pi_projects_staff_all on pi_projects;
drop policy if exists pi_projects_client_portal_read on pi_projects;

create policy pi_projects_staff_all on pi_projects
  for all to authenticated
  using (not pi_is_portal_client())
  with check (not pi_is_portal_client());

create policy "anon_portal_read" on pi_projects
  for select to anon
  using (id::text in (select project_id from pi_portal_project_ids()));

create policy pi_projects_client_portal_read on pi_projects
  for select to authenticated
  using (
    pi_is_portal_client()
    and id::text in (
      select project_id::text from pi_client_access
      where lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

revoke insert, update, delete on pi_projects from anon;

-- ── Tables scoped by project_id, one anon + one client policy each ──────────
-- pi_parcels is deliberately NOT in this loop even though it fits the same
-- shape: it is the one table here a migration actually CREATED (see
-- sql/2026-08-07_parcels.sql), so it is the one whose grants and policies
-- test/tests/17-grants.test.js statically parses out of the SQL text. That
-- test can only ever see literal `grant`/`revoke`/`create policy` statements,
-- not ones assembled at runtime inside `execute format(...)` — so pi_parcels
-- gets its own literal block below, right after this loop, in the same shape
-- pi_parcel_owners already uses. The other seven tables were never created by
-- a migration (dashboard-created, per CLAUDE.md's "GRANT BOTH ROLES" note),
-- so they're out of that test's scope regardless of how this is written, and
-- the loop keeps them from being eight nearly-identical hand-copied blocks.
do $$
declare
  tbl text;
  tables text[] := array[
    'pi_deliverables', 'pi_issues', 'pi_commitments', 'pi_comment_periods',
    'pi_public_comments', 'pi_meetings', 'pi_interactions'
  ];
begin
  foreach tbl in array tables loop
    execute format('alter table %I enable row level security', tbl);
    perform _pi_drop_blanket_policies(tbl);

    execute format('drop policy if exists "anon_portal_read" on %I', tbl);
    execute format('drop policy if exists %I on %I', tbl || '_staff_all', tbl);
    execute format('drop policy if exists %I on %I', tbl || '_client_portal_read', tbl);
    -- The one dead policy from step1 that predates this table list generally
    -- (only ever existed on pi_deliverables, but IF EXISTS makes this safe
    -- to run unconditionally for every table in the loop).
    execute format('drop policy if exists "client viewer can read own project deliverables" on %I', tbl);

    execute format(
      'create policy %I on %I for all to authenticated using (not pi_is_portal_client()) with check (not pi_is_portal_client())',
      tbl || '_staff_all', tbl
    );

    execute format(
      'create policy "anon_portal_read" on %I for select to anon using (project_id::text in (select project_id from pi_portal_project_ids()))',
      tbl
    );

    execute format(
      'create policy %I on %I for select to authenticated using (pi_is_portal_client() and project_id::text in (select project_id::text from pi_client_access where lower(email) = lower(auth.jwt() ->> ''email'')))',
      tbl || '_client_portal_read', tbl
    );

    execute format('revoke insert, update, delete on %I from anon', tbl);
  end loop;
end $$;

-- ── pi_parcels (same shape as the loop above, written literally — see the
-- comment above the loop for why) ────────────────────────────────────────────
alter table pi_parcels enable row level security;
select _pi_drop_blanket_policies('pi_parcels');

drop policy if exists pi_parcels_anon_all on pi_parcels;
drop policy if exists "anon_portal_read" on pi_parcels;
drop policy if exists pi_parcels_staff_all on pi_parcels;
drop policy if exists pi_parcels_client_portal_read on pi_parcels;

create policy pi_parcels_staff_all on pi_parcels
  for all to authenticated
  using (not pi_is_portal_client())
  with check (not pi_is_portal_client());

create policy "anon_portal_read" on pi_parcels
  for select to anon
  using (project_id::text in (select project_id from pi_portal_project_ids()));

create policy pi_parcels_client_portal_read on pi_parcels
  for select to authenticated
  using (
    pi_is_portal_client()
    and project_id::text in (
      select project_id::text from pi_client_access
      where lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

revoke insert, update, delete on pi_parcels from anon;

-- ── pi_parcel_owners (no project_id column — joins through pi_parcels) ──────
alter table pi_parcel_owners enable row level security;
select _pi_drop_blanket_policies('pi_parcel_owners');

drop policy if exists pi_parcel_owners_anon_all on pi_parcel_owners;
drop policy if exists pi_parcel_owners_staff_all on pi_parcel_owners;
drop policy if exists pi_parcel_owners_anon_portal_read on pi_parcel_owners;
drop policy if exists pi_parcel_owners_client_portal_read on pi_parcel_owners;

create policy pi_parcel_owners_staff_all on pi_parcel_owners
  for all to authenticated
  using (not pi_is_portal_client())
  with check (not pi_is_portal_client());

create policy pi_parcel_owners_anon_portal_read on pi_parcel_owners
  for select to anon
  using (
    exists (
      select 1 from pi_parcels p
      where p.id::text = pi_parcel_owners.parcel_id::text
        and p.project_id::text in (select project_id from pi_portal_project_ids())
    )
  );

create policy pi_parcel_owners_client_portal_read on pi_parcel_owners
  for select to authenticated
  using (
    pi_is_portal_client()
    and exists (
      select 1 from pi_parcels p
      where p.id::text = pi_parcel_owners.parcel_id::text
        and p.project_id::text in (
          select project_id::text from pi_client_access
          where lower(email) = lower(auth.jwt() ->> 'email')
        )
    )
  );

revoke insert, update, delete on pi_parcel_owners from anon;

-- ── pi_client_summaries (every row is a deliberately-published narrative —
-- no draft state lives here, see CLAUDE.md, so project scoping alone is
-- the whole rule) ────────────────────────────────────────────────────────────
alter table pi_client_summaries enable row level security;
select _pi_drop_blanket_policies('pi_client_summaries');

drop policy if exists "anon read pi_client_summaries" on pi_client_summaries;
drop policy if exists "anon insert pi_client_summaries" on pi_client_summaries;
drop policy if exists "anon update pi_client_summaries" on pi_client_summaries;
drop policy if exists "anon delete pi_client_summaries" on pi_client_summaries;
drop policy if exists pi_client_summaries_staff_all on pi_client_summaries;
drop policy if exists "anon_portal_read" on pi_client_summaries;
drop policy if exists pi_client_summaries_client_portal_read on pi_client_summaries;

create policy pi_client_summaries_staff_all on pi_client_summaries
  for all to authenticated
  using (not pi_is_portal_client())
  with check (not pi_is_portal_client());

create policy "anon_portal_read" on pi_client_summaries
  for select to anon
  using (project_id::text in (select project_id from pi_portal_project_ids()));

create policy pi_client_summaries_client_portal_read on pi_client_summaries
  for select to authenticated
  using (
    pi_is_portal_client()
    and project_id::text in (
      select project_id::text from pi_client_access
      where lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

revoke insert, update, delete on pi_client_summaries from anon;

-- ── pi_report_archive (project scoping AND client_visible — the anon policy
-- already existed but never checked client_visible, so a raw REST call that
-- skips the app's own `client_visible=eq.true` filter could read every
-- archived report for a project, shared or not) ─────────────────────────────
alter table pi_report_archive enable row level security;
select _pi_drop_blanket_policies('pi_report_archive');

drop policy if exists "anon_portal_read" on pi_report_archive;
drop policy if exists pi_report_archive_staff_all on pi_report_archive;
drop policy if exists pi_report_archive_client_portal_read on pi_report_archive;

create policy pi_report_archive_staff_all on pi_report_archive
  for all to authenticated
  using (not pi_is_portal_client())
  with check (not pi_is_portal_client());

create policy "anon_portal_read" on pi_report_archive
  for select to anon
  using (
    client_visible = true
    and project_id::text in (select project_id from pi_portal_project_ids())
  );

create policy pi_report_archive_client_portal_read on pi_report_archive
  for select to authenticated
  using (
    pi_is_portal_client()
    and client_visible = true
    and project_id::text in (
      select project_id::text from pi_client_access
      where lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

revoke insert, update, delete on pi_report_archive from anon;

-- ── pi_tribal_consultations — staff only, no portal exposure at all ─────────
alter table pi_tribal_consultations enable row level security;
select _pi_drop_blanket_policies('pi_tribal_consultations');

drop policy if exists "anon_portal_read" on pi_tribal_consultations;
drop policy if exists pi_tribal_consultations_staff_all on pi_tribal_consultations;

create policy pi_tribal_consultations_staff_all on pi_tribal_consultations
  for all to authenticated
  using (not pi_is_portal_client())
  with check (not pi_is_portal_client());

revoke select, insert, update, delete on pi_tribal_consultations from anon;

drop function _pi_drop_blanket_policies(regclass);

-- ── Verify (run after, in the SQL Editor) ────────────────────────────────────
--   select tablename, policyname, roles, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in (
--       'pi_projects','pi_deliverables','pi_issues','pi_commitments',
--       'pi_comment_periods','pi_public_comments','pi_meetings',
--       'pi_interactions','pi_parcels','pi_parcel_owners',
--       'pi_client_summaries','pi_report_archive','pi_tribal_consultations'
--     )
--   order by tablename, policyname;
--
-- Expect exactly: one "<table>_staff_all" (authenticated, ALL, qual/with_check
-- "NOT pi_is_portal_client()"), one "anon_portal_read" (anon, SELECT, scoped —
-- absent on pi_tribal_consultations), one "<table>_client_portal_read"
-- (authenticated, SELECT, scoped — absent on pi_tribal_consultations) per
-- table. No remaining policy anywhere in this list should show qual = 'true'.
