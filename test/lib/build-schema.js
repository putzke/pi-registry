#!/usr/bin/env node
// Regenerates test/schema.sql from test/schema-columns.txt.
//
// schema-columns.txt is a verbatim dump of the live database, INCLUDING COLUMN
// TYPES — that is the reason the drift test means anything. Refresh it by
// running this in the Supabase SQL editor and pasting the result back:
//
//   select table_name || '|' || string_agg(
//            column_name || ':' ||
//            case data_type
//              when 'timestamp with time zone' then 'timestamptz'
//              when 'character varying'        then 'text'
//              else data_type end,
//            ', ' order by ordinal_position)
//     from information_schema.columns
//    where table_schema = 'public' and table_name like 'pi\\_%'
//    group by table_name order by table_name;
//
// then: node test/lib/build-schema.js
//
// TYPES USED TO BE INFERRED FROM THE COLUMN NAME, and that inference is what let
// a real bug through. Production had pi_meetings.attendee_ids as text while the
// name said jsonb, so the app's JSON array was rejected with a 400 in production
// and accepted here — the round trip passed in tests and lost every attendee
// list in the field. The dump settled several more: project_id and
// stakeholder_id are genuinely MIXED across tables (bigint on some, text on
// others), meeting_id and interaction_id are text, report_num and
// annual_report_year are text, and milestone_start / milestone_end are text
// rather than dates. A single guess per column name could not have been right.
const fs = require('fs');
const path = require('path');

// Only a fallback, for a column pasted in without a type. Anything that lands
// here is reported, because a guess is exactly what this file stopped doing.
const FALLBACK = 'text';
const TIMESTAMPS = new Set(['created_at','updated_at','published_at','editing_at','archived_at']);
// Which bigint ids are GENERATED ALWAYS AS IDENTITY rather than bigserial.
const IDENTITY_PK = new Set(['pi_projects','pi_stakeholders','pi_client_access',
                             'pi_parcels','pi_parcel_owners']);
// Tables an sql/ migration CREATED (see test/tests/17-grants.test.js's own
// `created` set) own their grants entirely — several deliberately reduced
// ones among them (pi_portal_links: anon gets SELECT only; pi_client_access:
// both roles get SELECT only). Every other table here was created through
// the Supabase dashboard in real life and got a full grant to both roles
// automatically, so that's the baseline this generator gives it; these five
// get none, so the sql/ migration that creates each one is the only source
// of its grants, matching production exactly instead of over-granting it.
const MIGRATION_GRANTED_TABLES = new Set([
  'pi_client_access', 'pi_client_summaries', 'pi_parcels',
  'pi_parcel_owners', 'pi_portal_links',
]);

const here = path.join(__dirname, '..');
const out = [];

// Supabase's two PostgREST roles. They do not exist in a bare cluster, so every
// `grant … to anon, authenticated` in sql/ used to fail here — and run.js
// swallows migration errors, which meant the harness could never see a grant at
// all. That is exactly how pi_parcels shipped granted to `anon` only: the
// database had the rows, the signed-in desktop app read them as `authenticated`
// and got nothing, and no test could tell.
out.push(`do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end $$;`);
// Real Supabase always ships an `auth` schema with `auth.users` and
// `auth.jwt()` — the RLS building block every "who is calling" policy in
// sql/ depends on (pi_client_access's own email-match policy, and the
// portal client-isolation migration's pi_is_portal_client()). A bare
// Postgres cluster has neither, and this went unnoticed for weeks: run.js
// swallows a migration's error per file, so
// sql/2026-07-13_client_access_by_email.sql's own `auth.jwt()`-referencing
// policy has been silently failing here since the day it was written —
// harmless to every existing test only because the harness's shim always
// queries as the `postgres` superuser, which bypasses RLS entirely, so no
// test could tell the policy wasn't really there. auth.jwt() here matches
// Supabase's real implementation: read whatever PostgREST set on
// request.jwt.claims for the current request.
out.push(`create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text
);
create or replace function auth.jwt() returns jsonb
language sql stable
as $auth_jwt$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$auth_jwt$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;`);
const guessed = [];
for (const line of fs.readFileSync(path.join(here, 'schema-columns.txt'), 'utf8').trim().split('\n')) {
  if (!line.trim()) continue;
  const [table, cols] = line.split('|');
  const defs = cols.split(',').map(c => c.trim()).filter(Boolean).map(spec => {
    const [col, declared] = spec.split(':').map(x => (x || '').trim());
    let ty = declared;
    if (!ty) { guessed.push(`${table}.${col}`); ty = FALLBACK; }
    if (col === 'id') {
      // The primary key's shape follows its declared type: text PKs are the
      // app-generated ids (comment periods, public comments, tribal), bigint
      // ones are generated by the database.
      if (ty === 'text') return 'id text primary key';
      return IDENTITY_PK.has(table)
        ? 'id bigint generated always as identity primary key'
        : 'id bigserial primary key';
    }
    if (col === 'token') return 'token uuid primary key';
    // OCC depends on updated_at defaulting to now(), so timestamps keep theirs.
    if (TIMESTAMPS.has(col) && ty === 'timestamptz') return `${col} timestamptz default now()`;
    return `${col} ${ty}`;
  });
  // A table created through the Supabase dashboard (which is how every one of
  // these started life — see CLAUDE.md's "GRANT BOTH ROLES" note) gets full
  // grants to both PostgREST roles automatically. This harness's shim always
  // queries as the `postgres` superuser regardless, so nothing here ever
  // depended on that grant existing — until a test actually switches to
  // `anon`/`authenticated` on a real connection (test/tests/46-*) to check
  // that RLS itself enforces isolation, at which point a table with no grant
  // at all denies BOTH roles before a policy is ever consulted, which is not
  // what production looks like. Granting both roles here for every table
  // reproduces the real starting point; whatever a later sql/ migration
  // narrows (an explicit REVOKE, or a table it created with its own grants)
  // still applies on top, same as it does in production.
  out.push(`create table ${table} (\n  ${defs.join(',\n  ')}\n);`);
  if (!MIGRATION_GRANTED_TABLES.has(table)) {
    out.push(`grant select, insert, update, delete on ${table} to anon, authenticated;`);
  }
}
if (guessed.length) {
  console.warn('  WARNING — no type declared, fell back to ' + FALLBACK + ':\n    '
    + guessed.join('\n    ') + '\n  Re-run the dump query in the header comment.');
}
out.push('create unique index pi_portal_links_proj_uniq on pi_portal_links(project_id);');
out.push('create unique index pi_parcels_proj_number_uniq on pi_parcels (project_id, lower(trim(parcel_number)));');
out.push('create unique index pi_parcel_owners_uniq on pi_parcel_owners (parcel_id, stakeholder_id);');
out.push('alter table pi_client_access add constraint pi_client_access_email_project_uniq unique (email, project_id);');

const dest = path.join(here, 'schema.sql');
fs.writeFileSync(dest, '-- GENERATED by test/lib/build-schema.js from test/schema-columns.txt.\n'
                     + '-- Do not edit by hand; edit schema-columns.txt and regenerate.\n\n'
                     + out.join('\n\n') + '\n');
console.log(`wrote ${dest} — ${out.length - 7} tables`);
