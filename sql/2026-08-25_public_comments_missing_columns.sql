-- ═══════════════════════════════════════════════════════════════════════════
-- pi_public_comments — add the three columns the desktop form collects but
-- had nowhere to store.
--
-- THE BUG THIS COMPLETES THE FIX FOR
-- saveComment() built its record with internal names that were absent from
-- SB_TO_INT.pi_public_comments — commentText, topic, commentMethod,
-- submittedDate, commenterName, commenterOrg, commentPeriodId,
-- commentPeriodType, commenterEmail, respondedBy, notes. toSB() drops any key
-- it cannot map, so a comment logged through the UI persisted as
-- project_id + response_status and nothing else. It painted into the list and
-- then vanished. On a NEPA comment period the public comments ARE the formal
-- record, so those were blank rows on a compliance artifact.
--
-- Eight of those names were a vocabulary split — the report sections already
-- read summary/category/channel/commentDate/commenter/affiliation/periodId/
-- commentType, i.e. the columns that exist. Those are renamed in index.html to
-- the mapped names; no schema change needed for them.
--
-- These THREE had no column at all, which is why they needed a decision rather
-- than a rename:
--   commenter_email  — how to reach the commenter for a formal response. Under
--                      a comment period this is the reply-to for the response
--                      record, so losing it costs the response, not just a
--                      contact detail.
--   responded_by     — who answered. Attribution on a compliance record.
--   notes            — internal notes, deliberately NOT client-facing (the
--                      portal never selects this column; see below).
--
-- Idempotent. Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.pi_public_comments
  add column if not exists commenter_email text,
  add column if not exists responded_by    text,
  add column if not exists notes           text;

-- ── GRANTS: both roles, every time ────────────────────────────────────────
-- index.html and mobile.html run as `authenticated` (they sign in through
-- Supabase auth); client-portal.html runs as `anon`. A missing grant does not
-- error — RLS with no matching policy returns zero rows and sbGet() turns even
-- a 403 into [] — so the view renders "nothing here yet" over a full table.
-- This has bitten twice, once in each direction.
--
-- These are new COLUMNS on an existing table rather than a new table, so the
-- table-level grants already cover them. Re-asserted anyway: it costs nothing,
-- and the failure mode of getting it wrong is silent.
grant select, insert, update, delete on public.pi_public_comments to authenticated;
grant select, insert, update, delete on public.pi_public_comments to anon;

-- ── A note on the portal ──────────────────────────────────────────────────
-- client-portal.html curates its columns per fetch and does not select
-- commenter_email, responded_by or notes. That is deliberate and should stay:
-- a portal token link is unauthenticated, and a commenter's email address is
-- personal data belonging to a member of the public. Internal notes are
-- withheld for the same reason the parcel notes are.

-- ── Verify ────────────────────────────────────────────────────────────────
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'pi_public_comments'
   and column_name in ('commenter_email', 'responded_by', 'notes')
 order by column_name;
