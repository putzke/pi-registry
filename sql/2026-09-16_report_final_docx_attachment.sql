-- ═══════════════════════════════════════════════════════════════════════════
-- The final, hand-edited .docx becomes the report of record
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS
--   The "FROZEN SNAPSHOTS" model (sql/2026-07-25_report_archive_snapshot.sql,
--   see CLAUDE.md) captures a structured JSON snapshot of the report at
--   archive time and treats it as the compliance record. That was never true
--   in practice: the consultant downloads the exported .docx, hand-edits the
--   prose (and sometimes adds photos/graphics the app has no model for)
--   BEFORE delivering it to the client. The archived JSON snapshot and the
--   document the client actually received have been two different artifacts
--   since the day this feature shipped.
--
--   This migration does not remove the snapshot — it still drives the AI
--   trend tooling and the in-app preview for reports that predate this
--   change (see the grandfather note below) — but it demotes it from "the
--   record" to "a fallback." The real record is now the uploaded .docx
--   itself, stored as an opaque attachment in Supabase Storage and
--   referenced by path. Trying to keep a structured snapshot in sync with
--   arbitrary hand-edits (reformatted tables, pasted images) is a much
--   harder problem than storing the file the consultant actually sent, so
--   this deliberately does not attempt it.
--
-- WHAT THIS ADDS
--   1. A private Storage bucket, `report-files` — one .docx per archived
--      report, at `{project_id}/{archive_id}.docx`.
--   2. Two columns on pi_report_archive: `docx_path` (the storage path, null
--      until a file is attached) and `docx_uploaded_at`.
--   3. A trigger that REQUIRES docx_path before a report can be newly marked
--      client_visible — the enforcement of "no real file, no share" at the
--      database level, not just in the UI. It only guards the FALSE → TRUE
--      transition (and insert-as-true), so it never touches a row that is
--      already client_visible when this migration runs.
--   4. Storage RLS on storage.objects for the new bucket, reusing
--      pi_is_portal_client() / pi_portal_project_ids() from
--      sql/2026-08-31_portal_client_isolation.sql exactly the way every
--      other table in that migration does — staff get full access, a
--      granted OTP client and a token-link visitor each get read-only
--      access to files behind reports actually shared with their project.
--
-- GRANDFATHERING (explicit product decision, not an oversight)
--   Reports already shared before this ships (client_visible = true,
--   docx_path still null) stay visible exactly as they render today — the
--   trigger below only fires on a NEW transition to true, so it never
--   touches them, and no data is force-unshared. index.html and
--   client-portal.html both keep the existing snapshot-rendered preview as
--   a fallback for any row with docx_path is null; new archives are pushed
--   toward requiring a real attachment.
--
-- HOW DOWNLOAD WORKS WITHOUT A NEW RPC
--   Unlike pi_resolve_portal_token (needed because pi_portal_links itself
--   had to stop being directly listable by anon), no custom function is
--   needed to hand out a file. Supabase Storage's own
--   `POST /storage/v1/object/sign/{bucket}/{path}` endpoint checks the
--   CALLER's own RLS SELECT access on storage.objects before it will issue a
--   signed URL — anon or authenticated, the caller's own apikey/JWT is
--   enough. So the policies below are the entire access-control surface;
--   client-portal.html just calls that endpoint with its existing headers
--   (anonHdrs()/authHdrs(), same pattern as every other request it makes).
--
-- SAME RESIDUAL GAP AS THE REST OF THE PORTAL, NOT A NEW ONE
--   The anon (token-link) policy below scopes by "this project has SOME
--   active portal link," the same scoping sql/2026-08-31_portal_client_isolation.sql
--   already documented as incomplete (it can't yet tell that the caller
--   holds THIS project's specific token — see that migration's own note on
--   the request.headers GUC). This migration does not attempt to close that
--   gap either, for the identical reason: it needs to be verified live
--   against the real Supabase project first.
--
-- A NOTE ON WHAT COULD AND COULD NOT BE VERIFIED FROM THIS SANDBOX
--   storage.objects RLS policies (row-level SELECT/INSERT/UPDATE/DELETE
--   gated by a USING/WITH CHECK clause on a Postgres table) are documented,
--   stable Supabase primitives — not a guessed third-party endpoint the way
--   the UGRC integration was. The policy logic itself was verified the same
--   way every other RLS change this session was: against a real scratch
--   Postgres 16 instance with a stand-in storage.objects/storage.buckets
--   schema (see test/lib/build-schema.js), switching role and JWT claims and
--   confirming staff/client/anon each see exactly the rows they should. What
--   could NOT be verified from this sandbox (no network path to
--   *.supabase.co) is the live Storage service itself — the actual
--   upload/sign/download round trip. Test that once, by hand, against the
--   real project before relying on it for a real client delivery.
--
--   ONE THING THE SCRATCH POSTGRES COULDN'T CATCH, because it's not a real
--   ownership boundary there: this migration originally also ran
--   `alter table storage.objects enable row level security;` before the
--   policies. Run for real against the live project it failed outright —
--   `ERROR: 42501: must be owner of table objects` — because storage.objects
--   is owned by Supabase's own `supabase_storage_admin` role, not the
--   `postgres` role the SQL Editor connects as, and Supabase already has RLS
--   permanently enabled on that table regardless. The scratch harness's
--   storage.objects stand-in is owned by whatever role creates it there, so
--   the same statement just quietly succeeds in the harness — a real gap
--   between what the harness can prove and what only a live run catches,
--   same shape as (though far smaller than) the UGRC endpoint story. The
--   line is removed below; CREATE POLICY on storage.objects does not hit the
--   same wall — that's Supabase's own documented pattern for managing
--   storage policies from the SQL Editor, and it worked.
--
-- Idempotent — every statement below is safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Storage bucket ─────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('report-files', 'report-files', false)
on conflict (id) do nothing;

-- ── 2. Columns on pi_report_archive ───────────────────────────────────────
-- No new GRANT needed — pi_report_archive already has table-level grants to
-- anon/authenticated from sql/2026-07-06_portal_shared_reports.sql, and a
-- table-level GRANT covers columns added after it, including these.
alter table pi_report_archive add column if not exists docx_path text;
alter table pi_report_archive add column if not exists docx_uploaded_at timestamptz;

-- ── 3. Require an attachment before a report is newly shared ─────────────
-- Fires only on the FALSE → TRUE transition (or INSERT already true) — an
-- already-shared row from before this migration is never touched, which is
-- what makes the grandfathering above a real guarantee rather than a UI-only
-- courtesy.
create or replace function pi_report_archive_require_docx()
returns trigger
language plpgsql
as $$
begin
  if new.client_visible = true
     and (tg_op = 'INSERT' or old.client_visible is distinct from true)
     and new.docx_path is null then
    raise exception 'A final .docx must be attached (docx_path) before this report can be shared with the client.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_report_archive_require_docx on pi_report_archive;
create trigger trg_report_archive_require_docx
  before insert or update on pi_report_archive
  for each row execute function pi_report_archive_require_docx();

-- ── 4. Storage RLS on the new bucket ──────────────────────────────────────
-- No `alter table storage.objects enable row level security` here —
-- deliberately, found the hard way. `storage.objects` is owned by Supabase's
-- own internal `supabase_storage_admin` role, not the `postgres` role the SQL
-- Editor runs as, and RLS is already permanently enabled on it by Supabase
-- itself. Running that ALTER against the live project failed outright —
-- `ERROR: 42501: must be owner of table objects` — which is also the
-- confirmation that RLS doesn't need to be (and can't be) turned on here.
-- CREATE POLICY on storage.objects is a different, well-documented Supabase
-- pattern (their own docs show this exact statement run from the SQL
-- Editor) and does not hit the same ownership wall.
drop policy if exists report_files_staff_all on storage.objects;
drop policy if exists report_files_client_portal_read on storage.objects;
drop policy if exists report_files_anon_portal_read on storage.objects;

-- Staff: full access to every object in the bucket. Matches the shape of
-- every "<table>_staff_all" policy in sql/2026-08-31_portal_client_isolation.sql.
create policy report_files_staff_all on storage.objects
  for all to authenticated
  using (bucket_id = 'report-files' and not pi_is_portal_client())
  with check (bucket_id = 'report-files' and not pi_is_portal_client());

-- OTP-logged-in client: read-only, and only for a file behind a report that
-- is BOTH client_visible AND belongs to one of their granted projects.
-- storage.filename(name) is the last path segment ("<archive_id>.docx");
-- stripping the extension recovers the archive id the file belongs to.
create policy report_files_client_portal_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'report-files'
    and pi_is_portal_client()
    and exists (
      select 1 from pi_report_archive a
      where a.id::text = split_part(storage.filename(storage.objects.name), '.', 1)
        and a.client_visible = true
        and a.project_id::text in (
          select project_id::text from pi_client_access
          where lower(email) = lower(auth.jwt() ->> 'email')
        )
    )
  );

-- Token-link visitor: same "this project has an active link" scoping every
-- other anon_portal_read policy uses (see the residual-gap note above).
create policy report_files_anon_portal_read on storage.objects
  for select to anon
  using (
    bucket_id = 'report-files'
    and exists (
      select 1 from pi_report_archive a
      where a.id::text = split_part(storage.filename(storage.objects.name), '.', 1)
        and a.client_visible = true
        and a.project_id::text in (select project_id from pi_portal_project_ids())
    )
  );

-- ── Verify (run after, in the SQL Editor) ────────────────────────────────
--   select policyname, roles, cmd, qual, with_check from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like 'report_files_%';
--   -- expect the three policies above, each scoped by bucket_id = 'report-files'.
--
--   select column_name from information_schema.columns
--    where table_name = 'pi_report_archive' and column_name like 'docx_%';
--   -- expect docx_path, docx_uploaded_at.
--
--   -- Confirm the trigger actually blocks an unattached share:
--   update pi_report_archive set client_visible = true
--    where id = (select id from pi_report_archive where docx_path is null limit 1);
--   -- expect: ERROR: A final .docx must be attached ...
