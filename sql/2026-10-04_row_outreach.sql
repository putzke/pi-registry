-- Right-of-way / easement outreach: what PI staff learn before the ROW agents
-- go in to negotiate.
--
-- The PI job on a ROW or easement campaign is to trace each parcel to the party
-- with authority to speak and sign for it (often through a property manager or
-- several other numbers first), have an early conversation, share the legal
-- description and the design exhibit, and grade how the owner received it. The
-- ROW agent reads that grade and the concerns before the first negotiation.
--
-- 1. pi_parcel_outreach — one row per (parcel, contact), STAFF-ONLY.
--    Sentiment and concerns about a private property owner ("worried about
--    losing frontage", "won't engage") must never reach the client portal.
--    These could not simply be columns on pi_parcel_owners: the portal reads
--    owner links, and a portal client signs in under the same `authenticated`
--    role as staff, so a raw REST call could ask for any column. RLS gates
--    rows, not columns; a separate table with a staff-only policy is what
--    actually keeps it out. Same policy shape as pi_closeouts.
--    Keyed by (parcel_id, stakeholder_id), not by the owner-link id, so
--    detaching and re-attaching a contact keeps what was learned.
--    sentiment: 'Willing' | 'Has questions' | 'Resistant' | 'Won''t engage',
--    null = not graded yet.
--
-- 2. pi_parcels.legal_desc_shared / exhibit_shared — when the survey (legal)
--    description and the design exhibit showing the take were shared with the
--    owner. Facts about the parcel, not opinions about a person, so they sit
--    on the parcel.
--
-- Idempotent.

create table if not exists pi_parcel_outreach (
  id                bigint generated always as identity primary key,
  parcel_id         text   not null,
  stakeholder_id    text   not null,
  authorized_signer boolean not null default false,
  sentiment         text,
  concerns          text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  updated_by        text,
  unique (parcel_id, stakeholder_id)
);

alter table pi_parcel_outreach enable row level security;

drop policy if exists pi_parcel_outreach_staff_all on pi_parcel_outreach;
create policy pi_parcel_outreach_staff_all on pi_parcel_outreach
  for all to authenticated
  using (not pi_is_portal_client())
  with check (not pi_is_portal_client());

grant select, insert, update, delete on pi_parcel_outreach to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on pi_parcel_outreach from anon;

alter table pi_parcels add column if not exists legal_desc_shared date;
alter table pi_parcels add column if not exists exhibit_shared    date;

-- ── Verify (run after) ───────────────────────────────────────────────────────
--   select policyname, roles from pg_policies where tablename = 'pi_parcel_outreach';
-- Expect one row: pi_parcel_outreach_staff_all, {authenticated}.
--   select has_table_privilege('anon', 'pi_parcel_outreach', 'SELECT');
-- Expect false.
--   select column_name from information_schema.columns
--    where table_name = 'pi_parcels' and column_name in ('legal_desc_shared','exhibit_shared');
-- Expect two rows.
