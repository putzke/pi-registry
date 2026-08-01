# Test harness

Runs the real `index.html` and `client-portal.html` against a real Postgres,
locally, with no connection to the live Supabase project.

```bash
cd test && npm install     # once
node run.js                # everything
node run.js portal         # only tests whose name matches
VERBOSE=1 node run.js      # log every REST call the app makes
```

Requires PostgreSQL 16 (`/usr/lib/postgresql/16/bin`) and the Chromium at
`/opt/pw-browsers/chromium`.

## Why it exists

Every bug this project shipped got found by a human running something:

| Bug | How it surfaced |
| --- | --- |
| `pi_comment_periods` missing five columns the app writes | live SQL editor, 42703 |
| `text = bigint` in the demo seed | live SQL editor, second attempt |
| Settings had no scroll container — half the page unreachable | noticed in the browser |
| `issueId` never remapped after sync | found while reviewing an unrelated feature |

None of them needed cleverness to catch — they needed *something to actually
run the code*. That is all this is.

## How it works

```
run.js ── starts ephemeral Postgres  (lib/db.js)
       ── applies sql/*.sql migrations
       ── starts a PostgREST-compatible shim over it  (lib/postgrest.js)
       ── opens the real HTML in Chromium with Supabase calls routed to the shim  (lib/app.js)
       ── runs tests/*.test.js
```

Nothing in the apps is modified or mocked — Playwright request routing is what
redirects Supabase, so the tests exercise the file that actually ships.

A test gets `t` with `t.seed()` (runs the demo seed), `t.sql()` (query Postgres
directly), `t.open(file, opts)` (launch an app), and `t.ok/eq/gt` assertions.
The pattern that matters is: **drive the UI, then assert on the database.**

```js
await app.page.evaluate(id => assignFollowUp(id, 'SHA'), id);
const row = (await t.sql('select follow_up_assigned_to a from pi_interactions where id=$1', [id]))[0];
t.eq(row.a, 'SHA', 'reassignment persisted');
```

`shim.calls` records every request with its status and row count, so a test can
also assert *how* something was written — that a save was a real `PATCH` and
not just a local cache update, or that an optimistic-concurrency guard matched.

## Fidelity notes

The shim mimics PostgREST closely enough that behaviour differences show up as
test failures. Three cases cost real debugging time and are worth knowing:

- **Timestamps are returned as raw strings.** node-pg parses them into JS
  `Date`s, and serialising a `Date` truncates microseconds — a value stored as
  `…:07.70969+00` came back `…:07.709Z`. The app echoes that into the OCC guard
  (`?updated_at=eq.…`), so every guarded write matched zero rows and looked
  like a conflict.
- **`bigint` is returned as a JSON number**, matching PostgREST. node-pg
  defaults to a string, and the portal compares `x.id === _projId` with `===`,
  so string ids silently failed to match and the project banner vanished after
  a project switch.
- **Filters compare as text** (`col::text = $1`) because this schema genuinely
  mixes `text` and `bigint` for `project_id`. Temporal columns are the
  exception and compare natively — see the first note.
- **`project_id` columns must be `text`.** `fromSB()` stringifies `id` but
  passes foreign keys through raw, and the app then compares them strictly
  (`x.projectId === S.projectFilter`, and `S.projectFilter` always comes from a
  `<select>`, so it is always a string). Typing `project_id` as `bigint` in
  `build-schema.js` made the shim return numbers, and every project-scoped list
  came back empty for reasons that had nothing to do with the code under test.

Writes are local-first — `DB.set()` updates `_syncCache` immediately and
`DB._sync()` reaches Postgres a moment later — so asserting on the database
straight after a UI action is a race, and a fixed sleep only moves the flake
around. Use `t.until(fn)`; it polls for up to 5s and returns `fn()`'s value or
`null`.

`?select=a,b,c` is honoured, and an unknown column in a select is a hard error
rather than a silent pass. The shim used to always `select *`, which made a
narrowed select indistinguishable from a full one — so lazily-fetched columns
still arrived and the app could not be tested for what it does when a column is
genuinely absent.

Not implemented, because nothing calls it: embedded resources (`select=a(b)`),
`or=`, range headers, RPC, and RLS. RLS in particular means these tests say
nothing about the portal's access isolation.

## Keeping the schema honest

`schema-columns.txt` is a verbatim dump of the live `information_schema`. It is
what makes the drift test meaningful, and it is the one file that goes stale.
Refresh it after any migration:

```sql
select table_name, string_agg(column_name, ', ' order by ordinal_position)
  from information_schema.columns
 where table_schema = 'public' and table_name like 'pi\_%'
 group by table_name order by table_name;
```

Paste the rows back as `table|col, col, …`, then `node test/lib/build-schema.js`.

## Adding a test

Drop a file in `tests/` exporting `{ name, run({ db, shim, t }) }`. Each test
starts from a truncated database.
