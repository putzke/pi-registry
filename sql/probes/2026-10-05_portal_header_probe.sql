-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE (temporary): does Supabase hand a custom request header to the
-- database? Run this BEFORE sql/2026-10-05_portal_token_scoping.sql.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Why: the portal-token fix makes every token-link read check the visitor's
-- own link, sent as an `x-portal-token` header and read in SQL through
-- current_setting('request.headers'). That only works if, on THIS Supabase
-- project:
--   (a) the browser is allowed to send the header from putzke.github.io (CORS),
--   (b) the REST API (PostgREST) passes it through to the database, and
--   (c) the Storage API does too — report .docx downloads are authorised by a
--       Storage policy, which runs inside Storage's own database session.
-- None of that can be checked from the sandbox that wrote the fix (it has no
-- network route to *.supabase.co), and a security control built on an
-- unverified assumption is how the UGRC endpoint shipped wrong (CLAUDE.md).
--
-- Nothing here touches project data. It creates one function, one empty
-- private bucket and one policy that only ever matches that bucket.
--
-- ── STEP 1: run this block in the Supabase SQL Editor ──────────────────────

-- (b) REST: echoes back the x-portal-token header the request carried.
create or replace function public.pi_header_probe()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.headers', true), '')::json ->> 'x-portal-token';
$$;
grant execute on function public.pi_header_probe() to anon;

-- (c) Storage: an empty private bucket that anon can see ONLY when the
-- request carries x-portal-token: probe-ok. Storage checks bucket reads
-- against storage.buckets RLS in the same session it uses for downloads, so
-- this answers the question for the report-files policy too.
insert into storage.buckets (id, name, public)
values ('pi-header-probe', 'pi-header-probe', false)
on conflict (id) do nothing;

drop policy if exists pi_header_probe on storage.buckets;
create policy pi_header_probe on storage.buckets
  for select to anon
  using (
    id = 'pi-header-probe'
    and nullif(current_setting('request.headers', true), '')::json ->> 'x-portal-token' = 'probe-ok'
  );

notify pgrst, 'reload schema';

-- ── STEP 2: in the browser ─────────────────────────────────────────────────
-- Open https://putzke.github.io/pi-registry/client-portal.html (the login
-- screen is fine), open the developer console (F12 → Console), paste this and
-- press Enter. It uses the page's own anonHdrs(), i.e. exactly the headers a
-- token-link visitor sends today.
--
-- (async () => {
--   const go = async (check, url, extra) => {
--     try {
--       const r = await fetch(url, { headers: Object.assign({}, anonHdrs(), extra || {}) });
--       return { check, status: r.status, body: (await r.text()).slice(0, 70) };
--     } catch (e) { return { check, status: 'BLOCKED', body: String(e.message || e) }; }
--   };
--   const H = { 'x-portal-token': 'probe-ok' };
--   const B = { Authorization: 'Bearer ' + SUPA_KEY };
--   console.table([
--     await go('1 REST, with header',              SUPA_URL + '/rest/v1/rpc/pi_header_probe', H),
--     await go('2 REST, no header',                SUPA_URL + '/rest/v1/rpc/pi_header_probe'),
--     await go('3 Storage, with header',           SUPA_URL + '/storage/v1/bucket/pi-header-probe', H),
--     await go('4 Storage, no header',             SUPA_URL + '/storage/v1/bucket/pi-header-probe'),
--     await go('5 Storage, with header + bearer',  SUPA_URL + '/storage/v1/bucket/pi-header-probe', Object.assign({}, H, B)),
--   ]);
-- })();
--
-- Expected if everything works:
--   1  status 200, body "probe-ok"
--   2  status 200, body null
--   3  status 200, body starting {"id":"pi-header-probe"
--   4  status 400 or 404 (bucket not found: no header, no access)
--   5  status 200 (only matters if 3 fails)
-- "BLOCKED" on 1 or 3 means the browser refused to send the header (CORS).
-- Send me a screenshot of the table either way.
--
-- ── STEP 3: clean up (after you've sent the results) ───────────────────────
--
-- drop policy if exists pi_header_probe on storage.buckets;
-- drop function if exists public.pi_header_probe();
-- delete from storage.buckets where id = 'pi-header-probe';
-- notify pgrst, 'reload schema';
--
-- If the delete is refused ("direct deletion from storage tables is not
-- allowed"), delete the empty "pi-header-probe" bucket from the dashboard's
-- Storage page instead, or leave it: it is private, empty, and with the
-- policy dropped nobody but staff can see it.
