# Cirrus Cc (formerly Horizon COMPASS) — Claude Code Context

## What this app is
Single-file FHWA/NEPA public involvement (PI) compliance platform. All code lives in **`index.html`** (~24,700 lines). No build step. Deployed on **GitHub Pages** at `https://app.cirruscc.com/` (custom domain since Oct 2026; the old `putzke.github.io/pi-registry/` address forwards). Backend is **Supabase** (REST API, no Supabase JS client).

Other files: `mobile.html` (mobile companion), `importer.html` (bulk data import), `seed-sample-data.js` (seed script run from browser console).

## Architecture

### Data layer
- `DB.get('table')` / `DB.getActive('table')` — reads from `_syncCache[k]`
- `DB.set('table', arr)` — writes cache and triggers `DB._sync()` to push to Supabase
- `_syncCache` is populated at startup via `loadAllData()`
- `SB_TABLES` maps internal names → Supabase table names
- `SB_TO_INT` maps Supabase column names → internal field names (used in `fromSB()`)
- `toSB(table, obj)` / `fromSB(table, row)` — serialization helpers
- `sbGet()`, `sbAdd()`, `sbUpdate()`, `sbDelete()` — Supabase REST helpers
- `DATE_FIELDS` Set — columns that must be `null` (not `''`) when empty
- `TEXT_PK_TABLES` — tables using app-generated text PKs (most use Supabase integer auto-increment)
- **Important**: `pi_projects` and `pi_stakeholders` use `GENERATED ALWAYS AS IDENTITY` integer PKs. Never pre-assign text IDs for these.
- **`OCC_TABLES`** Set (`stakeholders`, `interactions`, `issues`) — optimistic-concurrency
  guard for ordinary modal edits. `sbUpdate(table,id,obj,baseTs)` takes a 4th arg
  (the pre-edit `updated_at`); `DB._sync` passes `oldMap[item.id].updatedAt`. For OCC
  tables the PATCH is conditional (`&updated_at=eq.<baseTs>`, `return=representation`)
  — 0 rows back = a concurrent edit → `_occResolveConflict()` (self-write guard →
  silent force; else `confirm()` overwrite-vs-discard). `updated_at`/`updated_by` are
  read into the cache via a `fromSB` special-case (deliberately NOT in `SB_TO_INT`, or
  `toSB` would echo the stale baseline). Migration: `sql/2026-07-24_app_wide_occ.sql`.
  The PI report editor has its own richer OCC (presence + heartbeat, `_rptEdit`); this
  is the lightweight save-time version for everything else. To extend OCC to another
  table: add it to `OCC_TABLES`, add `updated_at`/`updated_by` columns via migration.
  **Fetch-fresh-on-open:** `_syncCache` is loaded once at startup and NOT auto-refreshed,
  so the three OCC edit modals (`openEditIntModal`, `openStakeModal`, `openIssueModal`)
  `await _occRefreshRow(table,id)` before populating — pulls the latest row from Supabase
  into the cache so a concurrent user's saved change shows immediately (no hard-refresh)
  and the OCC baseline is accurate-at-open. There is NO live presence warning on these
  modals (unlike the report editor) — that's by design, not a bug.
- **A failed READ must never look like an empty table (Aug 2026).**
  `sbGet(table, opts)` — pass `{strict:true}` and a non-404 error THROWS instead
  of returning `[]`. Returning `[]` for a 401 or a 500 makes a broken fetch
  indistinguishable from a table with no rows, and any caller that assigns the
  result into `_syncCache` then ERASES good data.
  That is exactly what happened: one background refresh got a 4xx (an expired
  token is the usual cause), `_refreshData` assigned `[]` over the stakeholder
  cache, and the app emptied in place — Master List badge 0, and every name in
  the PI report's interaction table resolving to "Anonymous" because the lookup
  had nothing left to find. The rows were in the database throughout.
  `_refreshData`'s comment had always claimed the cache was left alone on
  failure; that was only ever true for a thrown NETWORK error.
  `_refreshData` now uses strict, keeps the last good copy and warns once a
  minute (`_refreshFailed`). `loadAllData` stays tolerant — one unreachable
  table must not lock the app — but names what failed in a toast rather than
  showing a silent blank. A **404 is still an empty result**, not a failure: it
  means the table has not been created yet. Guarded by
  `test/tests/29-refresh-failure.test.js`.
- **Live data refresh** (`_bgRefreshTick`, near `loadAllData`) — `_syncCache` is
  loaded once at startup, so this keeps a DWELLED-on list view from going stale.
  Refetches only the current view's tables (`_viewTables(S.view)`) and re-renders
  ONLY if the data actually changed. Triggers: on nav (`setView`), on tab re-focus
  (`visibilitychange`), and a 60s interval. Stands down (`_bgRefreshOK`) when a
  refresh would disrupt: tab hidden, `_rptEdit` active, a modal open, an input
  focused, or a local write in flight / just made (`_writesInFlight`,
  `_lastLocalWriteAt` — both set in `_sbWrite`). Replaces arrays, so no memory
  growth. Views not in `_viewTables` (settings, map, reports) don't auto-refresh.

## Brand: Cirrus Cc (renamed from Horizon COMPASS, Oct 2026)
Full rename, from the Claude Design handoff kept verbatim in `brand/source/`
(its `README.md` has the rules: name "Cirrus Cc", never "CC"; caps contexts
"CIRRUS Cc"; tagline "Consultant to client, in real time"; tokens; minimum
sizes). **"PI Registry"**, an older name still in some visible strings, went too.
- **`tools/build-brand.py`** writes `brand/*.svg`: the handoff's symbol, favicon
  and app icon with their 8 KB C2PA metadata stripped, and the lockups and
  wordmarks **rebuilt from the reference HTML's spacing rules with the text
  outlined** (Michroma / Saira 300 shaped by HarfBuzz; `pip install fonttools
  uharfbuzz`). Not the handoff's lockup SVGs: those set live text at
  approximate positions, and with the real fonts the horizontal lockup's
  subtitle overran its viewBox ("STAKEHOLDER MANAGEME"). Outlined text is also
  the only kind an `<img src="data:…svg">`, a print view or Word can draw —
  none of them can load a web font. Verified by overlaying the reference HTML,
  rendered with the real fonts, in difference mode.
- **`tools/render-brand-png.js`** writes `brand/png/`: the letterhead mark
  (2100 px, transparent) and the 180 px apple-touch tile (square and
  full-bleed — iOS rounds it and paints transparency black).
- Where each copy lives (all asserted byte-equal to `brand/` by
  `test/tests/65-cirrus-brand.test.js`): favicon in all four apps; desktop
  sidebar + sign-in = stacked reversed lockup inline (sidebar 186 px wide, the
  width that keeps the subtitle at the brief's 8 px minimum); quick-report
  header `window._srHeader` = horizontal light lockup at 70 px tall; mobile
  header, portal top bar = reversed wordmark only and importer header = light
  wordmark (the brief: wordmark only on bars under ~200 px); sign-in screens
  carry the tagline in Saira italic (loaded from Google Fonts, the only live
  brand text); the portal top bar has the Sky "You're cc'd on this project"
  indicator (hidden under 768 px). **.docx**: `image3.png` in Sunrise Alt and
  UDOT via `node tools/swap-letterhead-logo.js <brand> brand/png/cirrus-cc-lockup-horizontal-light.png --drawing 2`
  (the tool now takes `--drawing N`; it used to touch only the first picture).
  The Sunrise template's letterhead is one banner with no product mark.
- **Deliberately NOT renamed:** localStorage keys `compass_claude_api_key_v2` /
  `compass_report_branding` (renaming signs everyone out of their saved AI key
  and letterhead choice), the close-out intake's internal `kind: 'compass'`,
  Supabase names and the repo name. App links moved to `app.cirruscc.com` on
  2026-10-06 (below); old `putzke.github.io/pi-registry/…` links forward. Demo-seed portal logins use
  `@cirruscc.com` addresses since Oct 2026 (the seed still purges the old
  `@horizoncompass.com` ones; the live rows were renamed in place).

### Switching to app.cirruscc.com — SWITCHED 2026-10-06
Done: Wix DNS `CNAME app → putzke.github.io` and the GitHub domain-verification
TXT `_github-pages-challenge-putzke` (both added through the Wix connector's
account-level DNS API, which works), `cirruscc.com` verified on GitHub, the repo's custom domain set with HTTPS
enforced (GitHub committed `CNAME`; test 65 asserts it), `APP_BASE_URL` flipped
in both files. Supabase URL configuration (step 3) saved by Jeff the same day;
the Maps key referrer (step 4) added too (the Map view stayed blank until it
was; `window.gm_authFailure` now says so on screen).
**The marketing site** is `putzke/cirruscc-website` (renamed from
`horizoncompass`), served at `www.cirruscc.com`: Wix DNS `CNAME www →
putzke.github.io` and the root `A` records → GitHub's 185.199.108–111.153, so
bare `cirruscc.com` forwards to www. Wix's own records for both were replaced
2026-10-06 (no Wix site was attached). The original checklist, kept for reference:

#### The original plan (Oct 2026)
`cirruscc.com` is owned; DNS is not pointed yet. The app address is ONE constant,
`APP_BASE_URL`, in `index.html` (portal share links) and `client-portal.html`
(`PORTAL_URL`, the sign-in email's redirect), asserted equal by test 65.
Flipping it early breaks two live things: every portal link copied after the
flip points at an address that doesn't resolve, and client email sign-in lands
on it too. Order:
1. **DNS** (at the registrar): `CNAME app → putzke.github.io`. The marketing
   site `www.cirruscc.com` is a SEPARATE site — GitHub Pages serves one custom
   domain per repo, so it needs its own repo (or wherever it's built).
2. **GitHub → putzke/pi-registry → Settings → Pages → Custom domain:**
   `app.cirruscc.com`; wait for the certificate, tick **Enforce HTTPS**. This
   commits a `CNAME` file, and from then on `putzke.github.io/pi-registry/…`
   redirects to `app.cirruscc.com/…`, so links already sent keep working.
   Don't add the `CNAME` file before step 1 resolves — it redirects the
   working address to a dead one.
3. **Supabase → Authentication → URL Configuration:** Site URL
   `https://app.cirruscc.com`; Redirect URLs add
   `https://app.cirruscc.com/client-portal.html` (keep the old one a while).
4. **Google Cloud → the Maps/Places API key:** if it's restricted by HTTP
   referrer, add `https://app.cirruscc.com/*`, or the Map view and address
   autocomplete stop working on the new address.
5. **Flip `APP_BASE_URL`** in both files to `https://app.cirruscc.com`, run the
   suite, push.
6. **Tell staff:** browser storage is per-address, so on the new address each
   person signs in again and re-enters their Claude API key and letterhead
   choice (Settings). Data in Supabase is unaffected.

### State
```javascript
const S = {
  view: 'dashboard',       // current nav view
  projectFilter: null,     // active project ID (string)
  rptTab: 'reports',       // reports sub-tab: 'reports' | 'pi-editor' | 'archive'
  stakeTab: 'info',
  skView: 'list',
  // ... other UI state
};
```

### Supabase tables
```
pi_projects, pi_stakeholders, pi_project_stakeholders,
pi_interactions, pi_deliverables, pi_meetings,
pi_issues, pi_issue_interactions, pi_commitments,
pi_groups, pi_group_members, pi_dismissed_pairs,
pi_comment_periods, pi_public_comments,
pi_tribal_consultations,
pi_reports,         -- PI report drafts (one per project)
pi_report_archive   -- exported report snapshots (up to 50 per project)
```

### Sidebar
Brand, then the Views nav box, then the footer. The **Active / On-Hold Projects
list was removed (Aug 2026)** — it was redundant with the project select five
views already carry in their topbar (`S.projectFilter` is the same state either
way), it grew unbounded as projects accumulated, and it truncated every name.
`buildProjList()` and the `.proj-btn`/`.proj-box`/`.proj-scroll` styles went with
it. `filterByProject()` stays — it is still called from project cards, the map,
and several views. "Import stakeholders" now sits in the nav box beside Settings.
The freed height is deliberately left to the nav box (`overflow-y:auto`) so the
Views list has room to grow.

### The dashboard project card is IDENTITY + EXCEPTIONS (Aug 2026)
`projCard()` (dashboard only — the Projects view builds its own cards) used to
carry a sentiment-mix bar, a NEPA checklist bar, and a row of contacts /
champions / opponents / interactions. **Every one of those is also on the
Projects view card**, which is where you go to compare projects. On the
dashboard they were duplicated detail costing four rows of vertical height per
card, and the dashboard is the one screen where height is the scarce resource.

What stays is what a dashboard is for: **overdue follow-ups** and **how long
since the client got a status report** — things that are wrong or going stale,
which no other screen surfaces at a glance. Card height 171px → 109px.

**"Last report: <date>" replaced "✦ Portal: <date>" (Oct 2026).** The old
chip counted only published AI Project Status Reports, so it was blank on
every project reported by shared PI report PDFs (live: 3600 West and SR-201,
4 and 2 shared PDFs, no chip) and showed only the demo seed's July dates.
`_lastClientReport(projId)` (next to `TEAM_STALE_DAYS`) = the newest of a
shared PI report (`archivedAt` — when it was issued; a later PDF
replacement must not move it — unshared ones never count) or a published status report; amber at `LAST_REPORT_STALE_DAYS` (30);
an active project with neither reads "No report shared yet". The Team view's
"No report 30+ days" column uses the same helper. Dashboard and Team refresh
`report_archive` + `client_summaries`. Guarded by
`test/tests/18-portal-chip.test.js`.

The footer row is omitted entirely when a project has neither, rather than
rendering an empty bordered strip. `fuTag` lost its `margin-left:auto` (it is
now the first chip, not the last) and the portal chip keeps its own, so the two
sit at opposite ends. The `psSt` / `champ` / `opp` / `ints2` scans went with the
markup — they ran per card on every render for numbers nothing displayed.

### A freshly logged interaction could open its own Edit modal blank (Aug 2026)
`saveQuickLog()` and `saveInt()` push a new row into the cache under a
**temporary local id** (`DB.uid()`, prefixed `tmp_`) before the real Supabase
insert has happened, then call `DB.set(...)` — which starts that insert in the
background — **without awaiting it**, and immediately call `render()`. The
interaction table's "Edit" button is drawn with the id in the cache **at that
exact moment**, i.e. the temporary one. Moments later the insert resolves and
`DB._sync` swaps the temporary id for the real one **inside the cache**, but
nothing re-renders to match — so the button already on screen keeps pointing
at an id the cache no longer has. Click Edit on a row logged within roughly
the last second (which, for a small quick-log batch, is easily faster than
moving the mouse to the button) and `openEditIntModal(id)`'s lookup finds
nothing, falls back to `{}`, and opens the modal with every field blank
rather than the interaction you just logged.

Reported live as "the interaction log window was blank" right after logging a
batch of interactions through Quick Log — nothing to do with the data itself,
and the row edits correctly on any later attempt, once a fresh `render()` has
drawn from the now-settled cache. That "works the second time" pattern is the
signature of this exact race, not a data problem.

Fixed by making both save functions `async` and `await DB.set(...)` before
`render()` — the id baked into the DOM is then always the final one.
`delInt()` does not create a new row, so the race does not apply to it and it
was left alone. **This is a narrow, scoped fix, not a sweep** — roughly 50
other `DB.set(...)` call sites in `index.html` don't await it either, and any
of them that immediately re-render after creating a NEW row (not just
updating an existing one) could have the same latent race. Only the two
functions this bug actually hit were changed.

Guarded by `test/tests/46-interaction-save-id-race.test.js` (9 checks):
asserts the id baked into a freshly-rendered Edit button is the real numeric
id, never `tmp_...`, for both Quick Log and the single Log Interaction modal;
separately demonstrates the failure mode itself (opening the modal by an id
the cache genuinely doesn't have really does blank every field), so the
regression this guards against is unambiguous rather than a coincidental
pass. Verified against the actual bug by reverting the fix locally and
confirming the test fails with exactly the reported symptom before
re-applying it.

### The deliverable +/- counter could set a status it never reverted (Sep 2026)
Reported live on **SR-201; 4 Structures Preservation**, the "Final PI closeout
report" row: 1 contracted, 0 delivered, progress bar correctly at 0% — and the
status badge reading **Complete**.

`renderDeliverables()`'s progress bar is never a stored field — it is
recomputed fresh from `d.contractedQty`/`d.deliveredCount` on every render, so
it always told the truth. `status`, on the other hand, IS stored, and `adjDel
(id, delta)` (the `+`/`-` buttons) set it with a ternary that only covered two
of three directions:
```js
const newStatus = pct>=100 ? 'Complete' : newCount>0 ? 'In progress' : all[i].status;
```
Click "+" on a qty-1 milestone: count goes to 1, `pct` hits 100, status is set
to `'Complete'` — correct. Click "-" right after: count goes back to 0, but
the third branch just **kept whatever status was already there** — it never
had an "and revert" case. `deliveredCount:0` with `status:'Complete'` is
exactly the screenshot: a live, and false, claim that a report had been
delivered.

**The fix cannot just always reset to `'Not started'` at count zero** — a
deliverable can independently be `'On hold'` or `'Cancelled'` (set via the
Edit modal's own status dropdown, nothing to do with the counter), and a
delivered count of zero says nothing about whether either of those is wrong.
Overwriting them on every stray `-` click would be a second, opposite bug.
`adjDel` now only reverts to `'Not started'` when the count lands on zero
**and** the existing status is one this same function could have set
(`'Complete'` or `'In progress'`) — never `'On hold'`/`'Cancelled'`, which
came from the modal and must survive a counter click untouched.

**This app has no live path to fix the actual corrupted row** — the sandbox
that builds this has no network route to `*.supabase.co` (see the UGRC and
Storage RLS notes elsewhere in this file for the same constraint). The
production "Final PI closeout report" row needs a manual correction — open
it in the Edit modal and set Status back to "Not started" — once this fix is
deployed; the fix only stops it happening again, it does not retroactively
correct data already written wrong.

Guarded by `test/tests/54-deliverable-status-revert.test.js` (19 checks): the
exact reported shape (qty-1, `+` then `-`, Complete reverts to Not started);
the same revert for a partial-then-emptied `'In progress'` count; `'On hold'`
and `'Cancelled'` both surviving an `adjDel` call that leaves the count at
zero; and a multi-step count-up/count-down sequence (`Complete` → `In
progress` → `Not started`) landing on the correct status at every step, not
just the two endpoints. `markDelDone`/`cycleDelStatus`, two adjacent-looking
functions called from nowhere, were removed in the Oct 2026 cleanup.

### A deliverable with no contracted quantity has no percentage (Oct 2026)
Reported live on SR-201: "Website update" (no contracted qty, 6 delivered) read
**50% · In progress**; "Lane closure graphic" (same) read **0% · Not started**.
Neither number was measured. With `contractedQty` 0 every surface fell back to
the stored `progress` field, which `saveDel()` fills with a placeholder from the
STATUS (`Complete` 100 / `In progress` 50 / else 0) — and `adjDel()` never
updates it. So the bar repeated the status back as a fake percentage.
- **No target → the count, never a %.** `_delOpenEnded(d)` / `_delNoTargetHTML()`
  (next to `adjDel`) on the desktop view ("no target"; all-projects table
  "6 delivered · no target"); `—` in the PI report preview table (which the
  archive freezes) and the `.docx`; no `(N%)` in the quick report; blank in the
  Excel export's Progress % column; and `progCell()` in `client-portal.html`
  prints "6 delivered" — that fake 50% was reaching the client. Sorting by
  progress puts open-ended rows together (-1) instead of by the placeholder.
- **`saveDel()` won't store `Not started` with something delivered** — it
  saves as `In progress`, the rule `adjDel()` already applied on "+". On hold /
  Cancelled / Complete are deliberate and kept. Not retroactive: existing rows
  correct the next time they are saved.
- `progress` is still written (backward compat) and still read by
  `snapshot.trendFacts` (`pct`) — left alone so archived trend diffs stay
  comparable.
- Guarded by `test/tests/67-deliverable-no-target.test.js` (13 checks; verified
  to fail against the old code).

### Flags that updated only after a refresh (Oct 2026)
Reported live: exporting 1200 South Wastewater (PIN 700) left its card without
"Exported today" until a reload. `exportProject` / `exportPortfolio` wrote
`lastExported` to the cache and never redrew; both now call `render()`.
**A sweep of both apps** (every function that writes data, checked for a
redraw) found two shapes:
- **No redraw at all:** only the two exports. Everything else redraws, often
  through a helper (`_renderGroupsManager`, `selectIntStake`,
  `runIntegrityScan`, `openCloseoutIntake`, `_emailRerender`, `setView`).
- **Partial redraw, stale sidebar counts:** ~20 saves redraw just their own
  view (`saveIssue`/`deleteIssue`, `saveMeeting`/`delMeeting`,
  `saveComment`/`delComment`, `attachOwner`/`detachOwner`, bulk contact
  edits, unlinks, `_mvImportUntracked`…), but only `render()` refreshed the
  badges. Fixed centrally, not per call site: `_scheduleBadges()` (next to
  `_sbWrite`) runs `refreshBadges()` on the next tick after every `DB.set`,
  again when its sync settles, and after every `_sbWrite` — so a new save
  path is covered without remembering. A burst of writes costs one refresh.
- Mobile was clean: every save redraws its screen, and its two counts
  (`updateFUBadges`/`updateIssBadges`) run on every `showScreen`.
- Guarded by `test/tests/70-stale-flags.test.js` (7 checks; verified to fail
  on the old code).

### PI team list + project PI Lead + "My projects" (Oct 2026)
`sql/2026-10-09_team_and_project_lead.sql` — **must be pasted in the SQL Editor**;
until it runs the app works as before (the team list reads empty; `toSB` leaves
`lead`/`lead_history` out, gated on `window._leadCols`, which `fromSB` sets the
first time a fetched project row carries a `lead` key — so a save never 400s).
- **`pi_team_members`** — people, NOT logins (`pi_staff` is still the login
  list): name, initials (unique, case-insensitive), title, phone, optional
  email, active. Staff-only (closeouts pattern + `pi_staff_or_client`). A new
  hire goes on before they have an email. Deactivate, never delete — initials
  stay in logs and histories. Settings → **PI team** (`renderTeamCard`,
  `openTeamMemberModal`, `saveTeamMember`); "Initials in the logs with nobody on
  the list" offers one-click adds. **No staff names in the repo** (public).
- **Initials are the key**, as for `loggedBy`/`followUpAssignedTo`.
  `pi_projects.lead` = initials; `lead_history` = `[{from,to,date,by}]`
  (phase-history shape), appended by `saveProj` on change (a first lead on an
  existing project is recorded from `''`; a new project's starting lead is not).
  Changing a member's initials re-keys `lead` and history entries, passing the
  whole project record to `sbUpdate` (written while `toSB` still nulled omitted
  dates — see "Partial saves erased dates" below; harmless now).
- `_myInitials()` = the roster row whose email is the login, else
  `getLoggedBy()`. `_fuTeam()` now unions the active roster. Saving a member
  whose email prefix gives other initials warns ONLY if the typed initials have
  no logs yet (Jeff signs in on another address; the email is contact-only).
- **My projects | All** (`_projScope`/`setProjScope`/`_scopeProjects`,
  localStorage `cc_proj_scope`) on the dashboard's Active projects cards and
  both Projects tabs (tab counts follow the scope). No saved choice → "mine"
  only if you lead something. The dashboard's stats follow it too (below).
  Lead chip (`_leadChipHTML`) on both card kinds, highlighted when it's you.
- The portal does not select `lead` (explicit column lists).
- **The whole dashboard follows the toggle (Oct 2026).** `renderDash` builds
  `scopeProjs` = `_scopeProjects(Active + On hold)` and filters every data set
  by it (`inS`): stat cards, deliverables, sentiment, channels, swim lanes,
  feed, NEPA, comments/periods, LEP/EJ (stakeholders linked to scoped
  projects). "All" = every Active and On hold project. The toggle moved to
  the dashboard topbar; the project cards (Active + On hold) sit directly
  under the stat row. Lookups (`projs`, `stakes`) stay unscoped. Guarded by
  `test/tests/80-dashboard-scope.test.js` (fails on the old code).
- **Step 4 — the lead as default (Oct 2026):**
  - **Follow-ups:** the NEW interaction modal pre-selects the project's lead in
    Assign-to (`_fuDefaultToLead`, run on open and on project change), with
    the label saying so. Not when you are the lead or the lead is inactive
    (stays unassigned = whoever logged it). Once the picker is touched
    (`data-touched`) a project change leaves it alone. `_fuOwner` is
    unchanged, so existing follow-ups and mobile are untouched.
  - **Close-out signature** (`_coSeedIntake`): led by someone else → their
    team-list name/title/email/phone only (never mixed with your last
    signature); led by you → your last signature wins, team list fills gaps.
  - **Portal "Your PI contact"** (`loadPiContact` on the Overview, `.pi-contact`):
    `sql/2026-10-10_portal_pi_contact.sql` adds `pi_team_members.show_on_portal`
    (default true; "Show as Your PI contact" in the member dialog) and
    `pi_portal_contact(p_project)` — SECURITY DEFINER, returns name/title/
    phone/email of an ACTIVE, shown lead, only to a token holder of that
    project (`pi_portal_project_ids()`) or a client granted it. The team
    table stays staff-only. No row / function missing → no card, no error.
    `show_on_portal` is gated in `toSB` (`window._teamPortalCol`) like `lead`.
- **Step 5 — Team view** (`setView('team')`, nav "Team", `renderTeam`,
  `_teamWorkload`): a row per active member plus anyone (off-list or
  inactive) who still leads a project or owns an open follow-up — projects
  led (Active/On hold, buttons open the project dialog to reassign), open /
  overdue follow-ups by `_fuOwner`, interactions logged in 30 days, and how
  many of their projects' clients have had no report in 30+ days
  (`_lastClientReport` — shared PI report or status report, the dashboard
  card's "Last report" date). Banner
  lists active projects with no lead.
- The test REST shim's RPC now passes request headers as `request.headers`
  and returns rows for set-returning functions, as PostgREST does.
- Guarded by `test/tests/74-lead-defaults-and-team-view.test.js` (31 checks,
  role-switched for the function; verified to fail with each piece removed).
- Guarded by `test/tests/73-project-lead.test.js` (27 checks; verified to fail
  with the scope filter removed and with a partial-record re-key).

### Follow-up resolution note (Oct 2026)
`sql/2026-10-11_followup_resolution_note.sql` adds `pi_interactions.follow_up_resolution`
(`followUpResolution`) — **must be pasted in the SQL Editor**; until then `toSB`
leaves it out (`window._fuResCol`, set by `fromSB` on a row carrying the key,
the `_leadCols` pattern) and the box says it won't save yet.
`follow_up_note` is the ACTION; this is HOW it was resolved, optional. Both
interaction dialogs show a "How it was resolved" box (`_fuResNoteHTML`) only
while "Follow-up resolved" is ticked. One-click **Resolve** is unchanged (no
note). `saveInt` clears it when unresolved/follow-up off; `reopenFollowUp`
clears it with the date. Shown (`_fuResNoteLine`) under the action in the
Follow-ups view, the contact's log and the Follow-ups quick report; the
Follow-ups search matches it. Mobile does not map it (its edits leave it
alone). Guarded by `test/tests/78-followup-resolution-note.test.js`.

### Partial saves erased dates (`toSB`, fixed Oct 2026)
`toSB()` (index.html AND mobile.html) turned every ABSENT date column into
`null`, so any `sbUpdate` with a partial object wiped the record's other
dates. Found live from "No period set" on archived PI reports: attaching the
final .docx (`{docxPath, docxUploadedAt}`) blanked `period_start`/`period_end`
on 5 reports, and the Share switch (`{clientVisible}`) had the same shape;
"Reconcile with UGRC" (`_ugrcReconcileParcel`'s patch) blanked 5 demo
parcels' `notice_date`. Now an absent key is left OUT of the write; a date sent
as `''` or `null` still clears (the edit dialogs rely on that). The Aug 2026
note under Report archive claiming partial updates were safe was true for
lazy `snapshot` but never for dates. Live data repaired by
`sql/fixes/2026-10-09_restore_erased_dates.sql` (periods recovered from each
snapshot's `periodLabel`; parcel dates from the demo seed). `sql/fixes/` is
not applied by the harness. Guarded by
`test/tests/75-partial-update-keeps-dates.test.js` (verified to fail on the
old `toSB`).

### Events do NOT create follow-ups (Aug 2026)
The Edit-event modal's "Action items" textarea used to create a `pi_interactions`
row per line. Removed — the field is now documentation on the event record only.
Reasons, in order of severity:
- **The edit path deleted data.** It ran
  `DB.get('interactions').filter(x=>x.meetingId!==S.editId)` before recreating
  from the textarea, so re-saving an event destroyed every interaction linked to
  it (including hand-logged ones) and resurrected resolved follow-ups as open.
- **It inflated a reported metric.** Nothing anywhere excluded these rows, so
  every action item counted as an interaction in the log, the dashboard stat and
  PI report interaction tables.
- The rows had **no `loggedBy`**, so `_fuOwner()` returned `''` and the follow-up
  belonged to nobody — it could never appear in anyone's "Assigned to me".
- **No due date** (never overdue, never sorted), **no stakeholder** (rendered
  "Anonymous"), and `direction:'Inbound'` — not one of the app's three direction
  values, so the interaction filter couldn't select them.
- The hint said only the first line was tracked; the loop ran over every line.

**A follow-up belongs to an interaction or an issue** — those carry a
stakeholder, an owner and a due date. Events stay independent.
Guarded by `test/tests/11-events.test.js`.

**No data was ever created this way.** Checked against production on 2026-08-07:
zero rows match `summary like 'Event action item:%'`, `direction='Inbound'`, or
`meeting_id is not null`. The action-items text visible on demo events comes from
the seed, which writes `action_items` straight into `pi_meetings` and never runs
`saveMeeting()` — so the modal promised a follow-up that never materialised,
which is the likeliest source of the staff confusion that prompted the removal.
`meetingId` is still MAPPED (the column exists) but nothing writes or reads it.
The "N open actions" event-card badge and `delMeeting`'s interaction cascade
were removed in the Oct 2026 cleanup (live had 0 linked rows on 2026-10-11).
Never re-add a cascade: deleting an event must not delete interactions —
`test/tests/11-events.test.js` now asserts it.

### Parcel ID (`pi_stakeholders.parcel_id` → `parcelId`)
The field a ROW/property-owner campaign is tracked by. Mobile (`#add-parcel`) and
the importer (auto-detects `parcel` / `apn` / `pin` headers) always wrote it, and
the stakeholder detail pane and CSV export always displayed it — but **index.html
had no input for it**. `saveStake()` read `v('f-parc')` and no element with that
id existed, so `v()` returned `''` and **every desktop save silently blanked the
parcel id**. Import a few dozen parcel numbers, edit one of those contacts on the
desktop, and the number was gone with no warning. Fixed Aug 2026: the input now
sits under Mailing address, and `parcelId` was added to the search filter in the
master list, the stakeholders view and `filterMasterList()` so a campaign can be
worked by parcel number. Guarded by `test/tests/12-parcel.test.js`.

### Parcels (`pi_parcels` + `pi_parcel_owners`, Aug 2026)
Right-of-way tracking. Migration: `sql/2026-08-07_parcels.sql`.
**Why a table and not the contact field:** a ROW campaign is a many-to-many —
one owner holds several parcels, one parcel has several owners (co-owners,
heirs, an LLC plus its manager). `pi_stakeholders.parcel_id` is one text column
on one side and cannot represent that. Worse, with several owners the number got
typed once per owner, so a single typo split the parcel into two groups that
never appeared together again. **And the compliance unit is the parcel**: "was
every affected parcel's owner noticed, and when" is a count over parcels, and
there was nothing to count.
- `pi_stakeholders.parcel_id` is deliberately KEPT as a column — it still
  displays (labelled "imported reference"), exports, and is written by the
  importer and mobile. But the **desktop input was removed** the same day it was
  added: two places to record the same fact diverge, and one text box can only
  ever be wrong for an owner holding several parcels. `saveStake()` now carries
  the value forward via `_existingParcelId()` rather than reading the missing
  element — reading it would return `''` and silently blank the column, which is
  precisely the bug that was fixed hours earlier.
- **`pi_parcels_proj_number_uniq`** on `(project_id, lower(trim(parcel_number)))`
  is the typo guard, enforced in the database as well as in `saveParcel()`. That
  duplicate-splitting is the failure the table exists to prevent.
- **Coordinates are first-class** (`latitude`/`longitude` text): unsubdivided
  land with no dwelling can only be designated by coordinates. Same fields the
  Map view and the planned Survey123 ingestion want.
- **Situs address uses Google Places** (`initAddressAutocomplete`, shared with the
  stakeholder modal). Worth more here than on a contact — the situs address is
  where the LAND is, which for an absentee owner is nowhere near their mailing
  address. It deliberately does **NOT** fill `latitude`/`longitude` from the
  picked place: a place gives an address centroid, which on an unsubdivided
  parcel is not where the parcel is, and a coordinate on this record is expected
  to come from survey. (Auto-fill was built, then removed on that reasoning — do
  not re-add it without asking.)
  `clearStakeAddress()` was generalised to `clearAddressField(inputId)` — the
  widget can't be cleared by the user, since the visible element is separate from
  the hidden input holding the value. If Places never loads the field stays an
  ordinary text input, so the modal still works offline.
- Owner attachment is parcel-first (`_parcelOwnerRowsHTML` re-renders in place
  inside the modal, so three co-owners cost one round-trip) and reads
  contact-first via `_parcelsFor(stakeholderId)` on the stakeholder detail pane.
  The picker only offers contacts already linked to the project.
- The nav badge counts parcels with NO owner attached — the one that silently
  misses a notice sweep.
- Search matches parcel number, situs address AND owner names.
- Covered by `test/tests/13-parcels.test.js` (18 checks, both directions).
- **Mobile reads, desktop manages** — same rule as follow-up assignment. Mobile
  loads both tables and shows a contact's parcels (number, location, status,
  notice date) read-only on the detail screen, which is what you want standing at
  the parcel. Its free-text parcel input was removed for the same
  two-sources-of-truth reason as the desktop's, and `_mobExistingParcelId()`
  carries the column forward so an edit can't blank it.
- **Importer: a third tab (`parcels`), Aug 2026.** Separate from the stakeholder
  and interaction imports because a parcel is a different record — **one row per
  PARCEL, not one per owner**. `parcState` / `PARCEL_FIELDS` / `PARC_AUTO_MAP`
  mirror the interactions wizard's shape; auto-detects `parcel`/`apn`/`pin`/
  `serial`/`tax id` headers. Guardrails, all covered by
  `test/tests/14-parcel-import.test.js` (36 checks):
  - a parcel number **already on the project is skipped**, never duplicated —
    that is the table's whole reason for existing;
  - a repeat **within the same file** is skipped and names the row it duplicates;
  - **owner attachment is EXACT-MATCH ONLY** (email, then normalised full name or
    org, and only when exactly one contact matches), against contacts already
    linked to the project. No fuzzy matching, no contact creation — same
    constraint as the quick-log picker. An unmatched owner still creates the
    parcel and is flagged amber, so it becomes a visible to-do rather than a
    silently wrong link.
  - Several owners on one parcel: import the parcel once, attach co-owners in the
    Parcels view. A second row with the same number is a duplicate by design.
  - **Hardened Oct 2026** (`test/tests/64-importer-safety.test.js`, 21 checks):
    - **A failed read stops the import, on all three tabs.** `sbGet` turned a
      401/500 into `[]`, so the duplicate and match checks saw nothing and every
      row looked new — an expired sign-in would re-import a second copy of
      everything already there. Reads a check depends on go through
      `cacheLoadStrict()` (throws, never caches a failure); the step-3
      transitions and the stakeholder import's link read catch it, alert
      "Nothing was imported", and stay put. Project dropdowns stay tolerant.
    - **Parcel numbers compare without separators** — `_parcNumKey()` drops
      spaces, dashes, dots, slashes and underscores but KEEPS letters, so the
      county's `120470001` (how a UGRC draw-area import stores it) and a
      spreadsheet's `12-047-0001` are one parcel, while `A-12`/`B-12` stay two.
      Used by the importer (existing + in-file) and desktop `saveParcel()`;
      the two copies are asserted identical. **The database unique index still
      compares `lower(trim())`** — normalising it is a migration over existing
      rows and has not been decided; the app-side checks cover the common path.
    - **Optional "Owner role" column** (`ownerRole`, matched exactly against
      `OWNER_ROLES_IMP`, a mirror of index.html's `OWNER_ROLES`, asserted equal);
      blank or unknown → `Owner`, which is what every link used to get. Not on
      the `.xlsx` template, deliberately — it is optional.
    - **Deliberately NOT importable:** outreach grading (can sign / sentiment /
      concerns — staff judgment in a staff-only table), UGRC results and
      `needs_review` (the app sets them), and no merging into "Property N"
      placeholders by address (a guess: owner or renter?).
- **Reporting (Aug 2026), two surfaces, one source of truth.** `_parcelStats(projId)`
  computes everything; the quick report and the report-editor section both read
  it, so they cannot disagree about coverage.
  - **Quick report** `generateParcelReport()` — card `parcel-status`. Answers the
    four questions asked in a ROW review, in order: how many parcels; is every
    owner identified; has every parcel been noticed and when; what is
    outstanding. Scoped to `S.projectFilter`, or every project with parcels.
  - **Report-editor section** `auto-parcels` — the full five-hook wiring a new
    section type needs: `getAvailableSections()`, `getSectionDesc()`,
    `_buildSectionDraft()` (AI facts), `_buildSectionPreviewTable()`, the counts
    label in **both** `renderLivePreview` and `_buildReportSnapshot` (they must
    match or an archived header contradicts the live one), and the `.docx`
    branch in `exportPIDocx`.
  - **Distinct owners, not links** — one person holding six parcels is one
    conversation, not six. Counts reflect that.
  - AI facts are computed and handed to the model as authoritative; the model
    narrates and never counts.
  - Covered by `test/tests/15-parcel-report.test.js` (27 checks).
- **Client portal: a "Right-of-Way" nav section** (`renderParcels` in
  `client-portal.html`). Shows coverage — parcels affected, owner identified,
  notice sent, with meters — then the register. **Owner NAMES are deliberately
  withheld**: a portal token link is unauthenticated, anyone holding the URL can
  read it, and the owners are private individuals, so the client sees an owner
  COUNT per parcel. Internal parcel `notes` are withheld for the same reason.
  The consultant has both in Cirrus Cc. Guarded by `test/tests/04-client-portal.test.js`,
  which asserts the owner's surname does NOT appear in the rendered section.
- **Map layer — BUILT (Aug 2026).** `S.mapLayer` (`contacts` | `parcels` |
  `both`) toggles a parcel layer on the Map view. Parcels are SQUARES coloured
  by acquisition status (`PARCEL_MAP_COLORS` / `_parcMapColor` — a hex per
  status, distinct from `_parcStatusColor`, which returns badge class names);
  contacts stay circles. **The point of it:** the contact layer plots MAILING
  addresses, which for an absentee owner, an LLC or three heirs is nowhere near
  the land being acquired.
  - **An earlier note here claimed parcels need NO geocoding. That is only true
    of the coordinate-carrying ones.** Because the situs field deliberately does
    not auto-fill coordinates from the Places pick, most parcels have an address
    and no `latitude`/`longitude`, and those geocode exactly like a stakeholder.
    `_parcHasLoc(p)` = coordinates OR situs address; stored coordinates are used
    as-is (no API call), address-only parcels are geocoded and cached by parcel
    id in `_mvParcCache` so changing a filter never re-bills.
  - A parcel with NEITHER is **named in `#mv-errors`, never silently dropped** —
    "we can't place this parcel" is itself a ROW finding. `_mvShowNoLoc()` runs
    before geocoding, since that fact is known from the data.
  - Stakeholder-only filters (support / type / influence / role / EJ / LEP /
    colour-by) are hidden on the parcels layer; an **Acquisition status** filter
    (`S.mapFParcSt`) replaces them.
  - **"Notice sent" the STAGE is not "has been noticed".** `PARCEL_STATUSES`
    tracks where a parcel is in the acquisition lifecycle, so a noticed parcel
    that has moved to Contacted or Acquired is no longer AT the Notice-sent
    stage — the map showed 1 while the Parcels view counted 6, and both were
    right. The Parcels tile now reads "Noticed · any stage" and the map filter
    is labelled "Acquisition status", both with tooltips. The compliance
    question gets its own option, `__nonotice` ("— No notice date yet —"), which
    no status value can express. Search matches parcel number, situs address
    and owner names.
  - **Markers are labelled with the PARCEL NUMBER**, drawn into an SVG data-URI
    icon (`_mvParcIcon`) as a chip under the square — not a Marker `label`,
    which is bare text over satellite imagery and often unreadable. An earlier
    P1…Pn sequence was replaced: it correlated with nothing a client holds, and
    renumbered itself whenever a filter changed.
  - **`_mvGroupByPoint()` merges parcels that geocode to the SAME point into
    ONE marker.** A rural grid address routinely resolves to a street or ZIP
    centroid, so several parcels land on one coordinate and stack — the count
    says six and three are visible, which reads as a rendering bug. The marker
    shows the count, the popup (`_mvParcGroupHTML`) lists every parcel number
    and status so the register still correlates, and it names the fix: a survey
    coordinate on the parcel record places it exactly and costs no geocode. A
    mixed-status group is slate, never any one status's colour.
    **`_mvPrecision(p)` says WHY.** The geocode result's `location_type` is
    kept (`ROOFTOP` / `RANGE_INTERPOLATED` = exact enough; `GEOMETRIC_CENTER` =
    street centre, house number not found; `APPROXIMATE` = area only), plus
    `partial_match`. Google answers a house number it cannot find by falling
    back to the street and returning that SILENTLY with a point, which is how
    four different addresses on one rural grid road arrive on one coordinate.
    Discarding that made a geocoder limitation look like a rendering bug. Both
    parcel popups now report it, and the group popup distinguishes "these
    addresses really are the same place" from "the house numbers were not
    resolved" — different problems, different fixes. Geocode calls also pass
    `componentRestrictions:{country:'US'}`. **The contact layer still discards
    precision** — same treatment applies there if it ever matters.
    **Nudging them apart was tried first and was wrong twice over** — at any
    normal zoom ~25 m is a couple of pixels so the chips still overlapped, and a
    radius large enough to separate them would put a parcel on the wrong side of
    the road, inventing precision the data has not got. Do not re-add it.
  - **The status line is rewritten after render** (`#mv-count`) to report what
    actually plotted, not what was placeable. It previously said "6 of 6" over
    three markers, which is how a geocode failure disguises itself.
  - `_mapPrint()` covers both layers. Static Maps takes no custom shapes and its
    label is a SINGLE character, so parcels are keyed 1-9 then A-Z
    (`_mvPrintKey`) and the printed table's first column carries the same key —
    map and table still correlate on paper.
  - Covered by `test/tests/19-map-parcels.test.js` (28 checks). Google Maps
    can't load in the harness, so it covers everything up to the map object.
- **ROW register export (Aug 2026)** — "Print register" and "Export .xlsx" on the
  Parcels view. The working document for the sponsor and a hired ROW agent.
  - **Two sheets, because two readers.** `Parcel register` = one row per PARCEL
    (coverage). `Mailing list` = one row per PARCEL x OWNER — what a notice
    mailing is run from. Three heirs make three rows; one owner across two
    parcels makes two. That is how several mailing addresses on one parcel
    resolve without stuffing them into a cell.
  - **The mailing address is the OWNER's** (`pi_stakeholders.address`) and is
    routinely nowhere near the situs. Both columns are carried side by side.
  - A parcel with **NO owner still gets a mailing row**, flagged. Dropping it
    would hide the case that matters most.
  - **The export ignores the search and status filters** — deliberately. A
    filtered file looks complete once it has been emailed.
  - **The Project column appears only when the export spans projects.** Scoped
    to one, it repeated the same value down every row; the project is named in
    the print header and the .xlsx filename instead. Unscoped it must stay or
    the rows are ambiguous. `_rowRegCols(withProj)` / `_rowMailCols(withProj)`
    build both shapes — index columns BY NAME, not position.
  - **Two print-only formats, via `_rowRegisterRows(forPrint)` / `_rowMailingRows(forPrint)`.**
    The .xlsx always carries raw values so the columns still sort and filter.
    - **Dates read mm-dd-yyyy.** The print view formats via `_rowDateUS()`. The
      .xlsx does NOT hold text: `_xlsxDateSerial()` writes a real Excel date
      serial with a `mm-dd-yyyy` numFmt (style 3), so it displays as asked AND
      still sorts as a date. Text reading "03-04-2026" sorts alphabetically —
      every March above every December — which is useless in a file whose whole
      point is to be sorted. The row builders still yield ISO; the sheet writer
      converts. **Only the ROW register was changed** (Aug 2026, deliberate
      scope): `fmt()` still gives "Mar 4, 2026" everywhere else and `_fmtMDY()`
      still gives mm/dd/yyyy in PI report tables.
    - **Notice sent** — `_rowNotice()`. A CHECKBOX was considered and rejected:
      URA/FHWA timelines run FROM the notice date, so "when" is the compliance
      fact and "whether" is only its shadow. What the date alone hid gets called
      out instead — a blank cell now reads `⚠ Not sent` (the row somebody has to
      act on), and a FUTURE date reads `(scheduled)` rather than looking
      identical to a sent one. `⚠` cells print bold red so they survive a
      black-and-white printer.
    - **Coordinates: full in the .xlsx, 3 decimals in the print view.** Free-text lat/lng can arrive with a float's full tail
    (41.241355781290835), which is unreadable in an on-screen table but is real
    data in a file the ROW agent works from, so a column width is not a reason
    to drop it. 3 dp is ~110 m: fine for reading, NOT enough to identify a
    boundary — never round the file.
  - `_xlsxBuild()` writes a real .xlsx on the **JSZip already embedded** for the
    .docx export (no new dependency, nothing fetched). Inline strings, no
    sharedStrings; frozen header + autoFilter; dates as ISO so they sort as text
    anywhere and import as dates in Google Sheets.
  - Covered by `test/tests/23-row-export.test.js` (44 checks) which unzips the
    blob and parses the XML. Verified separately against **openpyxl** — note
    LibreOffice is broken in the dev container and rejects even a textbook
    minimal .xlsx, so it is NOT a usable validator here.
  - **Google Sheets sync is NOT built and is staged deliberately.** Push
    (Cirrus Cc -> Sheet, `drive.file` scope, client-side OAuth) is safe; a
    read-back must be a REVIEWED import (diff -> human accepts), never
    bidirectional auto-sync — the register is a compliance record and an
    unattended writer has no attribution. Needs an OAuth client ID from Jeff.
- **Deliberately NOT in the PI report, and NOT in the client portal.** In the
  report a map would mean a Static Maps call plus a stored image; if a client
  asks, Print/export is the supplemental attachment. In the portal it would be
  worse than a cost: a portal token link is UNAUTHENTICATED, so every reload by
  anyone holding the URL would bill a dynamic Maps load plus geocodes, with no
  ceiling. If a portal map is ever wanted, persist the resolved coordinates
  first — in their OWN columns, not `latitude`/`longitude`, which are
  survey-grade — and render from stored points or a single cached static image.

### Project scoping per view
`S.projectFilter` is the **single** shared scope, written by the project select
on **interactions, followups, deliverables, reports, meetings, commitments,
parcels, issues and comments**. `master` is the cross-project list by definition
and is deliberately never scoped.

**Issues and Comments used to keep their own** (`S.issViewProj`, `S.cmtProj`),
and `setView()` cleared both on every navigation — so scoping Interactions to a
project and clicking Issues landed on "All projects". Comments was subtler: it
read `S.cmtProj || S.projectFilter`, so it filtered correctly while its select
still displayed "All projects", which is worse than not filtering because it
tells you you are seeing everything. Both keys are **removed**, not bypassed —
a leftover reference would silently reintroduce the split. Guarded by
`test/tests/28-project-scope.test.js`, which walks every scoped view and asserts
the select SHOWS the project, not just that the list is filtered.

The Comments "Clear" button no longer clears the project: the scope is shared
now, so clearing it there would unscope the whole app. If you add a list view,
give it a selector and wire it to `S.projectFilter` — nothing else.

### Navigation views
`dashboard | projects | master | stakeholders | interactions | followups | commitments | comments | tribal | deliverables | meetings | issues | map | reports | settings`

### Key functions (search `function <name>(` — line numbers drift with every edit, so none are kept here)
- `render()` — main dispatch
- `renderDash()`
- `renderMaster()` — stakeholder master list
- `renderStakeholders()`
- `renderInteractions()`
- `renderReports()` — Reports view with 3-tab layout (Quick Reports / PI Report Editor / Archive)
- `openPIReport()` — replaces main area with split-pane PI report editor
- `exportPIDocx()` — async, exports the Word file. Does NOT archive —
  archiving is deliberate, via "Save to archive" (`manualArchiveReport()`).
- `renderMeetings()`
- `renderTribal()`
- `renderComments()`
- `renderSettings()`

## Reports module (most recently worked on)

### An anonymous interaction is EXTERNAL (`_intIsExternal`, Aug 2026)
Report sections that show "External only" filtered by membership of the
project's external contact list. An anonymous caller has no `stakeholderId`, so
`indexOf()` never matched and every one was dropped — the public was excluded
from the public-concerns section precisely because nobody took their name. The
only way to see them was to tick "include internal stakeholders", which then
pulled the project team into a report about public concern.

`_intIsExternal(i, externalIds)` is now the single rule: **no stakeholder id →
external**. It replaced eleven hand-rolled copies of the same filter across the
section tables, the AI facts builder, the report snapshot and `exportPIDocx` —
fixing one and not the others would have left the on-screen report and the
client's .docx disagreeing about how much public contact there was. That count
is a compliance figure, so under-counting is a reporting error, not a display
quirk. Guarded by `test/tests/30-anonymous-external.test.js`, which also asserts
no raw `externalIds.indexOf(i.stakeholderId)` survives in any of them.
`renderLivePreview`'s two COUNTS-label filters were the twelfth and thirteenth
copies — missed in the first pass because they build the "N interactions in
period" chip rather than a table, so the label under-counted the very rows
listed beneath it. Every `externalIds` array is now built with `String()` to
match the rule's own comparison; `project_id`/`stakeholder_id` types are mixed
across tables (see the schema-fidelity section), so that is not paranoia.

### Report package executive summary — only the reports chosen (Oct 2026)
Quick Reports → **Build report package** → "Generate with AI". Reported live: a
package of Interaction log + Deliverables + Events opened with sentiment,
follow-up and issue facts — reports it didn't contain. `_buildPackageFacts`
gathered every report type regardless of the selection, and the call used
`_claudeSystemPrompt()` (capped at 2-4 sentences).
- `_pkgSelectedIds()` reads the numbered reports in package order;
  `_buildPackageFacts(projF, ids)` builds one fact block per CHOSEN report,
  each from that report's own scope (interaction log honours the internal
  toggle; follow-ups cover all interactions, as the report does).
  `_pkgSummaryRequest()` is the one place the call is shaped: an orienting
  sentence, then one paragraph per report in order, ~60 words each and ~140
  for the interaction log, under `_claudeSectionSystemPrompt()`.
- **The interaction paragraph reads the log** (newest `PKG_SUMMARY_LOG_LINES`
  = 60, trimmed to 220 chars), so it can say what contact was about, not just
  "recurring themes". Counts are computed and authoritative; outbound and
  inbound separate; who = `_coWho()` (type/organization, never a name); the
  project is "this project". Nothing numbered → no call, a toast says so.
- **Also fixed:** the Quick Reports' external filter (`generateReport`) was a
  raw `externalStakeIds.indexOf(i.stakeholderId)` — the Aug 2026
  `_intIsExternal` sweep missed it under that name — so every quick report
  and package dropped anonymous callers. Now `_intIsExternal`.
- Guarded by `test/tests/72-package-exec-summary.test.js` (18 checks;
  `_claudeNarrative` stubbed; verified to fail on the old code).

### The report-period label belongs to ONE section (`_periodLabel`, Aug 2026)
The counts chip under every auto section was prefixed "19-day report period · ".
Only **`auto-concerns`** is actually bounded by `pstart`/`pend`. Deliverables,
the contact list, commitments, issues and parcels show the project's CURRENT
state regardless of the header dates, so the prefix claimed a window that was
never applied — "19-day report period · 7 deliverables" is not a subset of
anything. `auto-intlog` was worse than noise: it lists interactions from BEFORE
`pstart`, i.e. exactly the rows the period excludes.

`PERIOD_SCOPED_TYPES` (next to `TABLE_ELIGIBLE_TYPES`, ~line 10260) is the list;
`_periodLabel(secType, pstart, pend)` is the only thing that builds the string.
It must stay the only one: `renderLivePreview` and `_buildReportSnapshot` both
call it, and if they drift the archived compliance record's header contradicts
the report that was on screen when it was issued. Guarded by
`test/tests/31-period-label.test.js`, which asserts both surfaces agree and that
neither hand-rolls the string.

### The report has ONE prose voice (`RPT_PROSE_CSS`, Aug 2026)
The overall summary printed 13px upright #222; every section narrative — which
is what the AI drafts — printed 12px **italic** #444. Same writer, same page,
type changing halfway down, so the AI-drafted sections read as a caption on the
table below them rather than as the report's own text. The `.docx` did the same
thing in Word run properties: `bodyRpr` (Arial 10pt upright #3B3838) for the
overall summary, `italicGrayRpr` (9pt italic #595959) for every section.

`RPT_PROSE_CSS` is the single declaration; `RPT_OVERALL_CSS` and
`RPT_SECSUM_CSS` append it to their own containers — the tinted box and the left
rule stay, because sameness of TYPE was the point, not sameness of container.
**Four surfaces carry this prose and all four must move together**: the live
preview, `_buildArchivedPreviewHTML`, `client-portal.html`'s
`renderArchivedReportHTML` (a fourth hand-written copy — the portal imports
nothing), and `exportPIDocx` (now `bodyRpr`, not `italicGrayRpr`).
`italicGrayRpr` is still correct for the things that ARE captions — the period
label, the "interactions prior to…" note, the export footer. Guarded by
`test/tests/32-report-prose.test.js`, which reads computed styles on the first
two, unzips the generated `.docx` for the third, and diffs the portal's copy as
text.

### The concerns narrative is budgeted in WORDS, not sentences (Aug 2026)
`_sectionAIRequest('auto-concerns')` asked for "5-8 sentences". The model
complied on the count and blew past the intent — 265 words in six sentences of
40-plus words each, a wall of prose above a table that already carries the
detail. A sentence count cannot constrain length; it says nothing about how long
a sentence may be. Now: **about 175 words, hard ceiling 190**, `maxTokens` 900 →
450 (the headroom is so a slight overrun ends on a finished sentence instead of
being clipped mid-word).

**The cut must come out of elaboration, never out of topics.** The prompt says
"compress, do not omit" and still requires every distinct theme, because how
much public concern was raised is a compliance figure — a narrative that quietly
drops a theme to hit a word count is a reporting error. "Draft all sections"
reuses `_sectionAIRequest`, so both paths get the same instruction and budget;
keep it that way or the batched copy comes out a different length from the
per-section button's.

### The overall summary is scoped to the report, and outbound ≠ inbound (Sep 2026)
`_buildOverallDraft()` (feeds `_overallDraftCall()`, which deliberately never
sees the other sections' drafted text — see its own comment) had two problems,
both found by reading the code rather than assuming from its output:

1. **It ignored which sections were actually checked into the report.** It
   pulled deliverable progress, issue/commitment alerts and the stakeholder
   sentiment mix from the WHOLE PROJECT unconditionally. A report with only
   "Recent public concerns" selected could still have its overall summary cite
   a fact — an overdue commitment, a sentiment split — that appears nowhere
   else in the document. That's an unsupported claim in a compliance record,
   even when the fact is true of the project generally: the reader can't check
   a number the report never shows them. Fixed with `hasSec(type)` reading
   `loadReportSections(projF).sections` — deliverables/issues/commitments/
   sentiment facts are now only gathered when `auto-del`/`auto-issues`/
   `auto-commitments`/`auto-sentiment` is in the report, and the whole
   interaction-based block (outreach counts, most-engaged stakeholder, top
   topics) only runs when `auto-concerns` or `auto-intlog` is.
2. **It folded outbound and inbound interactions into one undifferentiated
   count, and keyword-scanned ALL of them for "topics raised."** A project
   whose early activity is mostly the team notifying stakeholders (mass flyer
   emails, phone referrals to the project website — the primary Quick Log use
   case, see that section above) would have the team's OWN outreach language
   ("sent detour exhibit for review") scanned and reported back as what the
   public raised — exactly backwards, and worse the earlier in a project's
   life the report runs, since that's precisely when outbound notification
   is most of what has happened yet.
   **The fix keeps outbound work in the narrative — it just gets its own
   clause.** `periodInts` is split into `outboundInts` (`direction ===
   'Outgoing'`) and `inboundInts` (everything else). The outreach sentence
   now reads "sent N outbound project notifications and logged M inbound or
   in-person stakeholder interactions" as two clauses, not one blended count,
   and states explicitly when inbound is zero ("No inbound public inquiries
   have been received to date") rather than silently omitting it — an early,
   notification-only period is real, reportable work, and the absence of
   inbound contact yet is itself a fact worth stating plainly, not hiding.
   "Most engaged stakeholder" and the keyword-scanned topics sentence both
   moved to `inboundInts` only, and are skipped entirely when it's empty — a
   stakeholder the team merely notified several times was not "engaged," and
   there is nothing to report as "raised" when nobody has raised anything yet.
   Guarded by `test/tests/48-overall-summary-scope.test.js` (18 checks):
   asserts an all-outbound period gets the honest two-clause treatment and
   skips the engagement/topics sentences; a mixed period keeps both clauses
   and scopes topics to inbound only; and deliverable/issue/commitment/
   sentiment facts each appear only when their section is in the report and
   are absent otherwise, on the identical underlying data.

### The overall summary's PROMPT needed fixing too — not just its facts (Sep 2026)
Live feedback on real generated reports, after the fact-scoping fix above had
already shipped: the prose itself still had problems the facts alone couldn't
cause.
1. **It opened with the project's NAME, every time.** `_buildOverallDraft()`'s
   sentence 1 led with `"ProjectName (Client) is currently in the X phase."`,
   the model tends to mirror that opening line closely since it's handed as
   "PROJECT FACTS," and `_overallDraftCall()`'s own `userContent` additionally
   said `for project "X" (PID)` — two reinforcing cues to name a project the
   report header already names. Fixed in both places: the deterministic
   opener now reads `"This project ..."`, and the userContent no longer
   passes the name/PID at all. `_claudeExecSystemPrompt()` also says so
   explicitly now — "never by its name" — since the instruction is what
   holds once the AI paraphrases rather than echoes the facts verbatim.
2. **"Identify the single most consequential development of the period"
   invited editorializing about the outbound/inbound gap.** A PI team's real
   workflow front-loads outbound notification — mass flyer emails, referral
   calls — well before any inbound reply is expected, so an early report
   handed a big outbound number and a near-zero inbound number, then told to
   find "the most consequential development," would draw a conclusion from
   that gap as if it meant something. It doesn't; it's the normal, expected
   shape of early PI work. That framing is gone from the system prompt,
   replaced with an explicit instruction: state the outbound/inbound volume
   plainly, never characterize the gap as an imbalance or a finding. The
   `userContent` says the same thing a second time — the section-level
   prompts in this app have always reinforced instructions in both places
   (see `_claudeSectionSystemPrompt()`/`_sectionAIRequest()`), not just relied
   on the system prompt alone.
3. **The prose read at roughly a college level; a PI report is read by
   agency staff and the public, not policy analysts.** The system prompt now
   asks for "about a 9th-10th grade reading level: short sentences, everyday
   words, no jargon beyond the standard PI/NEPA terms already used elsewhere
   in the report" — a concrete target, not just "use plain language," which
   the earlier version already said and which evidently wasn't concrete
   enough to hold.
4. **"Deliverable / scope status" (`auto-del`) is no longer a DEFAULT
   section** (`getDefaultSections()`) — not every project tracks deliverables
   the way this section expects, and a brand-new report shouldn't open with
   a section a consultant has to notice and remove. It's still a real,
   addable section in `getAvailableSections()`; only the default changed.

Model choice was raised and deliberately left alone: the fix here is a
prompt-engineering problem (tone, framing, what the model is asked to look
for), not a capability gap Sonnet has and Haiku doesn't. Swapping models for
just this one call also risks breaking `RPT_PROSE_CSS`'s "one prose voice"
guarantee — the overall summary sits on the same page as Sonnet-drafted
section narratives, and a different model is a real way for the voice to
drift between them even with an identical prompt. `_overallDraftCall()`
still calls `_claudeNarrative()` with no explicit model argument, i.e. its
default (`CLAUDE_TEXT_MODEL`, Sonnet 5.5 since Oct 2026).

Guarded by `test/tests/51-overall-summary-tone.test.js` (16 checks): asserts
`getDefaultSections()` excludes `auto-del` while `getAvailableSections()`
still offers it; the system prompt's own wording (names the project as "this
project," drops the old "most consequential" phrase, frames the
outbound/inbound gap as normal, states a concrete reading-level target); the
deterministic opener says "This project" and never the project's actual
name, using a deliberately identifying fabricated name to prove it; and,
driving `generateOverallDraft()` for real with `_claudeNarrative` stubbed
(same technique as `test/tests/34-draft-all-parity.test.js`), that the
`userContent` actually sent to the model carries none of it either.

### "Include data table" hid the table in the .docx, not the data (Sep 2026)
Every `TABLE_ELIGIBLE_TYPES` section's `.docx` renderer (`_buildDocxWithTemplate`)
had a THIRD state the checkbox never offered: `showTable` on printed a Word
table; off, with items present, fell back to a full **bulleted itemization of
every underlying record** — names, org, channel, one-line summaries, issue
descriptions and resolution text, even an issue's linked interactions —
instead of the "nothing beyond the narrative and the counts" the live preview
(`renderLivePreview`) and the archived snapshot (`_buildReportSnapshot`) both
correctly show when the box is unchecked. Affected: `auto-concerns`,
`auto-intlog`, `auto-followups`, `auto-del`, `auto-comments`,
`auto-comment-matrix`, `auto-events`, `auto-commitments`, `auto-issues` — nine
copies of the same shape. `auto-pi-compliance` was NOT affected — its
non-table fallback was already aggregate-only, no per-record leak, and stayed
untouched.

Reported live: a consultant unchecked "Include data table in report" on
auto-concerns, the Live Preview correctly showed no interaction list, and the
exported `.docx` still printed every named stakeholder contact as a bulleted
line. **That is a compliance/privacy defect, not a cosmetic one** — the
checkbox promised to keep individually identifying records out of a document
that gets distributed to a client, and silently kept them in, in a format
nobody previewed before export. `auto-issues` was the worst of the nine: its
fallback included the full issue description, resolution summary, AND every
linked interaction's name/channel/summary — none of which the table view ever
showed even when checked.

Fixed by removing each type's itemized-dump `else` branch entirely — matching
`auto-contacts`, which never had one. Where an aggregate summary line already
printed unconditionally above the branch (deliverable %, follow-up
open/resolved/total, commitment open/fulfilled/total, etc.), it stays; only
the per-record fallback went. `auto-issues` needed restructuring since its
"N issues total · M open" line used to be duplicated inside both branches —
hoisted to print once, unconditionally, ahead of the table-only block.

Guarded by `test/tests/50-docx-table-toggle-parity.test.js` (38 checks):
fabricates one marker-tagged record per affected type, exports twice (every
checkbox off, then every checkbox on) and asserts NONE of the itemized
markers appear in the off export while the aggregate lines still do, and ALL
of them appear in the on export (proving the checkbox still works, not that
the feature was removed outright). Two things this test turned up along the
way, matching a gotcha already documented elsewhere in this file:
`loadReportSections()` prefers a `_syncCache.reports`/Supabase draft over
localStorage, so a second export in the same session needs the FIRST
export's persisted `pi_reports` row deleted for real (not just the in-memory
cache cleared) or it silently wins over the second export's fresh section
config.

### The UDOT logo lives in TWO places — update both (Aug 2026)
Replaced Aug 2026 with the navy beehive mark (`UDOT_Logo_Blue.png`, 1000x258,
transparent, kept in the repo root as the source of record). It is embedded
twice and neither copy reads the other:
- **`window._srUdotLogo`** (~line 498) — a data: URI, used by `_rptBrandHeader()`
  for the HTML quick reports, the print package and the archived-report preview.
- **`word/media/image2.png` inside `window._piDocxTemplateUdot`** — the .docx.
  (`image3.png` in the same header is the product mark — Cirrus Cc since Oct 2026,
  swapped with `--drawing 2`; see "Brand: Cirrus Cc". Leave it alone when swapping UDOT.)

A client can receive both from one project on the same day, so a swap applied to
one and not the other ships two different UDOT logos under one firm's name. That
is what `test/tests/36-brand-logo.test.js` guards: it asserts both copies are the
**same bytes as the .png in the repo**, which survives a future logo change
without needing to be rewritten.

**`tools/swap-letterhead-logo.js`** does the .docx side —
`node tools/swap-letterhead-logo.js udot <logo.png>` (`--dry-run` to preview).
The data: URI is a plain base64 replace. **The .docx half is not just a byte
swap:** `header1.xml` pins the image to an explicit `<wp:extent>` in EMU, so a
replacement with a different aspect ratio gets stretched to the old box. The
tool keeps the template's HEIGHT (523745 EMU / 0.57", which is what keeps the
logo level with the product mark) and recomputes the width — 1615044 → 2030019
EMU here, since the new mark is 3.88:1 against the old 3.08:1. It finds the part
by following `header1.xml`'s first drawing through its relationship, never by
file name (numbering differs across the three templates), and refuses a format
change rather than producing a file Word will not open.

Resolution: 1000px drawn at 2.22" is **450 DPI**, up from 600px at 1.77" (340).
Upscaling the PNG would add pixels, not detail — only a higher-res original or
the vector source would. `client-portal.html` carries no UDOT branding at all.

**A picture in a .docx drawing is sized in TWO places, and the tool only ever
patched one — the UDOT logo shipped visibly stretched in Word (Sep 2026).**
`<wp:extent>` on the inline anchor and `<a:ext>` one level in, inside
`<pic:spPr><a:xfrm>`, are supposed to agree; Word actually draws from the
inner one. The tool's old code patched the inner `<a:ext>` by **searching for
the OLD `<wp:extent>`'s text** — a `.replace()` against a string that doesn't
occur is a silent no-op, not an error. On the real UDOT template the two had
already diverged for unrelated reasons before the tool ever ran (the inner
`<a:ext>` carried something close to the template's ORIGINAL pre-swap numbers,
not whatever `<wp:extent>` happened to say), so the outer extent got correctly
updated to the new logo's 3.88:1 ratio and the inner one silently kept
~3.08:1 — a real, visible distortion, reported by Jeff from the exported
.docx open in Word. `test/tests/36-brand-logo.test.js`'s existing aspect-ratio
check only ever read `<wp:extent>`, so it passed the whole time; it now also
reads the inner `<a:ext>` per drawing and asserts the two ratios agree —
confirmed to fail against the un-fixed file with exactly this symptom before
the fix, not just after.

Fixed by locating both extents **structurally** — wherever they actually sit
inside the FIRST `<w:drawing>...</w:drawing>` block — instead of assuming the
inner one's old value; the tool now also dies loudly (before writing anything)
if the rebuilt package's own two ratios still disagree, so this exact failure
mode can't ship silently again. Corrected in place by re-running
`node tools/swap-letterhead-logo.js udot UDOT_Logo_Blue.png` against the same
already-correct source file — the outer extent was untouched (it was right),
only the inner `<a:ext>` moved, from `1672304×542314` (3.08:1) to
`2030019×523745` (3.88:1, matching `<wp:extent>` exactly).

### The .docx letterhead is FIRST PAGE ONLY (`_firstPageHeaderOnly`, Aug 2026)
Word needs two things together: the letterhead registered as the **first-page**
header (`<w:headerReference w:type="first">`) AND `<w:titlePg/>` in the section
properties. Without `titlePg` a "first" reference is ignored and **no** header
prints anywhere — so the two must always be applied as a pair.

The **Sunrise** template was authored correctly. **UDOT and Sunrise Alt** carried
their letterhead as `w:type="default"` with no `titlePg`, so the full graphic
repeated at the top of every page of a ten-page report — including the copies
sent to clients. `_firstPageHeaderOnly(docXml)` rewrites the section properties
at export time (it does not touch the embedded templates): converts a default
header reference to `first`, drops it if a `first` one already exists, and
inserts `titlePg` **in schema position** — after `<w:cols/>`, before
`<w:docGrid/>`, or Word rejects the file. Idempotent, so it is safe over the
template that already complies.

- **FOOTERS are deliberately untouched.** A page number or firm line belongs on
  every page; the Sunrise template's default footer is intentional. Never
  generalise this helper to `footerReference`.
- Applied by all three template-based exporters — `_buildDocxWithTemplate` (the
  PI report) plus `exportIssuesSummaryDocx` / `exportIssueSingleDocx`, where it
  is a no-op today and insurance against a template swap.
- Letterhead **off** still strips everything: `_stripLetterheadFromZip` runs
  after and removes the references, `titlePg` and the header part.
- The HTML print package is a **separate, deliberate choice** — it repeats the
  letterhead on every printed page (see `_openRptPopup`). Don't "fix" it to
  match without asking.
- Guarded by `test/tests/33-docx-first-page-header.test.js` (39 checks), which
  exports a real file per brand and reads the section properties back out.
  Verified independently with **python-docx**: before the fix Sunrise Alt and
  UDOT report `different_first_page = False` with content in the every-page
  header; after, `True` with content in the first-page header and an empty
  every-page header, footers unchanged.

### "Draft all sections" makes the SAME calls as the section buttons (Aug 2026)
It used to be ONE batched call — every task concatenated into a single prompt
with a JSON reply contract — and it produced visibly shorter, thinner narratives
than pressing each section's own **✦ AI Draft**. Three causes, none visible in a
diff:
1. **The per-section retry used the wrong system prompt.** Whenever the JSON
   failed to parse, it re-drafted every section with `_claudeSystemPrompt()` —
   the GENERIC prompt, which caps output at *"2-4 sentence narrative
   summaries"*. `_claudeSectionSystemPrompt()` exists precisely because that cap
   truncates the richer sections. It also hardcoded 600/undefined tokens instead
   of the section's own budget.
2. **The overall summary was drafted under the SECTION prompt** rather than
   `_claudeExecSystemPrompt()`, from a near-copy of the individual button's
   instruction instead of the instruction itself.
3. **One response carrying N narratives as JSON** makes the model ration length
   however generous the shared ceiling is, and a reply clipped mid-JSON threw
   away every narrative in it.

**The batch's justification did not hold.** "The project context is sent once
rather than once per section" was never true: the facts are built PER SECTION
(`_buildSectionDraft` / `_buildConcernsAIFacts`), so batching only concatenated
the same text. Measured on a real 8-section report the entire saving was the
repeated system prompt — **~570 input tokens, about $0.002** at Sonnet pricing.
That is what the short narratives were being traded for.

Now: **N+1 ordinary calls run concurrently** (`_mapLimit`, 4 in flight), each
identical to what its own button sends. `_sectionDraftCall()` and
`_overallDraftCall()` are the single place each kind of narrative is requested,
and BOTH entry points go through them — parity is by construction, not by two
code paths being kept in step by hand. A section with no facts is **skipped**,
exactly as its own button refuses one; the batch drafted them off an empty facts
block, which invites the model to invent engagement. Guarded by
`test/tests/34-draft-all-parity.test.js` (39 checks), which stubs
`_claudeNarrative`, drafts the same report both ways and asserts the system
prompt, instruction, token budget and model match **byte for byte** — plus that
the capped generic prompt reaches no report narrative.

### Reports view tabs (S.rptTab)
- **`'reports'`** — summary stats bar, distribution group checkboxes, 10 report-type cards
- **`'pi-editor'`** — landing card with draft status + "Open editor" button (opens split-pane `openPIReport()`)
- **`'archive'`** — `_buildArchiveHTML()` output with AI trend button
- **`'closeout'`** — `_closeoutTabHTML()`, the PI Close-Out (below). While
  `S.coId` is set, `renderReports` hands the whole view to
  `renderCloseoutIntake()` or `renderCloseoutReport()` (by `S.coView`; own
  topbar, like the report editor); `setView` clears `S.coId`.

### PI Close-Out — step 1 of 6 BUILT: the intake (Oct 2026)
The final deliverable to the client (for UDOT, the Region SCM), modelled on
Jeff's `pi-closeout-report` skill and the 19739 / 17894 packages. Table
`pi_closeouts` (`sql/2026-10-03_closeouts.sql`) — **one row per close-out, not
per project**: a Final plus optional interims ("Year 1"), Final listed first.
**Staff-only** (`not pi_is_portal_client()`, anon revoked): the intake holds
internal narrative pointers and is a working draft, never client-facing.
- **TYPE-DRIVEN.** `report_type` keys `CLOSEOUT_TYPES`; only
  `'udot-construction'` (UDOT Construction-Phase PI Close-Out) exists. ROW,
  water-use study and NEPA/EA close-outs are planned as further TYPES reusing the
  same field kinds (`project`, `reline`, `compass`, `rows`, `deliverables`,
  `newsletterCount`, `metrics`, plus plain inputs) — a new type is a config
  entry, not a schema change. Do not bend the construction type to fit them.
- **Counts are NEVER stored.** `_closeoutFacts(projId)` computes interactions,
  inbound calls (Phone · Incoming), stakeholders, archived PI reports, events,
  issues, commitments kept, deliverables live. The intake only holds what
  Cirrus Cc cannot know. A typed **override** is allowed per metric and is to be
  footnoted in the report as the consultant's figure.
- **Only recipient and signature are required.** An empty optional section reads
  "Left out of the report" — it is omitted, never padded. `_coSectionState` is
  the one rule; the tab card and the intake header both go through `_coOverall`
  so they can't disagree.
- **Newsletter edition count** comes from newsletter deliverables with a
  contracted quantity (sum of `deliveredCount`); `null` when none is tracked,
  and the intake then asks for a typed count and says why.
- **Delivery-against-scope wording defaults from the deliverable's status**
  (`_coDefaultWording`) so an untouched row can never claim "Delivered" for a
  deliverable Cirrus Cc has as Not started. Saved per deliverable id under
  `intake.deliverables[id] = {wording, evidence}`.
- New close-outs carry the **signature block** from this user's most recent
  close-out (signature keys only), suggest the **UDOT region** from the
  project's county (`UDOT_REGION_BY_COUNTY`; unknown county → no guess), and
  date to today.
- Autosave: `_coSet` → `_coSaveSoon` (700 ms) → `_coSave`, serialized; a failed
  save stays dirty and retries on the next edit or on leaving.
- Attachment stitching (weekly reports, logs, photos into one PDF) stays
  OUTSIDE the app — `merge_package.py` via the skill.
- **All six build steps are done** (step 6, charts, below), and the comm-log
  model is chosen (Sonnet 5.5, step 5). Tribal stays parked. A separate ROW close-out TYPE is planned for
  projects where ROW outreach is the whole engagement.
- Covered by `test/tests/55-closeout-intake.test.js` (50 checks).

### PI Close-Out — step 2 BUILT: the report document (Oct 2026)
"Report" (on the tab card, and "Report →" in the intake topbar) opens
`renderCloseoutReport()`: narrative slots on the left, a live page preview on the
right, letterhead select and **Export .docx** in the topbar. `S.coView`
(`'intake'`|`'report'`) picks which screen `renderReports` hands the view to.
- **ONE document model, two renderers.** `_coReportDoc(co)` builds the report
  as a list of blocks (`p` with runs, `section`, `title`, `break`, `todo`);
  `_coBlocksHTML` renders the preview and `_coBlocksDocx` the WordprocessingML.
  Nothing builds report content anywhere else — that is what keeps the preview
  and the client's file identical. Add a section by adding blocks in
  `_coReportDoc`, never by writing XML or HTML for it separately.
- **Prose lives in `intake.draft[slot]`**, one paragraph per line: `letter`,
  `hl-<id>` (seven PI Highlights, `CLOSEOUT_REPORTS[type].highlights`),
  `commlog`, `lessons` (a line `Heading: text` prints as a bold run-in heading).
  Steps 4–5 draft INTO these same slots, so the consultant always edits one
  place. `_coSet` handles `data-dr`.
- **Everything else is assembled from the intake**: address block, date
  (mm/dd/yyyy), Re: line, salutation (derived "Dear <name>," when none typed),
  signature, and the link lists under highlights — news, website + project
  email (mailto), newsletter editions WITH a link, social posts with an indented
  `comment sample:` line (`@user: text` → bold user). Links print as their
  label and are real hyperlinks (External relationships `rIdCoL<n>`, added to
  `document.xml.rels` at export); the raw URL never prints. `_coSafeUrl` only
  makes http(s)/mailto live — a `javascript:` or blank URL prints its label
  with a `[link missing]` flag rather than vanishing.
- The region select stores "Region One"; the letter prints "UDOT Region One",
  and an office address whose first line is the same region (either spelling)
  doesn't repeat it.
- **Placeholders are yellow highlights in both renderings** (`hl` runs):
  missing recipient, address, letter body, a highlight heading that has links
  but no text, the photo-gallery spot. Export counts them (photo spot excluded)
  and `confirm()`s before writing — finishing in Word is allowed, shipping one
  unnoticed is not.
- **Inclusion rule:** a highlight heading prints only with text or links; the
  highlights, comm-log and lessons sections only when they have content.
  Commitments to the Public only when the project has commitments. Each section
  shows an "In the report / Left out / Next step" pill with the reason.
- `todo` blocks marked what step 3 would build; step 3 replaced them all (the
  renderers still skip `todo` on export if one is ever used again).
- **Letterhead**: the skill's `SCM_CloseOut_Template.docx` is the SAME Sunrise
  letterhead as the embedded `_piDocxTemplate` (header/footer images byte-identical),
  so it is reused, not embedded again. Per close-out choice in
  `intake.letterhead` (default Sunrise; Sunrise Alt / UDOT / off). Off strips
  the header but keeps every hyperlink relationship. `_firstPageHeaderOnly`
  applies as everywhere else.
- File name `<PIN> <Route> PI Close-Out Report.docx` (interim: label instead of
  route). Ends with a page break, the photo placeholder and `<REPORT END>`, as
  the skill does. Attachment stitching stays in `merge_package.py`.
- Covered by `test/tests/56-closeout-report.test.js` (55 checks: preview AND
  unzipped .docx, every hyperlink resolving to an External relationship, three
  letterheads). Verified independently with **python-docx**: opens cleanly,
  first-page header only, 5 external hyperlinks, paragraphs in letter order.

### PI Close-Out — step 3 BUILT: the counted sections (Oct 2026)
`_coReportDoc` now builds four data sections as real tables (block type
`table`: `cols[{h,w twips}]`, `rows[[cell]]`, `boldCol`; a cell is a string or a
run array, so a placeholder can sit in a cell). `_coBlocksHTML` renders
`.co-doc-tbl`; `_coBlocksDocx` renders `<w:tbl>` with a repeating navy header
row (`tblHeader`), fixed layout, zebra rows, `cantSplit`. The `todo` block type
is no longer used.
- **PI Program at a Glance** (always): duration, PI reports, stakeholders,
  interactions + span, inbound calls, issues + resolved, events, commitments
  kept, website visits (last intake reading), subscribers, email updates,
  ROW parcels, custom metrics. **Every figure not counted by Cirrus Cc** (an
  override, an intake reading, a typed count, a custom metric) is marked **†**
  with a footnote, so the table says where each number came from.
- **Commitments to the Public** (only if any): counted intro sentence + table
  Commitment | Made to | Outcome ("Kept mm/dd/yyyy" / "Outstanding — due …").
- **Right-of-Way & Property Owner Outreach** (only if the project has parcels):
  optional narrative slot `draft.row` + a COUNTS-ONLY table from
  `_closeoutRowFacts()` (built on `_parcelStats`): parcels by take type, owner
  identified, party with authority to sign identified, distinct logged contacts
  with owners and their representatives, notice / legal description / design
  exhibit shared, sentiment counts. **No owner names or concerns, ever** — the
  report goes to the client; a closing line says the detail went to the ROW
  agents separately. Guarded by asserting no owner surname reaches the preview
  or the .docx.
- **Delivery Against Scope of Work** (only if deliverables): Committed
  Deliverable | Status | Evidence. Quantities read "(7 delivered)" — never
  framed as over/under. Missing evidence is a `[evidence not named]` placeholder
  IN the cell; `_coHoleCount()` counts table cells too, so export's
  placeholder warning includes them. Footnote cites the scope document + date.
- Verified independently with **python-docx**: four tables, correct headers
  and row counts. Covered by `test/tests/57-row-outreach-closeout.test.js`.

### PI Close-Out — step 4 BUILT: AI drafting for the PI Highlights (Oct 2026)
Each highlight box has **✦ AI Draft**; the PI Highlights box has **✦ Draft all
highlights**. Same discipline as the PI report editor — facts computed in code,
the model narrates, never counts.
- `_coHighlightFacts(co, hid)` → `{lines, notes}`. `lines` come from Cirrus Cc +
  the intake, per heading (`CO_HL_TASKS` holds each heading's task and word
  budget, taken from the reference reports: outreach ~180, website ~120,
  concerns ~120, coord ~70, email ~60, traffic ~60, social ~50). `notes` = what
  is already typed in that box, sent as AUTHORITATIVE ("include every point").
  That is how facts Cirrus Cc has no record of (a traffic-app alert, a
  press-release template) reach the paragraph: type two lines, then draft.
  Re-drafting a box therefore rewrites the current text, keeping its points.
- **Web and email addresses are never in the facts** — they print as links
  under the paragraph, and a model that has them repeats them. The hotline
  number IS a fact, since it prints nowhere else.
- Concerns facts: inbound count + by nature + by subject, issues escalated (or
  "No issues were escalated"), issue titles/status, and the intake's concerns
  and praise pointers. Inbound = `direction !== 'Outgoing'`, the same split the
  overall summary uses.
- **Refusal:** no facts and no notes → no call, a toast says to type notes.
- `_coCloseoutSystemPrompt()` — the Sunrise close-out voice from the skill:
  first-person plural ("our team"), past tense, warm, not boastful, 9th–10th
  grade, one paragraph, no invented numbers/names/quotes, no addresses, don't
  repeat the heading. Default model (`_claudeNarrative`'s Sonnet), like every
  other report narrative.
- `_coHighlightDraftCall()` is the ONE place a highlight is requested; both
  buttons go through it (parity by construction). Draft all drafts only EMPTY
  headings that have facts — never overwrites typed text in bulk — runs 4 at a
  time via `_mapLimit`, and confirms count + cost first.
- Output: a repeated heading is stripped, paragraphs become lines (the slot's
  one-paragraph-per-line format). A failed call leaves the box untouched.
- Covered by `test/tests/58-closeout-ai-highlights.test.js` (32 checks,
  `_claudeNarrative` stubbed).
- Not AI-drafted (yet): the cover letter, lessons and the ROW narrative stay
  typed. The Communications Log Summary is step 5 (below).

### PI Close-Out — step 5 BUILT: the Communications Log Summary (Oct 2026)
**✦ AI Draft** on the Stakeholder Communications Log Summary box. The one long synthesis in the app: the model READS the whole
interaction log for themes, notable exchanges and resolutions, outreach
cadence and tone — but still never counts it.
- `_coCommlogFacts(co)` → `{counts, issues, log, notes}`. **COUNTS are computed
  here** (total, span in words + months, outbound vs inbound, outbound/month,
  by channel / subject / nature / stakeholder type, distinct named
  stakeholders and organizations, unnamed public contacts) and sent as
  "authoritative; use exactly". The log follows, oldest first, labelled "Do
  not count from it". Issues go as their own authoritative block with status
  and resolution summary — that is where "how each was resolved" comes from.
- **Privacy by construction:** `_coWho()` names who a contact was by TYPE and
  ORGANIZATION only ("Business: Logan Auto Body", "Resident", "Member of the
  public") — a stakeholder's personal name is never put in the facts. Summaries
  are staff text and can still contain a typed name, so the task also says to
  refer to private individuals by role, never by name, phone or email. Guarded
  by asserting no linked stakeholder's name appears in any `who`; verified to
  FAIL when `_coWho` is made to return names.
- Summaries are trimmed to `CO_COMMLOG_SUMMARY_CHARS` (300) per line, so a big
  project's log stays affordable; the confirm shows the interaction count, the
  approximate tokens and an estimated cost before any call.
- **Effort `medium` for this section only** (`CO_COMMLOG_EFFORT`); every other
  narrative stays `low`. `_claudeNarrative(..., model, {effort})` and
  `_claudeRequest` let a caller's effort win, with thinking room by effort
  (`CLAUDE_HEADROOM_BY_EFFORT`: low 1500 / medium 4000 / high 8000). Length is
  ~350 words, ceiling 450, 3–5 paragraphs (each becomes a line in the slot).
- **Model: Sonnet 5.5, chosen Oct 2026.** A temporary "Compare models" tool
  drafted the same request on Sonnet 5.5 and Opus 5.5 side by side on a real
  project's log; Jeff picked Sonnet, and the tool (`coCompareCommlog`,
  `coPickCommlog`, `CLAUDE_STRONG_MODEL`) was removed. **To switch this one
  section back to Opus:** set `CLAUDE_COMMLOG_MODEL` to `claude-opus-5-5` — one
  line. `_claudeRequest` tunes whatever that constant names (effort, thinking
  room, fallback) and `_coCommlogCost` prices Opus by id, so nothing else
  changes; test 59's model-id list would need Opus added back. Opus is used
  nowhere else, so the reports keep one prose voice.
- Refusal: a project with no interactions makes no call and says why.
- **No API key → one message, first.** All three close-out AI buttons (the two
  highlight buttons and the log summary's AI Draft) call `_coHasKey()` before
  anything else. Seen live: without a key, Compare models asked the cost
  confirm and then opened a window of two empty "No draft returned" boxes,
  with the real reason only in a toast. The message names the Settings card
  ("Claude AI Narrative Generation"). Asserted in test 60.
- Covered by `test/tests/60-closeout-commlog.test.js` (33 checks, Messages API
  intercepted at the network layer: model, effort, max_tokens, identical
  compare requests, nothing changing until a pick).

### PI Close-Out — step 6 BUILT: Stakeholder Engagement in Figures (Oct 2026)
A computed section after the Communications Log Summary (`_coFigures(co, it)`,
next to `_coReportDoc`). Nothing to write; it prints whenever the project has
interactions or the intake has 2+ website readings. Contents, each omitted
(with the reason on the section pill) when there isn't enough data:
- **Figure: contacts per month**, outbound (blue) stacked under inbound
  (orange, 45° hatch) — `_coMonthly` fills empty months, switches to quarters
  past 36 months, and an undated-contacts note says how many were left out.
  Outbound = `direction === 'Outgoing'`, the same split everywhere else.
- **Table: contacts by channel** — Outbound / Inbound & in-person / Total, with
  a total row.
- **Figure: inbound and in-person contacts by subject** — inbound only (the
  team's own outreach topics are not what the public raised). Top 8 bars; the
  long tail is a "Plus N contacts across M other subjects" note, NOT an
  "other" bar (on the demo seed's free-text subjects it dwarfed every real bar).
- **Figure: contacts by type of stakeholder** — via `_coWho(...).split(':')[0]`,
  so types only, never a name (asserted).
- **Figure: cumulative website visits** — line from the intake's readings.
  `_coWhen()` reads only typed forms ("Oct 2025", "2025-10", "10/2025"…) —
  `Date.parse` alone accepts "Week 3" — and falls back to even spacing in the
  order entered, with a note saying so.
- **Table: issues escalated** — title, category, raised, outcome. Descriptions
  and resolution notes stay internal (titles are already in the portal).

**One drawing, two renderings.** Each chart is an SVG string in a `chart`
block: `_coBlocksHTML` inlines it; `_coBlocksDocx` emits an inline picture and
`exportCloseoutDocx` rasterizes the SAME string with `_coSvgToPng` (canvas,
3× → ~290 dpi), adds `word/media/coChart<n>.png`, `rIdCoImg<n>` relationships
and a png content type (the Sunrise template had none). `<wp:extent>` and
`<a:ext>` are written from one value — the letterhead-logo stretching bug was
those two disagreeing. Captions are `keepNext` so a figure never strands its
caption. Chart specs follow the dataviz rules: one y-axis, fixed series order,
4px rounded bar ends, 2px gap between stacked segments, one direct label (the
peak / the last reading), palette validated (blue `#2a78d6` / orange
`#eb6834`), hatch so the two series survive a black-and-white printer.
Verified with python-docx (4 inline shapes at 6.5"). Covered by
`test/tests/61-closeout-charts.test.js` (29 checks; verified to fail when the
subject chart counts outbound contacts or the two extents disagree).

### ROW outreach — for the ROW agents (Oct 2026)
`sql/2026-10-04_row_outreach.sql`. On ROW / easement work (including updating
or acknowledging PRE-EXISTING easements, e.g. sewer), PI staff trace each parcel
— often through property managers and several other numbers — to the party
with **authority to speak and sign**, share the legal (survey) description and
the design exhibit showing the take, and grade how the owner received it. The
ROW agents read that before negotiating.
- **`pi_parcel_outreach`** — one row per (parcel_id, stakeholder_id):
  `authorized_signer`, `sentiment` (`ROW_SENTIMENTS`: Willing / Has questions /
  Resistant / Won't engage; blank = not graded), `concerns`. **STAFF-ONLY**
  (same policy as `pi_closeouts`, anon revoked). It is a separate table, NOT
  columns on `pi_parcel_owners`, because a portal client signs in under the
  same `authenticated` role as staff and RLS gates rows, not columns — the
  portal reads owner links, so any column there is reachable by raw REST.
  Keyed by parcel+contact (not link id) so detach/re-attach keeps what was
  learned; `delParcel` removes them. Writes go through `setOutreach()`, chained
  on `_poChain` so quick successive edits create one row, not several.
- `pi_parcels.legal_desc_shared` / `exhibit_shared` (dates, in `DATE_FIELDS`).
- `OWNER_ROLES` gained **Property manager** (index.html only; no other app
  offers this list).
- Parcel modal: per contact — role, **Can sign**, sentiment, concerns, and
  "N logged · last date" (`_parcContactLog`: interactions on the project with
  that contact; derived, never stored). A trail line above names who can sign
  or flags "⚠ Nobody marked as able to sign yet". Parcels list badges show
  "signs" and the grade.
- **Agent briefing** — a third sheet in "Export .xlsx" and a third table in
  "Print register" (`_rowBriefCols` / `_rowBriefRows`): one row per parcel ×
  contact with Can sign (Yes / blank when another contact signs / "⚠ No signer
  yet"), sentiment ("Not graded" when blank), concerns, contacts logged, last
  contact, document dates. A parcel with nobody attached gets a "⚠ No contact
  identified" row. Separate sheet because the register is already as wide as a
  printed page allows.
- **No dollar figures** in PI notes: appraisal / offer amounts belong to the
  ROW agents and the negotiation (Uniform Act), not to PI records.
- Mobile shows parcels read-only and does not show outreach notes (desktop
  manages, as with the rest of the parcels module). The portal never reads
  `pi_parcel_outreach` (asserted).
- Covered by `test/tests/57-row-outreach-closeout.test.js` (58 checks),
  including a role-switched check that anon is refused and a granted portal
  client on that very project sees zero outreach rows.

### PI Report Editor (openPIReport)
- Replaces full `#main` div (including topbar)
- Left pane `#rpt-editor-pane` (50%): header inputs + section list with move/remove/AI draft
- Right pane `#rpt-preview-pane` (50%): live preview via `schedulePreview()` → `renderLivePreview()` (350ms debounce)
- All inputs wired to `oninput="schedulePreview()"`
- Use `fmt(d)` for date formatting (NOT `fmtDate` — that doesn't exist)

### Report persistence
- `loadReportSections(projF)` — Supabase-first (`_syncCache['reports']`), localStorage fallback
- `savePIReportDraft()` — async, saves to `pi_reports` (insert or update) + localStorage key `pir4_pi_reports_{projId}`
- `resetPIReportDraft()` — async, deletes from Supabase + localStorage

### Report archive
- **The final, hand-edited .docx is the report of record (Sep 2026) —
  `sql/2026-09-16_report_final_docx_attachment.sql`.** The FROZEN SNAPSHOT below
  (July 2026) was treated as "the compliance record" for two months, but that was
  never actually true: the consultant downloads the exported .docx and hand-edits
  the prose — sometimes adding photos or reformatted tables the app has no model
  for — before delivering it to the client. The archived JSON snapshot and the
  document the client received have been two different artifacts since the
  feature shipped. The snapshot is demoted, not deleted — see below for what it
  still does.
  - `pi_report_archive.docx_path` (a Supabase Storage path, bucket
    `report-files`, `{project_id}/{archive_id}.docx`) and `docx_uploaded_at`.
    `uploadReportDocx(archiveId)` / `_doUploadReportDocx()` in the Report Archive
    panel (`_buildArchiveHTML`) upload via `POST /storage/v1/object/report-files/…`
    with `x-upsert: true` — re-uploading (a further hand-edit) overwrites in
    place rather than erroring, which is expected to happen more than once per
    report.
  - **A NEW share requires a real file attached, enforced twice.**
    `toggleReportShared()` refuses client-side with a toast if `!rec.docxPath`;
    the database ALSO enforces it — a trigger,
    `pi_report_archive_require_docx()`, blocks any `client_visible` false→true
    transition (or an insert already `true`) with no `docx_path`. The client-side
    check is a courtesy; the trigger is the real guarantee, verified directly
    against a real Postgres by role-switching (see
    `test/tests/49-report-docx-attachment.test.js`), not just asserted through
    the app.
  - **Grandfathered, on purpose — "yes, grandfather them in" was the explicit
    call.** The trigger only fires on a FRESH transition to `client_visible=true`;
    a row already sharing before this shipped is never re-validated (real
    Postgres triggers don't fire retroactively against existing rows either), so
    nothing already visible to a client was force-hidden. Both `_buildArchiveHTML`
    and the portal render the honest "no final .docx attached (shared before this
    was required)" state for those rows rather than pretending one exists — they
    keep the ORIGINAL in-browser snapshot preview, which is the only copy that
    has ever existed for them. The demo seed's own shared report rows simulate
    this the same way `test/tests/49-*` proves it: the trigger is disabled for
    just that one `insert into pi_report_archive`, since a seed INSERT can't be
    "already in the table" the way a real pre-migration row is — see the comment
    at that insert if you touch it.
  - **Download, not in-browser render, once a file exists.** The client portal
    drops the rendered-HTML preview for any shared report that has a
    `docx_path` — "Download report (.docx)" is the only action, via Supabase
    Storage's `POST /storage/v1/object/sign/report-files/{path}` signed-URL
    endpoint. That endpoint checks the CALLER's own RLS read access before
    issuing a URL, so no new permission check or RPC was needed — the Storage
    RLS policies below (mirroring `pi_is_portal_client()` /
    `pi_portal_project_ids()` from the isolation migration, same three-policy
    shape as every table there: staff / OTP client / token-link anon) ARE the
    access control. A report with no `docx_path` (grandfathered) keeps View +
    Print/PDF exactly as before.
  - **The anon Storage policy now scopes to the visitor's own link** — it calls
    `pi_portal_project_ids()`, which reads `x-portal-token` since Oct 2026 (see
    "Portal token links scoped to the token actually held"). Storage also needs
    `Authorization: Bearer <anon key>`; without it every token-link download
    failed with a 400 until that same change.
  - What could and could not be verified from this sandbox: `storage.objects`
    RLS is a documented, stable Supabase primitive (not a guessed third-party
    endpoint like the UGRC story below) — the policy logic was verified for
    real, role-switched, against a scratch Postgres with a stand-in
    `storage.objects`/`storage.buckets` schema (`test/lib/build-schema.js`,
    same technique as the `auth` schema stub). What could NOT be verified from
    here is the live Storage SERVICE itself (no network path to `*.supabase.co`
    from this sandbox) — test the real upload → share → sign → download round
    trip by hand once this ships.
  - **Caught only by actually running it against the live project — the
    migration originally ran `alter table storage.objects enable row level
    security` before its policies, and Jeff hit `ERROR: 42501: must be owner
    of table objects` running it in the Supabase SQL Editor.** `storage.objects`
    is owned by Supabase's own `supabase_storage_admin` role, not the
    `postgres` role the SQL Editor connects as, and Supabase already has RLS
    permanently enabled on it regardless — the ALTER was both forbidden and
    redundant. `CREATE POLICY` on `storage.objects` does not hit the same
    wall; that's Supabase's own documented pattern for managing storage
    policies from the SQL Editor. **The scratch-Postgres verification above
    could not have caught this**: a stub table's creator owns it there, so
    the same ALTER just quietly succeeded in the harness. Fixed by moving
    `enable row level security` OUT of the migration and INTO the harness's
    `storage.objects` stub itself (`test/lib/build-schema.js`) — that's where
    it belongs conceptually too, since it's reproducing a pre-existing fact
    about real Supabase's schema, not something this feature's migration
    should be responsible for turning on. Simply deleting the line without
    also enabling it in the stub would have silently left RLS OFF in the
    harness, which does not fail loudly — it just makes every row visible to
    every role regardless of policy, so `test/tests/49-report-docx-attachment.test.js`'s
    own role-switched assertions would have started passing for the wrong
    reason (nothing scoped, but nothing asked for more than one project's
    worth of data either) rather than actually failing. Re-verified after
    the fix: same role-switch test, same result.
- **The final report of record is a PDF (Oct 2026, Jeff's call).** New
  uploads are PDF only (`uploadReportDocx` → `.pdf,application/pdf`;
  `_doUploadReportDocx` refuses anything else, stores
  `{project_id}/{archive_id}.pdf` as `application/pdf`). It opens in any
  browser and in Gmail/Drive exactly as issued (UDOT runs Google Workspace),
  and reads as final. The column is still named `docx_path` (renaming it is a
  migration over live rows for no behavior); `_isPdfPath()` tells the two
  apart. A `.docx` attached earlier stays valid — labelled "Final .docx
  attached" with **Replace with PDF**; replacing deletes the old object from
  storage (best effort; staff hold delete via `report_files_staff_all`). The
  share rule and DB trigger are unchanged (any attached file counts).
  - Portal: a PDF shows **Open report (PDF)** (`openSharedReportPdf`: the tab
    is opened inside the click, then pointed at a 300 s signed URL — a window
    opened after an await is pop-up-blocked; falls back to a download). A
    .docx keeps **Download report (.docx)**. Both signing calls now send
    `{expiresIn}` in the JSON BODY, which Storage's sign endpoint reads — the
    .docx one used a query string and was never exercised live.
  - Status report: the newest `STATUS_PDF_MAX` (6) final PDFs go to Claude as
    `document` blocks (base64), each right after its `SOURCE: final delivered
    report (PDF)` label; older PDFs, unreadable files (or non-`%PDF-` bytes)
    and reports without a file use the archived wording with the reason.
    `.docx` reports still contribute paragraphs. The prompt is a plain string
    when no PDF is sent, content blocks when one is. The PDFs include tables
    that can name private individuals, so the system prompt forbids naming,
    quoting or describing one. Cost check counts pages (`/Type /Page`
    objects, else ~1 per 40 KB) × `STATUS_PDF_TOKENS_PER_PAGE` (2,500).
  - Guarded by `test/tests/77-final-report-pdf.test.js` (fails on the old code).
- **"Copy client link" — one report, one link (Oct 2026).** On a shared
  report with a final PDF (Report Archive card, beside Replace file;
  disabled until shared). `copyReportClientLink` copies
  `client-portal.html?token=<the project's portal link>&report=<archive id>`
  as rich text (`_copyRichLink`: `text/html` anchor whose text is
  `_reportLinkLabel` — "Project: Title #N, period (PDF)" — plus a
  `text/plain` "label: url"), so an email shows the report's name, not a
  bare URL. No portal link yet → `confirm()` then created
  (`_portalTokenFor`, cached per project); a refused clipboard write opens
  `_reportLinkDialog`. Nothing new is stored: revoking the portal link or
  unsharing the report stops it, and the holder can also open the portal.
  Portal, fast path (no dashboard flash, reported live): a `<head>` script
  adds `html.deep-report` when both `token` and `report` are in the URL, so
  only `#report-splash` ("Opening <title>…") ever paints — no sign-in screen,
  no dashboard. `openReportLinkFast` resolves the token, reads that ONE
  `pi_report_archive` row (shared, PDF), signs it (300 s) and
  `location.replace`s (`_goToUrl`, stubbable). Not shared / no PDF / any
  failure → drops the class and `bootFromToken(token, reportId)` →
  `openReportDeepLink` → Project PI Reports with a note.
  **Portal nav "Project Updates" → "Project PI Reports"**, reports listed
  first on that tab, and an Overview card (`latestReportCard`) with the
  newest shared report + "All PI reports (N)". The harness's
  `pi_portal_links.token` now defaults to `gen_random_uuid()` as the
  migration declares. Guarded by `test/tests/79-report-client-link.test.js`.
- **FROZEN SNAPSHOTS (July 2026).** An archived report is a point-in-time
  compliance record. `_buildReportSnapshot(projF, saved)` captures, at archive
  time, everything the report renders: `recipients` (the Distributed-To
  list), and per section the `countsLabel` + `tableHtml` (built with the SAME
  `_buildSectionPreviewTable` the live preview uses, so it matches exactly), plus
  `projName`/`projPid`/`periodLabel`/`brand`. Stored in `pi_report_archive.snapshot`
  (jsonb; migration `sql/2026-07-25_report_archive_snapshot.sql`).
  **NEVER recompute an archived report from live data** — a report issued in July
  must still read identically in September even if an interaction is later
  back-dated into its period, or the archive stops matching the .docx the client
  already has. Renderers: `_buildArchivedPreviewHTML` (desktop) and
  `renderArchivedReportHTML` (portal) both read the snapshot and fall back to
  narrative-only + an explanatory note when `snapshot` is null (pre-feature rows —
  their table data was never captured and cannot be recovered).
  The frozen `tableHtml` is inline-styled and self-contained so the portal renders
  it identically without duplicating desktop CSS. `_rptBrandHeader(modeOverride)`
  takes an optional brand so archived copies keep the letterhead they were issued
  under.
  **Demoted, not removed, as of Sep 2026** — see above. It is now the AI trend
  tool's input and the fallback render for a grandfathered report with no
  `docx_path`, not "the record" for a report that has a real file attached.
- **Project Status Report (replaced the AI trend analysis, July 2026).** Button in
  the Report Archive: `generateTrendSummary()` (name kept; UI says "AI: Project
  Status Report"). A trend gets vaguer as reports accumulate, so this reports
  POSITION instead: it compares three fixed anchors (baseline / last report / now)
  rather than N reports, so output stays constant-size at report 30.
  - `_buildStatusMetrics(projF, archives)` — schedule % elapsed vs deliverable %
    complete, pace verdict (on/slipping/behind), projected completion at the rate
    since project start, commitments fulfilled/outstanding/overdue, open issues +
    age of oldest, engagement delta vs previous period. Most rows compute from LIVE
    project data, so the scorecard works even with no archive history.
  - `_statusScorecardHTML(m)` — inline-styled TABLE (not flex/CSS classes) so it
    survives the print window, the portal and a paste into Word.
  - `_buildTrendComparison(archives)` — deterministic diff of the frozen
    `snapshot.trendFacts` across archives (issues closed / persisting / new,
    commitments fulfilled vs outstanding, deltas). **Matching and arithmetic are done
    in code, never by the model** — an LLM asked to diff lists mis-states which item
    closed, which a compliance document cannot carry. The model narrates computed
    facts it is told are authoritative.
  - `snapshot.trendFacts` (added to `_buildReportSnapshot`) freezes per-period:
    interactions + channel mix, open follow-ups, issues (title/status), commitments
    (text/status/due), deliverables (title/status/pct), sentiment split, external
    contact count, events. Archives predating it degrade to narrative-only and the
    prompt says so rather than inventing movement.
  - **Reads the final .docx (Oct 2026).** For each archived report with a
    `docx_path`, `_archiveDocxProse(rec)` downloads it
    (`/storage/v1/object/authenticated/report-files/…`, the staff session),
    unzips with the embedded JSZip and `_docxProseFromXml` keeps TOP-LEVEL
    body paragraphs only — tables (stakeholder names; the figures come from
    computed facts) and header/footer parts are never read. Capped at
    `DOCX_PROSE_MAX_CHARS` (8000, ~2k tokens) per report, cut on a word and
    flagged. No file, or an unreadable one → the archived wording. Every
    report in the prompt is labelled `SOURCE: final delivered report (.docx)`
    or `SOURCE: archived draft wording (no final .docx attached | could not be
    read)`, and the system prompt ranks the final file as the report of record
    and the computed facts above both. The period falls back to the
    snapshot's `periodLabel` when the columns are blank. The confirm states
    how many came from the final file and estimates tokens/cost from the
    actual text (Sonnet 5.5 $2/$10 per MTok). Measured sizes: archived
    digest ~250–600 tokens/report; .docx files are 165–275 KB, mostly images.
    Guarded by `test/tests/76-status-report-reads-docx.test.js`.
  - Delivery is deliberate: generated on demand, held in `_lastTrendResult`,
    editable, printable — persisted ONLY via `publishClientTrend()` to the portal.
    The status report is derived analysis; the archived reports are the record.
- **Report prompt architecture (July 2026).** Three distinct system prompts so the
  sections don't compete: `_claudeSystemPrompt()` (generic), `_claudeSectionSystemPrompt()`
  (defers to each task's stated length — the shared one's "2-4 sentences" cap was
  truncating richer sections), `_claudeExecSystemPrompt()` (executive summary:
  3-4 sentences that ORIENT, explicitly NOT a section recap, no counts, no date
  range). **The concerns section owns the reporting date range**; the exec summary is
  told not to repeat it. "Draft all sections" is ONE batched call whose token
  ceiling is the sum of the per-section budgets.
- **`_fmtMDY(d)`** → mm/dd/yyyy for table cells; **`_fmtDateRange(a,b)`** → "July 6 –
  August 7, 2026" for prose/AI facts; `fmt(d)` → "Jul 6, 2026" for headers. Feeding
  raw ISO to the AI makes it echo ISO in the narrative.
- **`ARCHIVE_LIMIT = 50` per project** (10 → 30 → 50 during Aug 2026; this line
  claimed 50 long before it was true in code). The limit BLOCKS rather than evicting —
  an archived report is a compliance record, so nothing is auto-deleted.
  **Storage is not the constraint; the boot payload is.** `loadAllData()` fetches
  `report_archive` with `select=*`, so every frozen snapshot for every project is
  downloaded on every page load. Measured on the demo seed: ~6 kB raw per
  snapshot, up to 27 kB for a whole row, and a real report with a long
  interaction table will be bigger (the frozen `tableHtml` is inline-styled on
  purpose so the portal renders it standalone). **50 is only safe because the
  boot payload was fixed** — see the `SB_LAZY_COLS` note below. Do not put
  `snapshot` back into the bulk fetch.
- `_archiveReport(projF)` — async. **`exportPIDocx()` does NOT call it** (this
  line used to claim it did); archiving is deliberate, via the "Save to archive"
  button → `manualArchiveReport()`. Returns **true only if a snapshot actually
  reached the database**, and reports its own failure — the caller must not
  announce success on its own. It previously swallowed both the empty-draft and
  the failed-insert cases while `manualArchiveReport()` said "Draft saved to
  archive" regardless, i.e. it told the consultant a compliance record existed
  when none did.
- **Snapshots are fetched lazily** (`SB_LAZY_COLS` + `_sbSelect()`): the boot
  `sbGet` for `report_archive` selects every mapped column EXCEPT `snapshot`, and
  `_archiveEnsureSnapshots(recs)` pulls them by id when a report is previewed or
  the status report runs. `fromSB` leaves a lazy column's key **absent** rather
  than defaulting it, so callers can tell "not loaded" from "stored as null" (a
  null snapshot is a genuine pre-snapshot row and renders an honest note).
  Safe because `report_archive` never goes through `DB.set`/`DB._sync`, and
  `toSB` omits undefined values, so a partial `sbUpdate` (e.g. the share toggle)
  cannot null the column. Covered by `test/tests/08-archive-lazy.test.js`.
  **`client-portal.html` still fetches snapshots eagerly** — it only pulls
  `client_visible` rows for one project, so the payload is small, but the same
  treatment applies if that ever grows.
- `deleteArchivedReport(archiveId)` — async, re-renders `#rpt-archive-panel` in place
- `_buildArchiveHTML(projF)` — renders archive list + AI trend button (shown when 2+ archives)
- `generateTrendSummary()` — async, sends all archived report digests to Claude Haiku, renders trend narrative in `#trend-result`

### Claude AI integration
- API key stored obfuscated (XOR+base64) in localStorage key `compass_claude_api_key_v2`
- `_getClaudeKey()` / `_setClaudeKey(key)` — read/write helpers
- `_claudeNarrative(systemPrompt, userContent, maxTokens, model)` — shared
  narrative wrapper; default model `CLAUDE_TEXT_MODEL`, length 400.
- **Models live in TWO constants only (Oct 2026):** `CLAUDE_TEXT_MODEL =
  'claude-sonnet-5-5'` (every narrative — PI report sections, overall and
  executive summaries, the Project Status Report, close-out highlights — plus
  the contact importer's image/PDF path) and `CLAUDE_FAST_MODEL =
  'claude-haiku-4-5'` (pasted-text contact import), plus `CLAUDE_COMMLOG_MODEL`
  (= the text model) for the close-out log summary — no Opus anywhere since the close-out comm-log comparison chose Sonnet (step 5).
  Upgraded from Sonnet 5 /
  `claude-haiku-4-5-20251001`, same price. All narratives on one model keeps
  the report's one prose voice — never switch a single call.
- **`_claudeRequest(key, body)` is the ONLY fetch to the Messages API.** For the
  text model it adds `output_config.effort = CLAUDE_EFFORT` ('low') and
  `CLAUDE_THINKING_HEADROOM` (1500) on top of the caller's `max_tokens`:
  Sonnet 5.5 always thinks (`thinking: {type:"disabled"}` is a 400 — never send
  it), and thinking counts against `max_tokens`, so without headroom a 400-token
  narrative could come back cut off or empty. Caller lengths are therefore the
  REPLY length; the prompts' word limits hold length, not max_tokens. No
  `temperature`/`top_p` (non-default values 400 on this model).
  It also opts into server-side fallback (`fallbacks: "default"`, header
  `anthropic-beta: server-side-fallback-2026-07-01`; CORS allows the header —
  checked against the live preflight). If the API rejects that option with a
  400, the call retries once without it and `_claudeNoFallback` stops sending
  it for the session. **A refusal** (HTTP 200, `stop_reason: "refusal"`) throws
  an Error with `.refusal` — narratives show it as a "declined (category)"
  warning, never as an API error, and write nothing. Fallback only retries
  `cyber` / `frontier_llm` declines; a `general_harms` false positive on PI
  text would surface as that warning. The fast (Haiku) path gets no effort and
  no fallback — Haiku rejects `effort`.
- Not verifiable from the sandbox (no API key): the PROSE on Sonnet 5.5. The
  request shapes and every failure path are covered by
  `test/tests/59-claude-model-requests.test.js` (32 checks, the Messages API
  intercepted at the network layer), which also asserts the model ids and the
  API URL appear nowhere else.
- CSP `connect-src` includes `https://api.anthropic.com`
- Confirmation dialog required before bulk AI calls (cost estimate shown)

## Important conventions
- **No `fmtDate()`** — use `fmt(d)`
- **No build step** — edit `index.html` directly, syntax-check with:
  ```bash
  node -e "const fs=require('fs'),html=fs.readFileSync('index.html','utf8');const s=[];let m,r=/<script>([\s\S]*?)<\/script>/g;while((m=r.exec(html)))s.push(m[1]);try{new Function(s.join('\n'));console.log('OK');}catch(e){console.log('ERROR:',e.message);}"
  ```
- After every edit, run the syntax check before committing
- **Small fixes go straight to live; bigger changes wait (Jeff's rule, Oct 2026).**
  Jeff is the only developer — commit and push without asking. `develop` →
  dev.cirruscc.com; `main` → the live app. See "How we work" under Dev and live.
- **Shared lists live in 4 places — update all together.** `index.html`,
  `mobile.html`, and `importer.html` are standalone; none imports the others,
  so any list a user picks from is duplicated — and the importer's embedded
  `.xlsx` template is a fourth copy. **`test/tests/06-shared-lists.test.js` now
  enforces this mechanically** (it decodes the base64 `.xlsx` and diffs every
  dropdown against `index.html`), so run `node test/run.js` after touching a
  list rather than relying on remembering. It caught the `.xlsx` offering
  `Letter`/`Text` channels the app never had while omitting `Public event`, and
  a missing `In-person` direction. Known duplicated lists:
  - **Stakeholder types** — canonical `STAKE_TYPES` in `index.html` (13: Business,
    Elected Official, Agency, Community Group, Contractor, Engineering, Media,
    Property Owner, Resident, Tribal, Utility, Non-profit, Other). Mirrored in
    mobile's `#add-type` dropdown, importer's `normalizeType()` + the `.xlsx`
    template's StakeholderType data-validation dropdown + its Legend sheet.
  - **Distribution groups** — `DIST_GROUPS` in `index.html` (Project team, Agency
    contacts, Media, Other). Importer normalizes to it (`normalizeDistributionGroups`)
    + `.xlsx` dropdown. Report filtering matches these strings exactly.
  - **Interaction channels + direction** — the `f-ic` / `f-idr` selects in
    `index.html` are canonical; mirrored in the `.xlsx` template (sheet3).
  - **Parcel status + acquisition type** — `PARCEL_STATUSES` in `index.html` is
    canonical (6 values); mirrored as `PARCEL_STATUSES_IMP` / `PARCEL_ACQ_IMP`
    in the importer and as the two dropdowns on the `.xlsx` **Parcel Import**
    sheet. A template offering a status the importer would reject does not
    error — `parcNormalizePick` silently falls back to "Not started" on every
    row that used it.
  - Editing the `.xlsx` template = decode the base64 in `downloadTemplate()`
    (importer), edit the sheet XML, re-zip, re-base64. Verify all sheets survive
    — the test asserts the entry count (**20**) precisely because a bad re-zip
    silently drops sheets. Sheets: How to Use, Stakeholder Import, Interaction
    Import, **Parcel Import** (sheet5, added Aug 2026), Legend & Defaults.
    Adding a sheet means four parts, not one: the sheet XML, `xl/workbook.xml`,
    `xl/_rels/workbook.xml.rels` and `[Content_Types].xml`. Validate the result
    with **openpyxl** — LibreOffice is broken in this container and rejects even
    a textbook-minimal .xlsx.
  - **All three importer tabs offer the same download.** The Parcels tab shipped
    without one (Aug 2026) — the wizard was complete and the workbook had no
    parcel sheet to point at, so the tab looked half-built next to the other
    two. `test/tests/06-shared-lists.test.js` now asserts the Parcels pane calls
    `downloadTemplate()`, that every header on the Parcel Import sheet
    auto-maps to a real field in `PARC_AUTO_MAP` (otherwise the template hands
    the user columns the wizard leaves on "— ignore —"), and that the sheet's
    two dropdowns match the app.
  - `normalizeType()` in the importer matches an exact canonical type first,
    then keyword rules, then falls back to `Other`. It used to return the raw
    input unchanged, which let `Nonprofit` or `Contracting` into the database as
    stakeholder types nothing could filter on.

## CSP (the `<meta http-equiv="Content-Security-Policy">` near the top)
```
connect-src https://ncfbblhlsiglxkoiounv.supabase.co https://maps.googleapis.com https://places.googleapis.com https://api.anthropic.com https://cdnjs.cloudflare.com https://services1.arcgis.com;
```
(`services1.arcgis.com` added Aug 2026 for UGRC parcel reconciliation — see the
Polygon Phase 2a section.)

## Mobile app (`mobile.html`)
Field companion for logging interactions, managing contacts, follow-ups, and issues. ~3,000 lines.
- **Status: current** — LEP, EJ (`underserved`), and `equityFormSubmitted` fields are all implemented
- Has its own `SB_TABLES`, `SB_TO_INT`, `toSB()`, `fromSB()`, `sbGet/Add/Update/Delete()`, `loadAllData()`
- Does NOT have the reports module — reports are desktop-only
- **Follow-up assignment (Aug 2026):** mobile maps `followUpAssignedTo` and has its
  own `_fuOwner()` that must stay identical to index.html's. Its "Mine" filter
  compared `loggedBy` only, so a follow-up a teammate assigned to you on the
  desktop never reached the phone — the exact case the feature exists for. The
  follow-up card now names the assignee and who assigned it. **Reassignment stays
  desktop-only**: mobile reads the assignment, it doesn't change it. Guarded by
  `test/tests/05-mobile.test.js`.
- **OCC participation (July 2026):** mobile stamps `updated_at`/`updated_by` on every
  write to the OCC tables (`stakeholders`, `interactions`, `issues`) via `_occStamp()`
  in `sbAdd`/`sbUpdate` — REQUIRED so desktop's optimistic-concurrency guard sees
  mobile edits instead of silently overwriting them. Mobile itself stays
  **last-writer-wins** (no conflict prompt — deliberately; you don't nag a field
  worker mid-log). Keep `OCC_TABLES` in sync with `index.html`. If symmetric
  conflict *detection* on mobile is ever wanted, mirror index.html's conditional
  PATCH + `_occResolveConflict` (mobile's `DB._sync` has the same `oldMap` baseline).
- **Catch-up, Oct 2026** (`test/tests/63-mobile-review-and-load.test.js`, 21 checks):
  - **Needs review** — mobile maps `needsReview`, badges a placeholder contact in
    the list (with its address, the thing to knock on) and on the contact screen
    with a short note, and its edit sheet shows a "Needs review" toggle **only
    for a flagged contact**; unticking clears the column. Both apps clear it the
    same way — see the draw-area section.
  - **A failed read is named, never shown as empty** — `sbGet(table,{strict:true})`
    throws on a non-404, `loadAllData()` loads each table on its own, keeps the
    last good copy on a reload (the import BroadcastChannel reloads), toasts
    which lists failed, and returns the failed table names. A 404 is still empty.
    Same rule as index.html's `_refreshData` fix.
  - **`saveInteraction` awaits `DB.set` before redrawing** (the sheet still
    closes at once) — otherwise the row just logged carried a `tmp_` id and
    tapping it did nothing. Same race as desktop's Quick Log fix.
  - The log toast read "Interactionsged ✓"; now "Interaction logged ✓" /
    "Interaction updated ✓".

- **Contact count, failed saves, email check — Oct 2026**
  (`test/tests/68-mobile-contact-count.test.js`, 11 checks):
  - Home "Contacts" counted project LINK rows; desktop counts links whose
    contact exists and is active. They disagreed 66 vs 65 on 3600 West
    Reconstruction because production held one link with stakeholder_id
    `tmp_mrspoajt7fh` (link id 207, project 16, 2026-07-20) — a temporary id that
    never became a contact. Mobile now uses the desktop rule.
  - **How it got there:** both mobile "new contact" paths (`saveInteraction`'s
    new-caller block and `saveStakeholder`) linked `newS.id` after
    `DB.set`, but a failed insert leaves the `tmp_` id in place.
    `_mobNewStakeId(newS)` returns the real id or null; on null nothing is
    linked or logged and a toast says so.
  - **`DB._sync` deletes any stored row missing from the array it is handed.**
    Several save paths (mobile ×3, desktop `saveStake` + two bulk edits) handed
    `DB.set('stakeholders', …)` a `DB.getActive()` array, which would delete
    every ARCHIVED contact. Latent only: 0 archived rows, and no UI archives
    anyone yet. Now `DB.get`. Never pass a filtered array to `DB.set`.
  - `validateEmail` was `new RegExp('…\s…')` in a string, so `\s` was a
    literal "s": mobile refused any address with an "s" before the last dot
    (`jeff@sunrise.com`). Now the same regex literal as index.html.
  - Link row 207 was deleted by Jeff in the SQL Editor on 2026-10-08; verified
    after: zero `tmp_` or orphaned links anywhere, project 16 at 65 contacts.

- **Phones open the mobile app; names open contacts — Oct 2026**
  (`test/tests/69-mobile-redirect-and-contact-links.test.js`, 28 checks):
  - A small script at the top of `index.html`'s `<head>` sends PHONES
    (`iPhone|iPod|Android…Mobile|Windows Phone`) to `mobile.html` with
    `location.replace`. Tablets and computers stay: reports, the map and
    close-outs are desktop-only. "Use full desktop site" at the foot of the
    mobile Dashboard links `index.html?desktop=1`, remembered per device in
    localStorage `cc_prefer_desktop` (`?desktop=0` forgets it). Any other `?…`
    or `#…` on the address (a sign-in or reset link) is never redirected.
  - The contact's name on an interaction row (Dashboard, Interactions,
    Follow-ups) is its own tap target, `_stakeLinkHTML(s)` →
    `showContactDetail`, with `stopPropagation` so the row's edit tap does not
    also fire. The contact screen's Back returns to `window._detailBackTo`
    (the screen it was opened from), not always Contacts.
  - The floating "log interaction" button (`.fab`) is removed; its CSS had
    already gone, so it drew as a bare grey bar over the bottom nav. The top
    bar's "+ Log Interaction" and the Log nav item remain.
  - The harness's `openApp` now takes `userAgent` and `query`.

## Importer app (`importer.html`)
Bulk CSV import wizard for stakeholders and interactions. ~3,200 lines.
- **Updated this session**: added LEP and EJ/underserved field support:
  - `SB_TO_INT` pi_stakeholders: `lep` and `underserved` mappings added
  - `APP_FIELDS`: LEP and EJ appear in the column-mapping dropdown
  - `AUTO_MAP`: auto-detects headers `lep`, `limited english`, `underserved`, `ej`, `environmental justice`
  - Boolean parsing: `yes/true/1/y → true` for `lep`/`underserved` (same as `isMaster`)
- `sbAdd()` at line ~746 calls `r.json()` directly — safe because it uses plain POST (not upsert), so body is never empty
- **OCC participation (July 2026):** stamps `updated_at`/`updated_by` on writes to the
  OCC tables via `_occStamp()` in `sbAdd`/`sbUpdate` (the import can `sbUpdate` an
  existing stakeholder on match) — same rationale as mobile: keep imported changes
  visible to desktop's concurrency guard. Keep `OCC_TABLES` in sync with `index.html`.

### Public comments — ONE vocabulary over the table (Aug 2026)
`saveComment()` built its record with names that were **absent from
`SB_TO_INT.pi_public_comments`** — `commentText`, `topic`, `commentMethod`,
`submittedDate`, `commenterName`, `commenterOrg`, `commentPeriodId`,
`commentPeriodType`, `commenterEmail`, `respondedBy`, `notes`. `toSB()` drops
what it cannot map, so a comment logged through the UI persisted as
`project_id` + `response_status` and nothing else. It painted into the list from
the cache, then vanished. **On a NEPA comment period the public comments ARE the
formal record**, so those were blank rows on a compliance artifact.

One table, two vocabularies: the form wrote and read one set, while the report
sections read `c.summary` / `c.category` — the columns that exist. Seeded
comments showed in reports and were blank in the form's views; form-created ones
were shells no report counted. Fixed by collapsing to the **mapped** names
(8 renames in `index.html`; the other apps never touched these fields), plus
`sql/2026-08-25_public_comments_missing_columns.sql` for the three that had no
column at all — `commenter_email` (the reply-to for a formal response),
`responded_by` (attribution), `notes` (internal, deliberately not selected by
the portal).

**Section names are a trap here.** `auto-comments` does NOT read
`pi_public_comments` — it reads INTERACTIONS whose channel is Comment card /
Public meeting / Mail / In-person. Only **`auto-comment-matrix`** reads the
comments table. Two different things both called "public comments" in the UI.

### A text-PK upsert reported every success as a failure (Aug 2026)
Found while fixing the above. `sbAdd()` sent `Prefer: resolution=merge-duplicates`
for the three `TEXT_PK_TABLES`, which **replaces** the
`Prefer: return=representation` default from `getAuthHeaders()`. PostgREST then
answered 201 with an EMPTY body, `sbAdd` read no rows and returned `null`, and
`DB._sync` counted a perfectly good insert as *"rejected by the database"* —
rolling the optimistic cache entry back out from under a row sitting in the
database. Affected every insert into `pi_comment_periods`, `pi_public_comments`
and `pi_tribal_consultations`. The header now carries **both** values. (The
importer has always been safe here: its `sbAdd` uses a plain POST, not an
upsert.) Both bugs guarded by `test/tests/40-public-comments.test.js`, which
asserts every key `saveComment` writes is mappable — the check that would have
caught the original.

### Hearing notices are timed against the HEARING DATE (Aug 2026)
**Utah Admin Code R930-2-5** governs newspaper notice for a UDOT project public
hearing: at least two notices in a daily paper with statewide circulation, the
**first ≥14 days before the hearing**, the **second 5–10 days before** it. Not
against the comment-period close, and not against a request-for-hearing
deadline.

The comment-period form labelled both fields *"(≥15 days before deadline)"* /
*"(≥7 days before deadline)"* without naming which deadline, and validated
nothing. That phrasing came from the app's own NEPA checklist (CE-11 / EA-26),
which cites UDOT MOI Ch. 4.5(A)(4)(a) and says **"request-for-hearing
deadline"** — a DIFFERENT NEPA step (23 CFR 771.111(h): offering the
*opportunity* of a hearing, which applies when no hearing is held). That
deadline is **not a column on `pi_comment_periods`**, so the label pointed at a
date the app does not store. The checklist text is left alone — it is correct
for its own scenario.

- `_cpAdCheck()` (next to `savePeriod`) reports the interval against the hearing
  date, live on edit and on modal open. **Advisory, never blocking** — a notice
  published late is still a fact that must be recorded truthfully.
- With **no hearing date** it declines to judge and says why, rather than
  applying R930-2-5 to a record the rule does not cover.
- **The demo seed was non-compliant** and is corrected: the SR-154 hearing sat
  on 2025-10-22 with a single 10-15 ad — seven days of notice. Now the hearing
  is 2025-11-05 with ads on 10-15 (21 days) and 10-28 (8 days), which also keeps
  the first ad on the comment-period start date, as the EA NOA guidance asks.
  Moving the hearing rippled to the `pi_meetings` row, the period description
  and the transcript commitment — all updated together.
- Guarded by `test/tests/41-hearing-notice-timing.test.js` (20 checks), which
  asserts the seeded record complies and that the old dates would be flagged.

## Pending / next tasks

**⚠ This list drifts — VERIFY in code before treating anything as "not built."**
On 2026-07-24 a reconciliation found four items marked pending were already
shipped. Grep the actual functions before planning work off this list.

### Roadmap — agreed with Jeff, 2026-10-11 (this order; supersedes older lists below)
**Now — foundation:**
1. ✅ Dev/live switch released to live (2026-10-11).
2. ✅ Cleanup (2026-10-11): dead deliverable/event code removed; stale line
   numbers dropped from this file; `pi_report_archive_require_docx` search_path
   pinned (`sql/2026-10-11_…`); leaked-password protection is a dashboard
   toggle on BOTH projects (Authentication → Sign In / Providers → Email).
3. Two-step sign-in rollout — staff enroll on LIVE → `MFA_REQUIRED = true` →
   `sql/pending/2026-10-06_staff_require_aal2.sql` (see the two-step section).
4. Client email sign-in readiness — custom SMTP on live (and dev);
   `SUPPORT_CONTACT` in `client-portal.html`.

**Next:** Twilio phone hotline → interactions (design session first) ·
Survey123 ingestion (blocked on a sample export) · ROW close-out TYPE.

**Later:** county assessor owner lookup (Phase 3) · Google Sheets push ·
parcel-number uniqueness normalized in the DB index · tribal stays parked.

**2027:** talk to 3–5 PI managers at other firms first, then multi-tenant
(`org_id`, AI gateway, metering).

**Recently completed (verified in code, 2026-07-24):**
- ✅ **Manual "Save to archive" button** — `manualArchiveReport()` → `_archiveReport()`.
- ✅ **NEPA checklist progress bar on project cards** — dashboard + cards render
  per-project checklist %; portfolio avg in `renderDash` (`avgNepaPct`).
- ✅ **NEPA Compliance section in PI Report Editor** — section type
  `'auto-nepa-compliance'` in Add Section; auto-populates checklist progress +
  comment-period compliance; AI-draft path; also a standalone quick report
  (`generateNepaComplianceReport()`).
- ✅ **AI contact importer Phase 2 (vision)** — image/PDF → Sonnet (now 5.5), in the
  Bulk-add grid (see the AI contact importer section above).

**Live / open:**
1. ✅ **Absorb popup report windows — DONE** (verified 2026-08-17). The only
   `window.open` left in `index.html` launches `importer.html`, which is a
   separate app, not a report. Reports all go through `showInlineReport()`.
2. **AI cross-report trend summary testing** — needs 2+ real exports to test fully.
3. ✅ **LEP/EJ + equity + public comments — DONE** (Aug 2026).
   `test/tests/39-title-vi-fields.test.js` (23 checks) covers what worked:
   both stakeholder checkboxes render, `saveStake` reads ids that exist, the
   flags round-trip, **survive an unrelated edit**, untick cleanly, stay
   findable via the filters, and reach `auto-pi-compliance`. Plus the meeting
   equity toggle. `test/tests/40-public-comments.test.js` (25 checks) covers
   the comment form — which turned out to be losing every field; see the
   "Public comments — ONE vocabulary" section above.
4. **Tribal consultation tracker — PARKED, deliberately hidden (Aug 2026, Jeff's
   call).** Built (`renderTribal()`, `openTribalModal()`, `pi_tribal_consultations`)
   but **not reachable**, and that is the decision, not an oversight. It was never
   fully tested or validated, and tribal consultation is a government-to-government
   process under EO 13175 / UDOT 08A2-07 and Section 106 — a half-validated tracker
   for THAT is worse than none, because it invites a consultant to treat an untested
   record as the consultation file.
   The gate is **one line in `setView()`**: `v==='tribal'` toasts "not available yet"
   and returns. `S.view` is assigned only after it and is never restored from
   storage, so the view cannot be reached. The nav item is a greyed `<div>` with no
   handler, so nothing invites a user in either.
   **Do not remove that line while tidying**, and do not "fix" the render dispatch at
   `S.view==='tribal'` as unreachable code — it is the re-enable switch. The module
   is parked, not dead: enabling it later should be small, not a rebuild.
   Guarded by `test/tests/43-tribal-hidden.test.js` (16 checks), which asserts the
   gate holds, that nothing calls `setView('tribal')`, and that the module is still
   present to re-enable.
5. **Client reporting redesign — end-to-end test** (redesign section below, step 5):
   confirm `sql/2026-07-06_portal_shared_reports.sql` was run, then share a report +
   publish a trend and confirm both render in the portal. Shipped-but-untested; client-facing.
6. **Debug logging — index.html is clean (July 2026).** The four routine
   `console.log` calls are gone: the `SB UPDATE sending:` / `SB UPDATE response:`
   pair in `sbUpdate()`, the `AI draft-all:` diagnostic, and the session-refresh
   happy path. They printed whole request/response bodies — a stakeholder's
   name, email, phone, address and LEP/EJ flags on every save — and the harness
   now gives better instrumentation (`shim.calls`, `VERBOSE=1`) without shipping
   it to users. **All 45 `console.error`/`console.warn` paths were kept
   deliberately**; they only fire on failure and are how a silent failure stays
   diagnosable. Do not "tidy" them away.
   ✅ **`importer.html` cleaned too (2026-08-17)** — `[sbAdd]`, `[sbAdd] OK`,
   `[Int insert]` and `[Auto-link]` are gone. Higher exposure than the
   index.html pair, because a bulk import printed every contact in the file.
   **Now enforced**: `test/tests/01-schema-drift.test.js` asserts zero
   `console.log` in all three apps, and that each still has failure logging.
7. **Closeout report generator — deprioritizes `_buildTrendComparison()`'s
   archive-diffing, decided but NOT designed or built (Sep 2026, Jeff's call).**
   Prompted by the same conversation that produced the docx-attachment feature
   above: once the real delivered document is the .docx (not the frozen JSON
   snapshot), diffing several archived snapshots against each other to produce
   a trend is solving a problem that matters less than it did — what the
   consultant actually wants at project close is one strong report built from
   the FULL live project history, not a summary-of-summaries stitched from
   whatever got archived along the way. `_buildStatusMetrics` /
   `_buildTrendComparison` / `generateTrendSummary()` stay as they are for
   now — nothing here has been touched — this is a placeholder for a future
   session to actually design the closeout report (what it pulls from, how it
   differs from a regular PI report, whether it also gets the same
   docx-attachment/portal-download treatment) before building it.

**Idea:** Jeff floated a built-in survey tool (prompted by QuestionPro). Decision:
**do NOT build a survey engine.** The survey-builder market (QuestionPro,
Qualtrics, SurveyMonkey, Alchemer, Typeform) is mature/commoditized — 80+
question types, AI generation, panels, dashboards. Rebuilding it lands us at a
worse QuestionPro and repeats the "don't compete on engagement scale" trap.

**What IS strategically sound — an ingestion bridge, not an engine.** Every
survey tool is generic; NONE ties responses to a NEPA comment period, Title
VI/LEP/EJ documentation, or the consultant's system of record. That linkage is
the Cirrus Cc thesis. So: pull survey responses via API into
`pi_public_comments` / `pi_comment_periods`, carrying the equity flags we
already have (`lep`/`underserved`/`equityFormSubmitted`) + response-status
tracking → a NEPA-documentable compliance record no survey vendor produces.
Fraction of the build vs. an engine; owns the compliance layer on top of
whatever tool the firm already runs.

**Candidate API sources (in priority order):**
1. **ESRI ArcGIS Survey123 — STRONGEST. The company already owns ArcGIS**, so
   no new procurement, and Survey123 is **geospatial** — responses carry
   coordinates, which ties directly into the existing stakeholder **Map view**
   (map public comment geographically). This is the differentiated angle;
   pursue this one first.
2. QuestionPro API / SurveyMonkey API / Google Forms API — generic fallbacks if
   a firm already standardized on one.

**Optional native piece (only if validation demands it):** a single narrow
purpose-built **meeting feedback / equity-intake form** (Title VI/LEP/EJ tied to
a specific meeting) — NOT a form builder. If it ever goes native, house it in a
separate **Horizon Interactive Technologies** app to keep Cirrus Cc's focus clean.

**GATE (do before any build):** validate with 3–5 PI managers at other firms —
ask specifically *"when you collect public comment during a NEPA comment period,
where does it live today and what's painful about documenting it?"* Build the
bridge only if the pain is "getting responses into a defensible record." If the
agency already owns that workflow, build nothing and stay focused.

## AI contact importer + interaction-logging scope (LOCKED, July 2026)

**Phase 1 SHIPPED** — text-path AI import built into the Bulk-add contacts grid
(`renderBulkAdd` in `index.html`). A paste box → `_aiParseContacts()` calls
Claude Haiku (`claude-haiku-4-5-20251001`) with a `json_schema` structured-output
contract → `aiExtractContacts()` populates the grid rows for human review before
Save. `BULK_ROWS` is now dynamic (`let`, cap `BULK_ROWS_MAX = 50`), resets to 10
on `openBulkAdd()`, grows to fit extracted contacts, plus a "+ Add rows" button
(`bulkAddMoreRows`). Helpers: `_bulkAIPanelHTML`, `_bulkSetRow`,
`_bulkRestoreRows`, `_bulkUnlockRow`. Panel carries an explicit PII/API notice;
extract button disabled with a hint when no Claude key is saved. Nothing saves
without review.

**Phase 2 SHIPPED** — vision path for the SAME desktop grid. `_bulkAIPanelHTML()`
has a "📎 Add image / PDF" file input (`accept="image/*,application/pdf"`, multi);
`_bulkFilesChanged()` shows attachments. `aiExtractContacts()` routes by input:
text-only paste → Haiku; any image/PDF attached → **Sonnet 5.5** (`CLAUDE_TEXT_MODEL`)
vision. `_aiParseContacts(content, model)` takes either a string (text) or an
array of content blocks — images as `{type:'image',source:{type:'base64',…}}`,
PDFs as `{type:'document',source:{type:'base64',media_type:'application/pdf',…}}`
(helper reads files as raw base64). Still lands in the review grid; PII/API
notice covers uploaded images. Models come from `CLAUDE_FAST_MODEL` (text,
`claude-haiku-4-5`) and `CLAUDE_TEXT_MODEL` (vision, Sonnet 5.5) — see the
Claude AI integration section.

**LOCKED SCOPE BOUNDARIES (do not cross without Jeff's explicit say-so):**
1. **Image/scan AI import → CONTACTS ONLY, DESKTOP ONLY.** The Bulk-add review
   grid is the only surface. A contact is just a name — misreads are trivially
   fixable in the grid, and import is additive/low-stakes.
2. **Interactions → MANUAL ENTRY ONLY. No AI scan/extract into interactions,
   ever.** An interaction is a compliance claim (date, who, what, logged-by)
   that can flow into an FHWA/NEPA report; it must be entered deliberately and
   attributed, not guessed from a scan. Rationale asymmetry: contact import =
   onboarding speed (low stakes); interaction logging = compliance integrity
   (the product itself).
3. **Mobile stays a logging tool, NOT an import tool.** Do not add scanners or
   AI importers to `mobile.html`. Field logging in the moment is its job.

**Quick-log interaction grid — SHIPPED (Aug 2026), desktop only.** "Quick log"
button on the Interactions view (shown only when a project is selected) →
`openQuickLog()` → `renderQuickLog()` replaces `#main`. 12 rows, cap
`QL_ROWS_MAX = 50`, "+ Add rows" **appends to `#ql-body` rather than
re-rendering** (a re-render would wipe everything typed).
- Columns: date · stakeholder typeahead · channel · direction · subject ·
  nature · summary · logged-by. `⇩` on date/channel/direction/subject/nature/
  logged-by copies down to every row below. Enter advances a row, Shift+Enter
  is a line break.
- **Every one of those six columns opens pre-filled** (today / Phone /
  Outgoing / General / Inquiry / your initials). The `⇩` is for propagating a
  CHANGED value — set row 1 to yesterday's date, click ⇩ — not for the initial
  state, so date is treated no differently from Channel. Blanking rows 2+ was
  considered and rejected: it costs a click or twelve date entries in the
  common "today's batch" case, and save requires a date (correctly — it's a
  compliance field, so silently defaulting a blank one would mis-date the
  record). `_qlDnRefresh()` hides the arrows on whichever row is last, since
  they'd copy to nothing, and re-runs after "+ Add rows".
- **Direction defaults to Outgoing (Sep 2026; was Incoming at ship).** The
  primary use of this grid is bulk INITIAL outreach on a new project — the
  team accumulating external contacts from scratch and then reaching out to
  all of them at once (a mass flyer email, a round of referral calls pointing
  people at the project website) — not fielding inbound contact. Outgoing
  matches that reality; a genuinely inbound batch still overrides per row.
- **Subject and Nature became real per-row columns in the same change**
  (previously hardcoded to `General`/`Inquiry` on every row, matching
  `saveInt()`'s own defaults when its selects are left untouched — see the
  "Deviation from the original spec" history below). They still default to
  General/Inquiry, `INT_SUBJECTS`/`INT_NATURES` (shared with the Log/Edit
  interaction modals' `f-isub`/`f-inat` — one list each, not three copies) —
  but a bulk-outreach batch is usually a `Notification`, not an `Inquiry`, and
  now that's a one-click ⇩ copy-down on row 1 rather than an `Log interaction`
  detour. `Notification` itself is a Sep 2026 addition to `INT_NATURES` for
  exactly this case (email/mail/newsletter reaching out to say something,
  as opposed to fielding one). `mobile.html`'s own `#log-nature` list — a
  hand-typed, not-cross-app-tracked subset that already happened to mirror
  desktop's other seven values — got `Notification` added too: a PI staffer
  physically handing a notice to a property owner in the field is the exact
  same outbound-outreach case, on the one app built for logging in the field.
- **Deviation from the original spec, historical:** the spec said direction
  blank, `subject`/`category` blank, `sentiment` 'Neutral'. `pi_interactions`
  has no `sentiment` and no `category` column (it's `nature`), and a blank
  direction renders as an empty badge in the interaction list — hence
  defaulted selects instead of blanks, from the start.
- **Locked constraints held:** the picker only offers stakeholders ALREADY
  linked to the project (no create, no master-list link, no fuzzy matching), so
  a save never touches `pi_project_stakeholders`. Blank stakeholder = anonymous.
  No follow-up, no issue link — those stay on the full modal. Nothing is scanned
  or AI-extracted; every field is typed.
- **Anonymous labels carry a batch counter.** `getAnonLabel()` counts what is
  already STORED, so calling it per row hands every anonymous row in one batch
  the same label. `saveQuickLog()` seeds a counter once and increments it.
- Validates the whole batch before writing any of it — a partial save leaves the
  consultant guessing which rows made it in.
- `_bgRefreshOK()` now stands down while either entry grid is open
  (`S.showQuickLog || S.showBulkAdd`); both hold unsaved rows in the DOM, and the
  60s refresh would re-render them away the moment focus left a field. That
  hazard already existed for bulk-add.
- Covered by `test/tests/07-quick-log.test.js` (42 checks), including that the
  picker never offers an unlinked contact, the new columns default correctly
  (Outgoing / General / Inquiry), and ⇩ copy-down works on Nature.

## Competitive positioning (researched June 29, 2026)

**Only direct competitor: PublicInput.com.** Founded by former transportation
planning consultants, used by 12 state DOTs + major MPOs + 200 consulting
firms. Functions as a public-facing engagement CRM (geo-targeted outreach,
multi-channel input collection, meeting/hearing management, analytics).
Enterprise SaaS, agency-wide contracts, likely $20K–$100K+/yr.

**Not direct competitors** (different category/buyer):
- **CivicPlus** — municipal CMS/resident self-service (permits, FOIA, 311), not PI/transportation-specific
- **Granicus** — citizen-facing engagement hubs/dashboards, not an internal PI consultant tool
- **OpenGov** — government finance/budgeting/transparency platform, community feedback is a minor module

**Second-tier competitor: Simply Stakeholders.** Modern AI-equipped stakeholder
RM platform, ~30 years founder experience, real clients (Glencore, NZ Transport
Agency, etc.), cheap entry pricing for small teams. General-purpose — not
transportation/NEPA-specific. Also note the wider field of established
infrastructure stakeholder tools: Tractivity (UK regulated infrastructure),
Borealis (large NA programs), Jambo (entry-level NA logging), EngagementHQ/
Granicus, Syrenis SMART, Citizen Space (UK compliance/consultation). **None of
these — including Simply Stakeholders — are purpose-built for FHWA/NEPA-
regulated U.S. transportation PI.** No NEPA stage tagging, no U.S. Title VI/EJ
compliance fields, no UDOT-specific workflow. That gap is real and is Horizon
Cirrus Cc's defensible niche.

**Core distinction driving all product decisions:** PublicInput is built for
the *agency* to collect public input at scale. Cirrus Cc is built for
the *PI consultant* (the Sunrise-style firm) to manage stakeholder
relationships, commitments, issues, and FHWA/NEPA compliance documentation
as their actual daily internal workflow. Compliance in PublicInput is a
byproduct of engagement data; in Cirrus Cc it is the product itself.

**Differentiation priorities (do NOT build toward #1):**
1. Do not compete on public engagement scale — no mass SMS/social campaigns, no survey tooling. PublicInput owns this; not worth contesting.
2. Own the consultant's internal system of record — this is the underserved buyer.
3. Compliance docs (NEPA stage tagging, tribal consultation, LEP/EJ flags, comment periods) should stay daily-use workflow tools, not just report outputs.
4. AI report drafting (`_claudeNarrative()`) is a genuine wedge — no competitor researched offers this.
5. Win on price/speed of adoption vs. PublicInput's agency procurement cycle — sell to the consultant/firm, not the state.

**Strategic framing for any UDOT-facing pitch:** position Cirrus Cc as
*complementary to* existing PublicInput contracts a DOT may already have,
not a replacement. Full positioning brief: `HC_Competitive_Positioning_Brief.docx`
(not in this repo — held by Jeff).

**Realistic market assessment (why this is winnable, not just defensible):**
1. No researched competitor is purpose-built for FHWA/NEPA-regulated U.S.
   transportation PI — this gap is real and currently unaddressed.
2. The builder is the buyer — every competitor was built by a software
   company selling to PI professionals from the outside; Cirrus Cc is
   built by a working PI professional living the daily workflow. This shows
   up in design details (report distribution groups, anonymous contact
   logging, bulk import) shaped by real friction, not guesswork.
3. Winnable segment is small-to-mid PI consulting firms (Sunrise and similar
   regional firms doing UDOT/county/municipal work), NOT enterprise agency
   contracts — competitors sell agency-wide enterprise deals with long
   procurement cycles; this product should stay fast-to-adopt for an
   individual firm or PI manager.
4. The win condition is staying laser-focused on the niche, not becoming a
   general-purpose stakeholder platform. Going general-purpose loses against
   better-capitalized, longer-tenured competitors (PublicInput, Simply
   Stakeholders, Tractivity). Staying NEPA/UDOT-specific keeps the moat.

**Open validation step (not yet done):** talk to 3–5 PI managers at other
firms (not just Sunrise) to confirm NEPA/UDOT pain points are shared
industry-wide before investing further in feature build-out. Treat this as
a prerequisite check before large new feature commitments — if a proposed
feature only reflects Sunrise's specific workflow rather than an
industry-wide PI pain point, flag it for Jeff to validate first.

**De-prioritized (keep, but don't deepen further — commodity ground already
served well by competitors):** influence map / stakeholder engagement
matrix visualizations, sentiment tracking / bulk sentiment update,
group/coalition management. Do NOT build mass public engagement tooling
(surveys, SMS blasts, social monitoring, resident-facing input portals) —
that's PublicInput/Granicus/EngagementHQ territory; Cirrus Cc stays
internal-facing.

## PI Client Portal — BUILT (`client-portal.html`, ~2,100 lines)

**Status: shipped and working.** The strategic bet (the "third leg" no
competitor has — keeping the PI firm's client continuously informed) is live.
`client-portal.html` is a standalone read-only client app.

**Two access paths:**
- **Token link (primary)** — Projects view → "Portal" button → `sharePortalLink()`
  creates a `pi_portal_links` row (UUID token) → URL
  `client-portal.html?token=XXX`. `bootFromToken()` resolves the token to a
  project and renders. No client login. Copy/Revoke wired via
  `_renderPortalBtnActive/Inactive()` on `.portal-btn-container[data-proj][data-style]`.
- **Magic-link login** (`pi_client_access` + Supabase OTP) for multi-project
  clients — the portal side (project selector, `switchProject`, per-project
  data) is fully built. **Phase 1 provisioning admin SHIPPED** (July 2026):
  Settings → **Client Portal Access** grants access **by email** (no pre-invite).
  Migration `sql/2026-07-13_client_access_by_email.sql` adds an `email` column +
  a JWT-email read policy (`lower(email)=lower(auth.jwt()->>'email')`) + an
  anon SELECT policy so the admin UI can list grants. Provisioning is **Option C
  (manual)**: `renderClientAccessPanel()` / `caGenerateGrantSQL()` /
  `caGenerateRevokeSQL()` generate INSERT/DELETE SQL you paste into Supabase —
  the app never writes grants (anon has no insert, so clients can't self-grant).
  `_clientAccessFetch()` reads `pi_client_access` with an explicit anon Bearer.
  **Functional today** (data loads via existing permissive RLS); **not yet
  isolated** — per-table email-scoped RLS + an Edge Function for one-click
  invite are Phase 2/3. `client-portal.html` needs no change (bootApp reads
  grants via RLS).
  - **OTP login prereqs:** portal login uses `create_user:true` (grant-by-email
    self-provisions the auth user on first OTP login); Supabase must have email
    signups enabled + the portal URL in Auth Redirect URLs. Session persists in
    `localStorage` with refresh-token renewal (survives browser close / ~1h
    token expiry); last email is prefilled; a one-time "bookmark this page" tip
    shows after login.
  - **⚠ Configure custom SMTP before onboarding real clients.** Supabase's
    built-in auth email sender is rate-limited (~few/hour + ~60s per-address
    cooldown → "email rate limit exceeded") and has poor deliverability (login
    links land in spam). Set Authentication → Emails → SMTP to a provider
    (Resend / Postmark / SendGrid / SES) before any real client logs in.
    **This is a Supabase-dashboard setting only — no app code changes and
    nothing to remove once configured; delete this reminder line when done.**
  - **`SUPPORT_CONTACT`** in `client-portal.html` sets the client-facing email
    shown on the "no access yet" screen (`_noAccessHTML`) — update it from the
    default before onboarding.

**Portal sections (NAV):** Overview (stats + "Needs Attention" panel),
Deliverables, Engagement (date-ranged), Issues, Commitments, Comment Periods,
and the AI Summary tab. Field curation is done per-fetch (only client-safe
columns queried).

### Portal demo polish (July 2026) — four additions, all on the client-facing side

1. **NEPA stage banner (`nepaBanner(p)`)** — colour-coded strip inside
   `projBanner()`, so it appears on EVERY tab. Reads `pi_projects
   .nepa_classification` + `.nepa_stage` (`nepa_process_stage` accepted as an
   alias). **Both boot paths now select those two columns** — if you add a
   project field the portal shows, remember there are TWO fetches to update
   (`bootApp` and `bootFromToken`). Palette: CE slate, EA amber, EIS teal,
   Post-NEPA/Construction green, N/A light gray; classification drives the
   colour EXCEPT that any project whose stage matches `/post-?nepa|construction/i`
   reads green regardless of how it cleared NEPA. The stage label strips the
   redundant `EA - ` / `EIS - ` prefix the desktop stores, so the banner never
   says "EIS … EIS - DEIS". Returns `''` when classification is unset — say
   nothing rather than guess. **No competitor models NEPA at all; this is the
   single highest-signal thing on the client's screen.**
2. **Deliverable progress** — a `.tile-meter` bar inside the Overview
   deliverables tile, plus an "Overall Progress" health card at the top of the
   Deliverables tab (`deliverableHealth(devs)`): big %, X-of-Y, teal bar, and a
   complete / in progress / not started legend.
3. **8-week engagement trend** (`engagementWeeks()` → `renderEngagementTrend()`)
   — ISO weeks (Mon–Sun), current partial week included as the last bar.
   Chart.js 4.4.1 from jsDelivr, loaded `defer` so it is always ready before
   the Overview renders. **`svgBarChart()` is a dependency-free fallback** that
   renders if `window.Chart` is missing or `new Chart` throws — the portal must
   never show a blank box at a conference because a CDN was unreachable. The
   Chart instance is held in `_trendChart` and destroyed before re-creating
   (project switch would otherwise leak canvases).
4. **Commitments tile** — 5th Overview tile: total, `N fulfilled · M open`.
   `.stat-row` is now `repeat(5, …)` with breakpoints at 980px (3-up) and
   768px (2-up); the print rule was updated to match.

   Two accuracy fixes came with this, both using data already fetched: the
   meetings query dropped its `limit=5` so the **Events** tile shows the real
   count (the activity list slices to 8 client-side), and the **Outreach** tile
   now shows the true 8-week contact count instead of the capped `5`. A
   `projAtFetch !== _projId` guard bails out if the user switches project
   mid-flight.

### Portal Overview: "Coming Up", not "Upcoming Deadlines" (Aug 2026)
The card sorted EVERY incomplete deliverable by `due_date`. But
**`pi_deliverables.scope_type` has three values and only one has a deadline**:
- `milestone` — one dated thing (pre-con open house, closeout report).
- `recurring` — a cadence (`freq` 'Bi-weekly', bounded by `milestone_start`/
  `milestone_end`, which are free **TEXT** like "End of construction").
- `fixed` — a quantity with no cadence (3 newsletters).

The last two carry the end of the CONTRACT WINDOW in `due_date`. On a
construction project most PI deliverables are one of those two, so the card
collapsed into the project end date printed three times — and got worse as
milestones completed. Seen live on PIN 15905: three rows, all "Oct 16, 2026",
against an Oct 31 project end.

**`devKind(d)`** is the rule. A declared `scope_type` wins; older rows (the demo
seed writes none) are inferred from the record's shape — a `freq` means
recurring, `contracted_qty > 1` means fixed — and it never guesses into
`milestone`, the one kind that would put a fake deadline back on a client's
screen.

- **Overview → "Coming Up — Next 60 Days"**, built in the async block after the
  fetches land (`#ov-coming`). Merges scheduled **events**, **milestone**
  deliverables, **commitments coming due** and **comment period** open/close
  dates. It is the ONLY forward-facing thing in the portal — Recent Activity and
  the trend chart look back, Heads Up is exception-based.
- **Division of labour with Heads Up:** Heads Up = wrong or urgent (overdue,
  high-priority, closing within 14 days). Coming Up = the neutral schedule.
  Past-due commitments are therefore excluded here, and a closing comment period
  Heads Up already named is skipped (`attnPeriodIds`) so one screen never prints
  the same line twice.
- **Deliverables tab: the "Due Date" column became "Schedule"** (`devSchedule`).
  Recurring shows cadence + window, fixed shows the contracted count (Progress
  already carries delivered-of-contracted), milestone still shows its date.
  `milestone_end` is printed **verbatim** — it is text, and `fmt()` rendered
  "End of construction" as an em dash and silently lost it.
- **Both boot fetches** now select `scope_type`, `freq`, `milestone_start`
  (and comment periods select `start_date`) — remember there are always TWO
  deliverable fetches to update, `bootApp` and `bootFromToken`.
- Guarded by `test/tests/35-portal-coming-up.test.js` (33 checks). Its recurring
  and fixed fixtures sit INSIDE the 60-day window on purpose, so their kind is
  the only thing keeping them out.

### Client portal data isolation — real, server-side RLS (Aug 2026)
`sql/2026-08-31_portal_client_isolation.sql`. Both portal access paths were
audited and found to be *worse* than "unscoped" in specific, concrete ways —
not just the general "permissive RLS" note this file already carried.

**What was actually found, before any fix:**
- **`pi_portal_links` was directly listable by anon.** Its `anon_select`
  policy was `for select to anon using (true)` — no filter. A bare
  `select token, project_id from pi_portal_links` with no WHERE clause handed
  back **every project's real token**, not a guess at anything. The
  "unguessable UUID" premise was moot the moment the table itself could just
  be listed with the public anon key.
- **`pi_parcels` / `pi_parcel_owners` / `pi_client_summaries`** carried
  `for all to anon, authenticated using (true) with check (true)` — anon
  could read **and write** any project's parcel data or trend narrative,
  no scoping at all.
- **`pi_report_archive`'s existing `anon_portal_read` policy never checked
  `client_visible`.** It scoped by project but not by share state, so a raw
  REST call that skipped the app's own `client_visible=eq.true` filter read
  every archived report for a project, shared or not.
- **The one piece of real per-table client scoping that predates this
  migration was dead code.** `pi_deliverables`' policy from
  `sql/2026-07-02_client_portal_step1.sql` matched on `user_id = auth.uid()`.
  `sql/2026-07-13_client_access_by_email.sql` switched grant provisioning to
  email-only and never backfills `user_id`, so that column has been NULL on
  every grant since. **The magic-link path has had zero real per-table
  enforcement since Phase 1 shipped** — isolation was client-side query
  filters in `client-portal.html` only.
- **The reason (that last one) couldn't be fixed by just adding a scoped
  policy**: an OTP-logged-in client and signed-in staff both land on the SAME
  Postgres role, `authenticated` (`index.html`/`mobile.html` always require
  login — `DEV_BYPASS` is `false`). RLS policies are OR'd and can only ever
  grant MORE access — a table's blanket `for ... to authenticated using
  (true)` policy (which staff need) stays fully open to a client's JWT no
  matter what scoped policy is added on top. The blanket policy itself had to
  be rewritten to exclude a client session.

**The mechanism.** `pi_is_portal_client()` (SECURITY DEFINER) is true iff the
caller's JWT email exists in `pi_client_access` — no new auth-side tagging
needed, that table already IS the client roster. Staff policies became
`using (not pi_is_portal_client())`; new client policies are
`using (pi_is_portal_client() and project_id in (their granted projects))`.
**Operational caveat: never grant portal access under a staff member's own
login email** — `pi_is_portal_client()` would then be true for their session
and every staff policy would stop applying to their own account. Use a
separate email, or the token link, to preview the client experience.

`pi_portal_links` itself is now revoked from anon entirely (SELECT included).
Two SECURITY DEFINER functions replace direct table access:
`pi_resolve_portal_token(uuid)` (the one lookup `bootFromToken()` needs — one
token in, its project_id out, or null) and `pi_portal_project_ids()` (lets
every other table's anon policy keep scoping by "this project has an active
link" without querying `pi_portal_links` directly, which a plain policy
subquery can no longer do once anon's grant on it is gone).

Thirteen tables get the same three-policy shape now: `<table>_staff_all` /
`anon_portal_read` / `<table>_client_portal_read`. `pi_tribal_consultations`
is staff-only, full stop — no anon or client policy at all, matching its
already-parked/hidden status (see the tribal section above) rather than
leaving a raw-REST path to it the UI was already built to avoid.

**A gap this does NOT close, documented loudly in the migration file itself:**
the anon policies still scope by "this project has SOME active portal link,"
not "the caller proved possession of THIS project's specific token" — Postgres
RLS can't see a different table's query-string filter. Closing it needs the
held token checked on every request (e.g. a custom header PostgREST exposes to
RLS via the `request.headers` GUC — a real, documented PostgREST mechanism).
**Not implemented**, because it could not be verified against the live
Supabase project from the sandbox that built this — this codebase already
shipped one integration wrong from search-result confidence instead of a live
check (see the UGRC endpoint story below) and this would be the same mistake
shape. **CLOSED Oct 2026** — see "Portal token links scoped to the token actually
held" below (live and verified). Project ids are small sequential integers, so this residual
gap is closeable by guessing, not just by holding a leaked token.

**Column-level exposure is also unchanged and out of scope here**: RLS gates
ROWS, not COLUMNS. A portal client with access to their own project's row
still gets every column PostgREST is asked for. If any of these tables ever
carry an internal-only column that shouldn't reach the client even for their
own project, that needs a view — a separate decision, not made here.

**Test harness note — this is the reason the whole thing could be verified at
all.** `test/lib/build-schema.js` now stubs a minimal `auth` schema
(`auth.users`, `auth.jwt()` reading `request.jwt.claims`, matching Supabase's
real implementation) — a bare Postgres cluster has neither, and this went
unnoticed for weeks: `run.js` swallows a migration's error per file, so
`sql/2026-07-13_client_access_by_email.sql`'s own `auth.jwt()`-referencing
policy had been **silently failing to even apply in the harness since July**,
harmless only because the harness's REST shim always queries as the
`postgres` superuser, which bypasses RLS entirely — no existing test could
tell a policy wasn't really there. Fixing that also surfaced that dashboard-
created tables in the synthetic schema had **no grants at all** (real
Supabase auto-grants both roles on those; the harness never replicated it
because nothing needed it before), fixed in the same file. `test/lib/
postgrest.js`'s shim gained minimal RPC support (`/rpc/<fn>?arg=val`, GET only
— what `pi_resolve_portal_token` needs) so `client-portal.html`'s new call
resolves through the shim like everything else.
`test/tests/47-portal-rls-isolation.test.js` is the one test in the suite
that actually switches Postgres role and JWT claims on a raw connection
(inside a transaction that is always rolled back, never committed, so nothing
leaks into the shared pool) and proves the isolation for real — anon and a
granted client each see only their own project, `client_visible` holds even
without the app's own filter, and neither can write. `test/tests/
17-grants.test.js` also changed: its "every policy must name both roles"
check assumed the one-policy-per-table shape every migration used before this
one; it's now a per-table coverage check (does every role holding a grant
have SOME applicable policy, not necessarily the same one) — which, as a side
effect of fixing a regex that couldn't parse quoted multi-word policy names,
also made it check `pi_client_access`'s policies for the first time ever.

**The same stub-schema technique was reused Sep 2026** for the final-.docx
attachment feature (see the Report archive section above). `build-schema.js`
now also stubs a minimal `storage` schema — `storage.buckets`,
`storage.objects`, and the `storage.foldername()`/`storage.filename()` helper
functions every Storage RLS policy uses — for the identical reason the `auth`
stub exists: without it, `sql/2026-09-16_report_final_docx_attachment.sql`'s
`insert into storage.buckets` and its `storage.objects` policies would fail
per-file under `run.js`'s swallowed errors, and no test could tell a Storage
policy wasn't really there either. `test/tests/49-report-docx-attachment.test.js`
follows the same role-switched, rolled-back-transaction pattern as
`47-portal-rls-isolation.test.js` to prove the trigger and the Storage
policies for real, not just through the app.

**Found only by running the migration's own verify query against the live
database — `sql/2026-08-31_portal_legacy_policy_cleanup.sql`.** Eight
policies existed in production that were in NO file in this repo:
`"client viewer can read own project <table>"` on `pi_comment_periods`,
`pi_commitments`, `pi_interactions`, `pi_issues`, `pi_meetings`,
`pi_projects`, `pi_public_comments`, and `pi_tribal_consultations` — applied
to role **`{public}`** (every role, anon included), using the same
`user_id = auth.uid()` condition as the one dead policy already known about
on `pi_deliverables`. Someone had evidently extended
`sql/2026-07-02_client_portal_step1.sql`'s pattern to the rest of
`sql/2026-07-04_portal_links.sql`'s nine tables directly in the Supabase SQL
editor, at some point, and never written it back to a migration — so nothing
in this repo's history, and no static audit of it, could ever have found
this. Confirmed inert (every `pi_client_access.user_id` is still NULL, so the
condition matches nothing today) but a real latent risk: `public`-role and
no `pi_is_portal_client()` check at all, so backfilling `user_id` on even one
grant row — a plausible future fix for the OTHER known gap, not a
hypothetical — would reactivate all eight instantly, `pi_tribal_consultations`
included, which this project deliberately made staff-only. Dropped by exact
name; the file's own verify query confirms zero policies anywhere still name
`public`. **The lesson for next time:** this migration's own design doc said
"the live database hides the mistake" as the reason for a verify-query step —
that step is what caught this, and it would not have been caught any other
way, including by everything in this session that came before actually
running it.

### Portal token links scoped to the token actually held — LIVE, verified (Oct 2026)
Closes the residual gap above. `sql/2026-10-05_portal_token_scoping.sql`
redefines **`pi_portal_project_ids()`** — the one function every anon policy
funnels through (all `anon_portal_read` policies plus the report-files Storage
policy) — to return only the project whose token arrives in the request's
**`x-portal-token`** header, read from `current_setting('request.headers')`.
No header, an unknown, malformed (compared as text, never cast) or revoked
token → no rows. Before: the anon key alone read any linked project by id.
`client-portal.html` keeps the link in `_portalToken` and `anonHdrs()` adds
the header, so every token-mode REST and Storage request carries it; login
mode never sends one.
**The probe also found that a token visitor's report download had never
worked:** Storage rejects (400) a request with only `apikey` and no
`Authorization`. `anonHdrs()` now sends `Authorization: Bearer <anon key>` as
supabase-js does (PostgREST still runs it as anon, so reads are unchanged).
Probe results, live: REST with header → the token, without → null; Storage
with header + Bearer → 200, without the header → 400. Staff and OTP clients are untouched (authenticated).
- **Verified live 2026-10-05:** in the SQL Editor (no header) anon sees 0
  projects; in a real token link's own tab, `pi_projects?select=id,name`
  returns exactly one row, that link's project (42, Logan City 400 North).
  Not yet exercised live: the .docx DOWNLOAD path, because the shared report
  used had no `docx_path` (grandfathered; it offers Print/PDF instead). Attach
  a final .docx to a shared report and download it via a token link to close
  that. Probe policy and function dropped 2026-10-05; the empty private
  `pi-header-probe` bucket may remain (Supabase refuses direct deletes from
  storage tables — remove it from the Storage page if wanted).
- **Rollout order mattered and was followed** (kept for the next such change). Hosted
  Supabase must (a) allow the header through CORS from putzke.github.io and
  (b) pass it to the database for BOTH PostgREST and Storage — none of which
  the sandbox can reach. `sql/probes/2026-10-05_portal_header_probe.sql`
  (a subfolder, so the harness never applies it) creates a temporary echo
  function, an empty private bucket and a policy matching only that bucket,
  plus a browser-console snippet run on the live portal page; then cleanup.
  Order: probe passes → push `client-portal.html` to `main` (an extra header
  is harmless to the old database) → run the migration (before the page is
  live it would blank every token link). Rollback SQL is in the migration.
  **Do not push the portal change to `main` before the probe passes** — a
  CORS rejection of the header would break every token link immediately.
- Covered by `test/tests/62-portal-token-scoping.test.js` (16 checks,
  role-switched on a raw connection like test 47): the right token sees its
  project across the portal tables and its report file; none, someone
  else's, a malformed or revoked token, or no `request.headers` at all sees
  nothing; staff unchanged; the page sends the token on every REST and Storage
  request. Verified to fail against the old function and against a portal
  that omits the header. Tests 47 and 49 now set the header as a visitor would.

### Staff are a LIST — `pi_staff` (Oct 2026)
`sql/2026-10-06_staff_allowlist.sql`. Found while building two-step sign-in:
every staff policy reads `not pi_is_portal_client()`, so "staff" meant ANY
authenticated session not in `pi_client_access`. The portal's email sign-in
sends `create_user: true`, so anyone could type any address, click the link in
their own inbox, and hold a session that every staff policy let in — every
project, contact and report file, and an INSERT into `pi_client_access` to
grant themselves a project. (Live check 2026-10-06: no stranger accounts
existed; the six auth users were staff, one real client, and the orphaned
`demo@horizoncompass.com`.) Enrolling an authenticator does not close it —
any user can enroll their own.
- `pi_staff(email)` + `pi_is_staff()` (security definer), and ONE
  **restrictive** policy `pi_staff_or_client` per RLS-enabled `pi_` table
  (`pi_is_staff() or pi_is_portal_client()`), plus `report_files_staff_or_client`
  on `storage.objects` scoped to the `report-files` bucket. Restrictive ANDs with
  the permissive policies, so none was rewritten and staff/clients see what they
  saw before. anon (token links) untouched.
- **Staff emails are never committed** (public repo). The file has a marked
  insert spot and refuses to run with an empty list. Add someone later:
  `insert into pi_staff (email) values ('name@example.com');` — lower-case.
- The policy goes only on tables with RLS ON. Production has it on all 24
  (checked 2026-10-06). The HARNESS builds dashboard-made tables
  (`pi_stakeholders`, …) without RLS, so role-switched tests count
  `pi_interactions`, not contacts.
- `test/run.js`'s `t.reset` re-inserts `staff@sunrise.example` after its
  truncate — the login every role-switched test (47, 49, 57, 62, 66) uses.
- Guarded by `test/tests/66-two-step-signin.test.js` (stranger sees nothing,
  cannot self-grant, cannot read report files; staff and clients unchanged).
- **RUN LIVE 2026-10-06** (pasted in the SQL Editor; the Supabase connector
  times out on writes). Verified through the connector: 25/25 RLS tables carry
  the rule, the storage rule exists, three staff logins listed; a role-switched
  stranger session reads 0 projects / contacts / interactions / report files
  while staff reads 6 / 257 / 969. `demo@horizoncompass.com` auth user deleted
  the same paste. `sunriseinput@gmail.com` is a portal-TEST login, not staff.

### Two-step sign-in — Microsoft Authenticator (Oct 2026, OPTIONAL for now)
Supabase Auth MFA (TOTP) over REST. Microsoft Authenticator gives a 6-digit
code ("Other account"); push approval would need Entra ID SSO — not used.
- **One block, three copies:** `// ── TWO-STEP SIGN-IN (begin)` … `(end)` is
  byte-identical in `index.html`, `mobile.html`, `importer.html` (test 66).
  `mfaGate(sess, done, cancel)` runs after the password and at boot for any
  stored session that is not `aal2` (read from the JWT by `_jwtClaims`). A
  verified factor → code step; the aal1 session sits in `_mfaPending` (memory
  only), so a reload at the code step goes back to the password. The verify
  answer is an aal2 session, stored before the app opens. An aal2 session
  boots with no extra call. The importer opened from the desktop gets the
  desktop's (already aal2) token in the URL and is not asked again.
- **Settings → Two-step sign-in** (desktop only — set-up is a desk job with
  the QR on screen): Set up (QR + typed key, then one code), Move to a new
  phone (new one verified FIRST, then the old factor deleted — never a moment
  with no way in), Turn off (hidden once required). GoTrue needs aal2 to delete
  a verified factor; the user has it after signing in with the code.
- `friendly_name` must be unique per user (GoTrue 422s otherwise) — it carries
  a seconds timestamp; test 66 caught a per-minute one colliding.
- If Supabase Auth can't be reached at boot the gate opens as before — the
  database step below is the enforcement, not the client.
- **Rollout:** (1) run the staff allowlist; (2) everyone sets up in Settings;
  check with the query at the top of the pending file; (3) set
  `MFA_REQUIRED = true` in all three apps (a user with no factor is walked
  through set-up at sign-in) and push; (4) run
  `sql/pending/2026-10-06_staff_require_aal2.sql` — staff policies then also
  require `aal = 'aal2'`; portal clients and token links unaffected; staff sign
  out and back in. `sql/pending/` is not applied by the harness; test 66 runs
  it inside a rolled-back transaction.
- **Lost phone:** `delete from auth.mfa_factors where user_id = (select id
  from auth.users where lower(email) = '…');` in the SQL Editor — confirm with
  the person first. They sign in with the password and set up again.
- Not verifiable here: Microsoft Authenticator scanning the QR (standard
  otpauth TOTP). Test once by hand. Test 66 fakes Supabase Auth statefully
  (users, factors, aal1/aal2 tokens, a good and a bad code, the aal2 rule for
  deleting a factor) via `openApp(file, {auth, session:false})`.

### Client Portal Access — staff can save directly now (Sep 2026)
`sql/2026-09-06_client_access_self_serve.sql`. The Settings → Client Portal
Access panel used to only generate copy-paste SQL (Phase 1, "Option C") — the
app itself could never write a grant, because `pi_client_access` only ever
granted `authenticated` SELECT, and before `pi_is_portal_client()` existed
there was no way to open write access to that role without also opening it to
every OTP-logged-in client (same shared-role problem the isolation migration
above solved for the data tables). With that function in place, staff and
client sessions can finally be told apart here too: `pi_client_access_staff_
insert`/`_delete` check `not pi_is_portal_client()`, so a client's own attempt
is rejected regardless of which project_id they try. `caSaveAccess()` /
`caRevokeAccess()` now write directly via the signed-in staff session
(`getAuthHeaders()`), with a `confirm()` summarizing exactly what will change
standing in for the old "read the SQL before pasting it" review step. If the
migration hasn't been run yet, the write fails and the panel falls back to
showing the equivalent hand-run SQL — the Phase 1 behavior, not a dead end.

**A DELETE-only policy silently did nothing, and this would have shipped
broken without live verification.** PostgreSQL requires a row to also pass an
applicable **SELECT** policy before an UPDATE/DELETE's own USING clause is
even consulted — a row must be "visible" to be modified. The pre-existing
`client reads own grants by email` SELECT policy
(`sql/2026-07-13_client_access_by_email.sql`) scopes to
`lower(email) = lower(auth.jwt() ->> 'email')`, correct for a client reading
their own row — but staff's own email never matches any grant row, so that
policy ANDs into every staff DELETE and zeroes it out. The delete reports
success (no error, 0 rows removed) — indistinguishable from "nothing to
delete" without checking. Caught with `EXPLAIN (ANALYZE)` against a real
Postgres before this shipped: the plan's Filter clause showed the unrelated
SELECT qual ANDed onto the DELETE's own. Fixed by adding
`pi_client_access_staff_select` (`for select to authenticated using
(not pi_is_portal_client())`) — OR'd with the existing client policy, so a
client session gains no additional visibility from it (their own
`pi_is_portal_client()` is true), while a real staff session can now see
every grant row, which both makes the DELETE work and lets `_clientAccessFetch`
read grants via a real staff login rather than only the anon key.
Verified against a real Postgres with the same `auth.jwt()` stub as the
isolation migration: staff insert+delete both work and are visible
immediately; a client's insert is rejected outright (RLS violation error) and
their delete of their own existing grant reports 0 rows affected; anon gets a
hard permission-denied on any write attempt.

**The anon-exposure trade-off is now closed too, same day —
`sql/2026-09-06_client_access_anon_lockdown.sql`.** The "admin lists grants
(anon)" policy from `sql/2026-07-13_client_access_by_email.sql` was a bare
`using (true)` — anyone holding the public anon key (embedded in
`client-portal.html`, which requires no login at all) could
`GET /pi_client_access?select=*` and list every client's email and which
projects they're granted, no exploit needed, just an unfiltered request.
Confirmed live before fixing it: a fresh Postgres with the pre-lockdown
policy really does hand back every row to `anon`. It existed only because
staff had no other way to see every grant at once; `pi_client_access_staff_
select` (added hours earlier by the self-serve migration) removed that
reason, so this migration revokes anon's `SELECT` outright and drops the
policy. `_clientAccessFetch` now reads via `getAuthHeaders()` (the signed-in
staff session) instead of the anon key. Re-verified after the fix: anon gets
a hard permission-denied on the same query that used to succeed; staff still
sees every row through their own login; a client still sees only their own
grant row, unaffected.

### Demo dataset — `sql/2026-07-26_udot_conference_demo_seed.sql`
**REMOVED FROM LIVE (Oct 2026, Jeff's call).** The live database now holds real
projects only. `sql/fixes/2026-10-10_remove_demo_and_test_projects.sql` deleted
the three demo projects plus `1200 South Wastewater` (PIN 700, a staff test
project) and their 156 project-only contacts. **Never run the seed on live
again** — it belongs on the dev database once that exists. The tests still use
it (the harness's own Postgres), unaffected.

Three realistic Utah projects with ~63 stakeholders, ~586 interactions,
deliverables, events, issues, commitments, a comment period with 23 public
comments, portal links and grant-by-email rows:
- **SR-154 / UDOT Region 2** — EA, NEPA/Environmental phase
- **Logan City 400 North** — CE, construction phase
- **3600 West Corridor Widening (`25-3W-DESIGN`) / Weber County** — CE, **design
  phase**, added Aug 2026 for right-of-way testing. Design is when acquisition
  actually happens and neither other project covered it. **7 parcels**, shaped to
  exercise every case the module handles: two co-owners on one parcel, three
  heirs on an unprobated estate, one owner across two adjacent parcels, an LLC
  plus its manager, one parcel with **no owner identified**, one unsubdivided
  parcel located by **coordinates only**, and a spread of acquisition types and
  statuses. Its 7 property owners are **project-level (`is_master = false`)** —
  they belong to this acquisition, not the master registry. Counts are asserted
  in `test/tests/02-seed-and-migrations.test.js`, so a re-run has to reproduce
  them exactly.
Built for the UDOT conference demo.
- **Idempotent** — re-running purges its own prior output (matched on project
  number `25-154-001` / `25-LC-400N`) and rebuilds. Demo-only stakeholders are
  deleted only when they are not linked to any other project; their ids are
  captured BEFORE the link rows are deleted (that's what identifies them) and
  deleted AFTER (foreign key).
- **Recent interactions are dated relative to `date_trunc('week', current_date)`**,
  not to fixed calendar dates, so the engagement chart is always full whichever
  week the seed is run. Everything before 2026-01-31 uses fixed dates tied to
  real milestones. **Re-run it the week of any demo** — safe to run any number
  of times.
  - The relative block generates **45 weeks** but the INSERT filters out any
    week landing on or before the fixed-history end (`2026-01-31`). Surplus
    weeks are discarded on an early run and materialise on a later one, so the
    seam between the fixed and relative blocks never opens into a gap and never
    double-counts. Verified gapless for run dates through **early Dec 2026**;
    past that a hole appears in Feb 2026 and the generator needs a wider window
    (bump `range(45)` in the generator, or move the fixed-history cutoff).
  - **Re-running wipes anything created against these two projects** —
    `pi_reports` drafts, `pi_report_archive` rows (including `client_visible`
    shares), `pi_client_summaries` trends, and any stakeholder added to a demo
    project and not linked elsewhere. Do report-editor / share / publish-trend
    demo prep AFTER the final re-run. Portal tokens and grant emails are fixed
    literals in the file, so those survive re-runs and bookmarks keep working.
- All organizations are real Utah entities; all individuals are fictional and
  use non-routable `demo`/`@demo-…` email domains.
- Validated by running it against a local Postgres 16 with a schema derived
  from `SB_TO_INT`, then rendering the portal against the result headless.
- Project A is classified EA per spec but carries DEIS/FEIS-flavoured
  artifacts; a commented-out block at the bottom of the file converts it to a
  full EIS (and to the 45-day DEIS comment period) in one paste.

**Security note — the residual token gap described here was CLOSED in Oct
2026** (see "Portal token links scoped to the token actually held"). Original
note kept for history: **UPDATED Aug 2026, see the "Client portal data isolation"
section below.** This used to say token isolation was client-side and RLS was
blanket-permissive. That is now real, server-side, per-table RLS for both
portal access paths — see `sql/2026-08-31_portal_client_isolation.sql`. One
piece of the old note is still true and is NOT closed by that migration: a raw
REST call scoped to a project the caller never received a token for, but which
has SOME active portal link, still passes anon's RLS today (the policy checks
"this project has a link", not "the caller holds THIS project's specific
token" — Postgres RLS can't see a different table's query-string filter).
Closing that needs the caller's token checked on every request, e.g. via a
custom header PostgREST exposes to RLS as a GUC, which is documented as the
next step in that migration file rather than shipped, because it could not be
verified against the live Supabase project from the sandbox that built it.

### GRANT BOTH ROLES — every migration, every time
A table a migration creates starts with NO grants (only dashboard-created tables
get them automatically), and Supabase runs requests as one of two roles
depending on which app is asking:
- **`anon`** — `client-portal.html`, genuinely unauthenticated.
- **`authenticated`** — `index.html` and `mobile.html`. They sign in through
  Supabase auth, and `getAuthHeaders()` sends the user's access token instead of
  `SUPA_KEY` once a session exists.

So a new table needs `grant … to anon, authenticated;` **and** a policy naming
both roles. Miss one and the app using that role reads an empty table, silently
in both directions: RLS with no matching policy returns zero rows rather than an
error, and `sbGet()` turns even a hard 403 into `[]`. The view then renders
"nothing here yet" over a table full of data.

It has happened twice, once each way. `pi_client_summaries` shipped without
`anon` (`sql/2026-07-06_client_summaries_grant_fix.sql`). `pi_parcels` shipped
without `authenticated` — the rows were in the database and the portal displayed
them while the desktop Parcels view was blank
(`sql/2026-08-09_parcels_grant_fix.sql`). The second was written by someone
reading the first as a warning about `anon` specifically rather than about the
pair.

**Now enforced** by `test/tests/17-grants.test.js`, which parses every file in
`sql/` and holds each table a migration CREATES to the rule. It is static
because it has to be: the live database hides the mistake behind dashboard
grants, and the harness creates everything as `postgres`. Deliberate
asymmetries live in that file's `ALLOWED` map with the reason — `pi_portal_links`
(anon read-only, or anyone holding one link could mint others) and
`pi_client_access` (read-only to both; grants are pasted in by an admin so a
client cannot self-grant). `test/schema.sql` now creates both roles, so
migration grants actually apply in the harness — before that every one of them
failed and `run.js` swallowed the error, which is why nothing caught this.

## IN PROGRESS — Client reporting redesign (locked plan, July 2026)

**Problem being fixed:** the standalone **Client Summary tab** (in Reports)
regenerated "recent" + "full" AI narratives from raw project data — a second
pipeline parallel to the PI Report Editor, redundant with the reports the
consultant already emails clients, and redundant with the Report Archive's
"AI: Summarize PI trend". Confusing for consultant and client.

**New model (simpler):** the portal's summary area = (1) ONE current curated
**trend narrative** (consultant edits before publish) + (2) a list of **shared
PI reports** (consultant toggles which archived reports are client-visible),
rendered in-portal + downloadable. No section suppression — full transparency
(sentiment matrix, interaction notes all OK per Jeff). Kill the Client Summary
tab and its raw-data regeneration entirely.

**Locked decisions:** (1) reports both render in-portal AND download; (2) no
section-level curation — everything a report contains is client-safe; (3)
single current trend, prior ones kept as history.

**Data model:**
- `pi_report_archive` → add `client_visible boolean default false`; portal reads
  rows where true. (Remember the GRANT.)
- `pi_client_summaries` → repurposed with NO schema change: trend text in
  `content_full`, `content_recent` unused, latest `published_at` = current
  trend, older rows = history.

**Build order (ALL CODE SHIPPED — migration CONFIRMED run 2026-07-24):**
1. ✅ Migration: `sql/2026-07-06_portal_shared_reports.sql` — add `client_visible`
   + idempotent grants. **CONFIRMED applied 2026-07-24** — verified all three parts
   present (client_visible column, `anon_portal_read` policy, anon UPDATE grant).
2. ✅ Cirrus Cc Report Archive: "Share with client" toggle per archived report
   (`toggleReportShared()` flips `client_visible`); trend button → generate →
   editable textarea → "Publish trend to client portal" (`publishClientTrend()`,
   keeps human gate). Client-portal status line in archive header.
3. ✅ Removed Client Summary tab + `generateClientSummaryDraft()` +
   `publishClientSummary()`. Stale `S.rptTab==='client-summary'` normalized to
   'reports'.
4. ✅ Portal (`client-portal.html`): "AI Summary" nav → "Project Updates" (→ "Project PI Reports", Oct 2026);
   both boots fetch `pi_report_archive?client_visible=eq.true` into
   `_sharedReports`; `renderSummary()` → current trend (`content_full`) + trend
   history + shared-reports list. `renderArchivedReportHTML()` renders sections
   read-only (mirrors desktop `_buildArchivedPreviewHTML`); `printSharedReport()`
   opens a clean print window = v1 "download" (true .docx deferred).
5. ✅ **End-to-end test — DONE** (Aug 2026), automated rather than manual:
   `test/tests/38-client-reporting-e2e.test.js` (27 checks) archives two
   reports, shares ONE, publishes a trend, opens the portal by token and
   asserts the shared report and the trend render while the unshared one does
   not. Verified failing against three injected faults: a snapshot that
   recomputes instead of freezing, a share toggle that writes nothing (the
   migration-not-run case), and a portal that drops its `client_visible`
   filter — which leaks an unshared report to a client.
   **Its most valuable assertion is the freeze.** After archiving it
   back-dates an interaction INTO the archived period and asserts the stored
   `tableHtml` is byte-identical and the client still sees what was issued.
   That is the entire reason snapshots exist and nothing was checking it.
   Two things it turned up, both real:
   - `loadReportSections()` prefers the Supabase draft and writes it back over
     `localStorage`, so pre-seeding `pir4_pi_reports_<id>` is silently
     discarded once a draft exists. Drive the editor inputs instead.
   - `client_visible` is `not null default false` in production but has no
     default in the generated harness schema, so a fresh row is `null` there
     and `false` in the field. Benign direction, but assert "not true" rather
     than `=== false`, and pin the production shape by reading the migration.
   A manual walkthrough on real data is staged separately in
   `sql/sr154-report-test/` — three periods whose state MOVES between archives,
   because only `auto-concerns` is period-bounded and a trend over static data
   has nothing to diff.

**Cross-app:** reports module is desktop-only — mobile/importer unaffected.


## FUTURE — ArcGIS Survey123 Integration (DESIGN LOCKED, blocked on a sample export)

**Status (July 2026): waiting on a sample Survey123 CSV export.** A real project
is coming where ESRI runs the survey and produces its own reports. Building the
column mapping without a real export means guessing, so this is parked until
Jeff can supply one — even a header row is enough.

**The validation gate in the PARKED section above is considered MET for the
ingestion direction**: a live project with a paying client where ESRI is
already the survey vendor is stronger evidence than 3–5 interviews. Keep the
build thin anyway — it validates the need on one project, not industry-wide.

**Framing — do NOT rebuild ESRI's analytics.** ESRI answers "what did the public
say" and will do it better. Cirrus Cc answers "what did we do about it, and can we
prove it to FHWA". ESRI is the instrument; Cirrus Cc is the system of record.

**Locked design decisions:**
1. **Target table is `pi_public_comments`, NOT `pi_interactions`.** It already
   has `period_id`, `category`, `sentiment` and `response_status` — the last of
   which is the compliance hook ("23 received, 18 responded") that no survey
   tool models.
2. **CSV first, API later.** Survey123 exports CSV natively and `importer.html`
   already has a column-mapping wizard. No API keys, no ArcGIS procurement, no
   OAuth; runs on the live project in days. The API pull is the same mapping
   logic with a different source, so nothing is wasted. Build the API only after
   the CSV path is proven against real responses.
3. **The invariant columns are the anchor.** Per-question columns vary by survey
   design, but `GlobalID`, `CreationDate`, `Creator` and the `x`/`y` coordinate
   columns do not. Auto-detect those; let the wizard handle the rest.
4. **Geometry is the differentiator.** `pi_public_comments` has NO lat/lng —
   needs a migration adding `latitude`/`longitude` (plus probably a `source`
   column so survey-imported rows are distinguishable from hand-logged ones).
   Plotting public comment on the existing stakeholder Map view is the thing
   ESRI has the coordinates for but will never show alongside your commitments
   and issues.
5. **Then a portal "Public Input" section** — volume, themes, geography, and
   responded-vs-outstanding. That is the peer-to-ESRI client reporting story:
   one link showing the survey AND what the PI team did with it.

**Build order:** CSV ingestion → geometry + map layer → portal section → API pull.

## FUTURE — Phone Hotline Voicemail Transcription (in development, vendor TBD)

Automatically transcribe project phone hotline voicemails and log them as
interaction records in Cirrus Cc. Construction-phase PI hotlines are
often required by UDOT or the contractor; currently voicemails require
manual transcription and re-entry into the PI log — a significant time drain.

Architecture planned: webhook from hotline provider → Supabase Edge Function
receiver → auto-create interaction record (anonLabel for unidentified callers,
subject tagging, follow-up flag if needed). Specific hotline provider not yet
selected — candidates include Dialpad, Twilio, or similar. Design session
required before build; vendor selection pending.

## FUTURE — Multi-tenant launch readiness (plan captured July 2026, not started)

**Context:** the app today is single-firm / pilot-grade. Before onboarding the
FIRST paying client, several things must be in place. This section captures the
agreed sequence and the human-vs-Claude split so a future session picks it up
cold. Do NOT start any of this without Jeff's explicit go — it's a deliberate,
staged project, not incremental work.

**The API-key ceiling (why this exists):** AI features are gated on a BYO Claude
key in `localStorage` (`compass_claude_api_key_v2`, per-browser, per-device) —
see `_getClaudeKey()`. Fine for internal/pilot use. NOT acceptable for paid
clients: (a) making clients paste raw API keys is bad onboarding, and (b)
hard-coding Horizon's own key in the static page would publish it (browser can
read anything it sends → extractable → uncapped charges, no per-client
tracking). The answer is a **server-side proxy**, not either of those.

**Build sequence (do in this order):**
1. **Multi-tenant data isolation — the long pole.** Add `org_id` to every table;
   replace today's permissive anon RLS ("anon can read/write everything") with
   tenant-scoped policies. This is the real gate on a paid launch, not the AI
   proxy. This is a DIFFERENT axis from the portal client-isolation migration
   (Aug 2026, see Client Portal section) — that one scopes a single firm's
   clients to their own project within the firm's data; this one scopes an
   entire FIRM's data from another firm's, for when more than one firm shares
   this Supabase project. The portal work did not need to wait on this, and
   this still hasn't started.
2. **Unified AI/API gateway (Supabase Edge Function).** Browser calls a Horizon
   endpoint, NOT `api.anthropic.com` / Google directly. The function holds the
   single key server-side, checks the caller's Supabase JWT (which tenant), and
   forwards. One pattern reused per provider (Claude, Google, later transcription
   vendors). Only app-side change is redirecting the `_claudeNarrative()` fetch
   target — one narrow call site. CSP `connect-src` updates to the Horizon
   endpoint instead of `api.anthropic.com`.
3. **Per-tenant metering.** A `pi_ai_usage` table logged by the gateway (tenant,
   provider, model, tokens, timestamp) → usage visibility, quotas, alerts,
   billing basis. Calls here are cheap (~400-token Haiku/Sonnet narratives,
   fractions of a cent) — small COGS to price into the subscription.
4. **Transcription receivers** (voicemail / live phone; ArcGIS Survey123) — same
   webhook → Edge Function → interaction-record pattern, built once the vendor is
   chosen. Rides the same gateway + metering rails.
5. **Security review** over the whole thing before go-live (Claude can do a pass;
   a human security check is strongly recommended given multi-client data).

**Human-only (Claude CANNOT do these — they're account/config/decisions):**
provider accounts + billing (Anthropic, Google Cloud, phone vendor); pasting keys
into **Supabase Edge Function secrets** (dashboard only); vendor + pricing
decisions; **custom SMTP** setup (already a standing portal prereq); domain; any
client procurement/legal/security sign-off.

**Split in one line:** Claude writes essentially all code, migrations, and Edge
Functions; Jeff makes the vendor/billing/account decisions and holds the actual
secrets. When Jeff says "we're ready to scale," walk him through the sequence
above end to end.


## PRODUCT DIFFERENTIATORS & COMPETITIVE CONTEXT (July 2026)

This section gives Claude Code the strategic context needed to make good
decisions when building new features, prioritizing work, and designing UX.
Always reference this before suggesting new features or architectural changes.

---

### WHO HORIZON Cirrus Cc IS COMPETING AGAINST

**1. PublicInput (direct competitor — most important)**
- Built for the AGENCY to collect public input at scale (surveys, SMS, hotlines,
  geo-targeted outreach, meeting management)
- Used by 12 state DOTs, 200+ consulting firms, enterprise SaaS $20K–$100K+/yr
- Their compliance value is a BYPRODUCT of engagement data
- DO NOT build: mass public engagement tools, SMS blasts, survey engines,
  social monitoring, resident-facing input portals — PublicInput territory
- Strategic framing: position HC as COMPLEMENTARY to PublicInput, not a
  replacement. A DOT already running PublicInput is an easier sell.

**2. Granicus (adjacent — not direct)**
- Massive government IT platform: 7,000+ govt orgs, 330M people connected
- EngagementHQ does online consultation hubs on agency websites
- Reporting flows: AGENCY → PUBLIC (broadcast to residents)
- HC Client Portal flows: PI CONSULTANT → AGENCY CLIENT (curated live view)
- These are fundamentally different relationships — Granicus is NOT a threat
- A DOT using Granicus for its public website + HC for its PI consultant's
  workflow is the IDEAL joint-customer scenario — lean into this framing

**3. Simply Stakeholders (second-tier)**
- AI-equipped, general-purpose, ~30yr pedigree, NZ/AU focus, cheap entry pricing
- No NEPA stage tagging, no U.S. Title VI/EJ compliance, no UDOT workflow

**4. Not competitors: CivicPlus, OpenGov, Tractivity, Borealis, Jambo**
- Different buyer, different category, different budget line entirely

---

### THE CORE DISTINCTION

PublicInput  = built for the AGENCY to manage public input at scale
Granicus     = built for the AGENCY to talk to residents
Simply Stakeholders = general stakeholder relationship management

Cirrus Cc = built for the PI CONSULTANT's internal workflow +
                  FHWA/NEPA compliance documentation +
                  live reporting back to the PI consultant's CLIENT

Nobody builds that third leg. That is the moat. Never drift from it.

---

### THE PI CLIENT PORTAL — PRIMARY DIFFERENTIATOR

No competitor — PublicInput, Simply Stakeholders, Tractivity, Borealis,
Granicus, EngagementHQ, Jambo, or Citizen Space — offers a live
client-transparency layer between the PI consulting firm and their agency
client. This is a structural product advantage, not a feature advantage.

**Why this matters vs. Granicus specifically:**
Granicus helps the DOT talk TO residents. HC Client Portal helps the PI
consultant keep the DOT informed about the work being done ON THE DOT'S
BEHALF. Especially valuable during construction when physical impacts are
greatest and the client most wants visibility without a manual reporting cycle.

**Portal improvements that would beat Granicus in the client-reporting space:**

1. NEPA STAGE BANNER — visible indicator of current NEPA stage in the portal
   ("Currently in: Construction Phase / Post-NEPA" or "EA Comment Period open
   through [date]"). Granicus has zero NEPA concept. High priority.

2. DELIVERABLE PROGRESS WITH % — completion percentage + due dates so the
   client knows a deliverable is 80% done before the PI manager sends it.
   Granicus shows published documents only — not work in progress.

3. COMMITMENT VISIBILITY — expose commitments made to the public back to
   the agency client in the portal. Granicus has no data model for this.

4. INTERACTION VOLUME TREND LINE — weekly engagement trend chart in the
   portal ("23 interactions this week, up from 14 last week"). Granicus
   shows agency outreach analytics — nobody shows the agency what the
   consultant's team is doing in the field week over week.

5. FRICTIONLESS ACCESS — the magic-link OTP login (already built) is the
   right pattern. Never add friction to client portal login. Granicus
   requires agency to be a Granicus customer with IT-provisioned access.

---

### SCOPE BOUNDARIES — NEVER CROSS THESE (locked)

- NO mass public engagement tools (surveys, SMS blasts, social monitoring)
- NO resident-facing input portals
- NO survey engine — ingestion BRIDGE only (pull from ArcGIS Survey123)
- NO AI auto-generation of interaction records — interactions are compliance
  claims, must be entered deliberately by the PI professional
- Mobile = logging tool only, NOT an import tool
- AI import = contacts only, desktop only, bulk-add grid only

---

### WHEN SUGGESTING OR BUILDING NEW FEATURES — ASK THESE QUESTIONS:

1. Does this strengthen the PI consultant's internal workflow OR the
   client portal transparency layer? → Good, build it
2. Does this compete on public engagement scale with PublicInput/Granicus?
   → Stop, do not build it
3. Does this only solve a Sunrise-specific workflow problem, or is it a
   pain point shared across PI consulting firms generally?
   → If Sunrise-only, flag it to Jeff before building
4. Does this require interactions to be auto-generated by AI without
   deliberate PI professional review? → Stop, never auto-generate
5. Does this add friction to the client portal login or client experience?
   → Redesign, frictionless client access is non-negotiable

---

### WINNABLE MARKET SEGMENT

Small-to-mid PI consulting firms (2–15 person teams) doing UDOT, county,
and municipal infrastructure work. Fast adoption, no IT procurement cycle,
$50–150/seat. Multi-tenant org_id isolation is the gate on paid launch.
Target: 2027 availability.

## Test harness schema fidelity (Aug 2026)
`test/schema-columns.txt` carries **column TYPES**, not just names, and
`build-schema.js` reads them instead of guessing from the column name. That
guess is what let `pi_meetings.attendee_ids` through: production had it as
`text` while the name said `jsonb`, so the app's JSON array was accepted in the
harness and rejected with a 400 in the field, losing every attendee list a user
ticked (fixed by `sql/2026-08-14_meetings_attendee_ids_jsonb.sql`).

The dump settled several more the old inference had wrong:
- **`project_id` is MIXED** — `bigint` on `pi_client_access`,
  `pi_client_summaries`, `pi_commitments`, `pi_groups`, `pi_portal_links`,
  `pi_reports`, `pi_report_archive`; `text` everywhere else.
- **`stakeholder_id` is MIXED** — `bigint` on `pi_commitments`,
  `pi_group_members`; `text` on `pi_interactions`, `pi_project_stakeholders`,
  `pi_parcel_owners`.
- `meeting_id`, `interaction_id`, `linked_stakeholder_id` are **text**.
- `report_num`, `annual_report_year`, `milestone_start`, `milestone_end` are
  **text**, not numbers or dates.

Consequences to remember: any SQL that unions or compares `project_id` across
tables must cast (`::text`), and `pi_issue_interactions` has **no `created_at`**
— the stale mapping was removed from `index.html`.

Refresh the file with the query in `build-schema.js`'s header comment, then
`node test/lib/build-schema.js`. `test/tests/01-schema-drift.test.js` asserts
every column declares a type, that the built schema matches, and spot-checks the
nine that were previously guessed wrong.


## Google Maps API — standing deprecations (Aug 2026)

`loadGoogleMaps()` pins **no version**, so we ride the weekly channel and Google's
removals land on us without warning. That is how `DrawingManager` broke (see
Polygon Phase 1 below). **Maps cannot load in the test harness, so NO test can
catch one of these** — a removed Google library is indistinguishable there from
the library that never loads. They surface only in the browser console.

**`google.maps.Marker` — deprecated Feb 2024, NOT removed.** Console prints a
notice on every map init. Google's wording is deliberately soft: *not scheduled
to be discontinued, will keep getting fixes for major regressions, at least 12
months notice before discontinuation*. What is lost is fixes for existing minor
bugs. **Decision: left alone**, and the reason is not laziness —

- The replacement, `AdvancedMarkerElement`, **requires a cloud Map ID**, and a
  map with a `mapId` **ignores the inline `styles` array**. All three of our maps
  pass that array for the dark navy theme. Migrating therefore moves part of the
  app's appearance out of this repo and into a Google Cloud console setting, on
  Jeff's account — a real loss for a single-file app with no build step, and not
  something Claude can do.
- Advanced markers take a DOM element, not `icon`. The numbered contact circles
  (`SymbolPath.CIRCLE` + label) become styled divs; the parcel squares are the
  easy half, since `_mvParcIcon` already emits an SVG.
- Four call sites, all `index.html`: `_mvRenderMarkers` (contacts + parcels) and
  two other stakeholder maps. Static Maps (print/export) is a different API and
  is unaffected.

Revisit when Google announces an actual removal date, or when Jeff is in the
Cloud console anyway. **`Polygon`, `Polyline` and `InfoWindow` are core and are
not deprecated** — only the optional drawing library was removed.

## Map: Polygon Drawing + Property Query (3 phases — **Phase 1 SHIPPED Aug 2026**)

### What it is
User draws a freeform polygon on the map (minimum 3 clicks / triangle, unlimited
vertices, any shape — corridor, neighborhood, irregular boundary). On close, the
app queries all stakeholders and parcels within that polygon and returns a results
panel (Option C: panel on map + "View in contacts list" filter button).

A configurable acreage threshold prevents accidental queries of enormous areas
(e.g. warn if polygon exceeds 500 acres before running query).

### Why it matters
- Draw a project corridor influence area → instantly see every affected stakeholder
- Draw a neighborhood → see which residents haven't been contacted yet
- Draw around a sensitive receptor (school, HOA, hospital) → pull targeted outreach list
- For ROW campaigns: draw the acquisition corridor → get every parcel + owner in one step
- Directly supports NEPA EJ analysis: show LEP/EJ-flagged stakeholders inside impact zone
- No competitor (Dialog, PublicInput, Simply Stakeholders, Tractivity) offers this

---

### A project with nothing plottable yet showed no map at all (Sep 2026)
Found live, right after building draw-area placeholder contacts: open the Map
view for a project with zero geocoded contacts AND zero located parcels (a
brand-new canvassing project, say) and the map area was a blank dark box —
not a Google Map, just the empty `#mv-map` div with a "No parcels on this
project yet." message floating over nothing. Worse, "Draw area" — the one
control that lets you discover parcels or contacts from a drawn shape in the
first place, i.e. exactly the workflow for a project with nothing tracked
yet — refused outright with "Plot the map first," a dead end for its own
primary use case.

Three separate early returns, all before `window._mvMap` was ever
constructed:
1. `renderMapView` returned before calling `loadGoogleMaps()`/`_mvGeocode()`
   at all, whenever `withAddr.length===0 && parcPlot.length===0`.
2. `_mvGeocode`'s own "nothing could be located" guard returned before ever
   calling `_mvRenderMarkers`, once geocoding (of nothing) finished.
3. `_mvRenderMarkers` itself bailed with `if (!anchor) return` — no first
   plotted point to center on, no map, full stop.

Fixed by falling back to **`UTAH_MAP_CENTER`** (`{lat:39.3, lng:-111.6}`,
zoom 7 — a statewide view) at all three points instead of returning. Every
project in this app is UDOT/Utah county work, so a whole-US default (raised
as the first idea) would only make the user zoom in from the wrong place
every time; Utah-statewide is the genuinely useful default here. A real
plotted point still zooms in close (zoom 11, unchanged) — the fallback only
ever widens the view when there is truly nothing to anchor on. The "No
parcels on this project yet" message stays visible over the live map
(`#mv-loading` is `pointer-events:none`, so it doesn't block drawing) rather
than being replaced by a generic geocode-failure wording — that wording is
now reserved for when something real was actually attempted and failed to
locate, which is a different, genuine finding.

Guarded by `test/tests/53-map-empty-fallback.test.js` (14 checks). Google
Maps cannot load in the harness at all (see the standing note above), so —
same technique `test/tests/19-map-parcels.test.js` already uses — this stubs
`window.google.maps` completely and verifies the CONTROL FLOW: `loadGoogleMaps()`
is actually reached (fix 1), `_mvGeocode` with nothing to geocode still
constructs a map and preserves the accurate empty-project message rather than
overwriting it (fix 2), a genuine locate failure keeps ITS OWN accurate
message, `_mvRenderMarkers` centers on Utah at zoom 7 with no anchor but
still zooms to 11 on a real one (fix 3, both directions), and `window._mvMap`
ends up truthy — the exact precondition `_mvDrawPoly` was failing on.

**The Parcels view's own empty state now points at the fix (Sep 2026).**
Before this, a brand-new project's Parcels list offered exactly one path —
"+ Add parcel," correct for a single known parcel but the wrong tool for
"capture everything along this corridor." `_parcGoToMapDraw()` — a "Draw
area on the map" button shown only when the project has zero parcels —
switches to the Parcels map layer, navigates to the Map view, and carries
the same project over, landing the user directly on the now-always-live map
from the fix above, ready to draw. Covered by the addition to
`test/tests/13-parcels.test.js` (5 checks): the CTA renders on a genuinely
empty project and actually sets `S.view`/`S.mapLayer`/`S.projectFilter`
correctly when clicked.

---

### PHASE 1 — Internal polygon query — **BUILT (Aug 2026)**
"Draw area" on the Map toolbar → `_mvDrawPoly()` → shape → `#mv-poly-panel` over
the map. Covered by `test/tests/42-map-polygon.test.js` (58 checks).

- **`google.maps.drawing` is GONE — never depend on it again.** The Drawing
  library was deprecated Aug 2025 and **REMOVED in Maps JS v3.65** (June 2026).
  `loadGoogleMaps()` pins no version, so the weekly channel took it away on its
  own schedule: Phase 1 shipped working against the docs and "Draw area" threw
  *"The DrawingManager functionality … is no longer available"* in the live app
  a day later. **Nothing in the test suite could have caught it** — Maps cannot
  load in the harness, so a removed Google library looks exactly like the
  library that never loads there anyway. That is the standing limitation, not a
  gap to be closed.
  Google points at **Terra Draw**; rejected — a third-party dependency, a new
  CSP script host and a GeoJSON model, to replace "collect the clicks".
  The vertices are now collected in `_mvDraw` / `_mvDrawAddVertex` /
  `_mvDrawFinish` / `_mvDrawCancel` and rendered with `google.maps.Polyline`
  and `Polygon` — **core shapes, still fully supported** (only the drawing
  library was removed; `editable:true` on a Polygon covers vertex dragging).
  `libraries=drawing` is dropped from the loader; `places` must stay.
  The test asserts `DrawingManager` and `libraries=…drawing` appear nowhere.
- **The rewrite made the drawing testable**, which the DrawingManager version
  never was: the state machine is ours, so the harness drives a whole four-click
  drawing — corner counting, the "at least 3" refusal, the live acreage, the
  size-guard prompt in both answers, the query, and the teardown — without a map
  object. Only the click-event wiring is now out of reach.
- **Closing the shape: Finish button, double-click, or Enter** (Escape cancels).
  NOT "click the first vertex again" — that needs a pixel-distance test against
  the projection, which is zoom-dependent, fiddly, and untestable here.
  `disableDoubleClickZoom` is toggled during the drawing and restored after, or
  the closing double-click also zooms the map.

- **The maths is hand-written, NOT `google.maps.geometry`** — `_polyContains()`
  (ray casting) and `_polyAreaAcres()` (spherical excess). This is the single
  most important decision in the phase and it was deliberate: **Google Maps
  cannot load in the test harness at all**, so anything built on
  `containsLocation()` / `spherical.computeArea()` would have been untestable
  end to end. Both are exactly specifiable and total maybe 25 lines, so the
  whole query path — containment, area, layer scoping, equity counts, the
  panel, the hand-off — is reachable without a map object. Only the
  DrawingManager shell is not. **Do not "simplify" these back to the library.**
  The roadmap above originally specified `libraries=drawing,geometry`; only
  `drawing` is loaded, and `places` (the address autocomplete) must stay.
  Longitudes are compared raw — a hand-drawn shape never spans the
  antimeridian, and pretending otherwise would be untested code.
- **It queries what is PLOTTED, not what is stored** — `window._mvGeocoded` /
  `window._mvParcelsGeo`, the caches the map already filled. So the query costs
  no geocode and can never bill, and a record the map could not place is one the
  shape cannot honestly claim. The empty-result panel says exactly that and
  points at the `#mv-errors` list above the map. Do not "improve" this by
  geocoding on demand inside a drawn shape — an unbounded geocode loop behind a
  drag gesture is precisely the uncapped-cost shape the portal map was refused
  for.
- **`_mvPolyQuery` respects `S.mapLayer`.** Returning parcels on a screen
  showing only contacts is a wrong answer, not a bonus; both directions are
  asserted.
- **The panel calls out LEP and EJ explicitly.** "Who inside this impact zone is
  flagged LEP or underserved" is the EJ question a drawn boundary exists to
  answer, and counting badges by eye down a list is not an answer.
- **`POLY_AREA_WARN_ACRES = 500`** — a drag across the state is nearly always a
  slip. Warns and asks; never blocks.
- **Editing the shape re-runs the query** (`set_at`/`insert_at`/`remove_at`), so
  dragging a vertex updates the answer instead of leaving a stale panel beside a
  changed boundary.
- **The hand-off sets `S.polyIds` and the contacts list SAYS SO.** `setView()`
  does not clear `S.polyIds`, so without the banner (with "Back to map" and
  "Clear") the user carries an invisible filter around the app — the same
  failure class as the old Comments project-scoping bug, where the list filtered
  correctly while telling you it was showing everything.
- **Mobile: not built, deliberately.** Polygon drawing on touch is bad, and
  mobile is a logging tool.

---

### PHASE 2a — UGRC reconciliation — **BUILT (Aug 2026)**
The roadmap below originally planned Phase 2 as one design session covering a
boundary layer, a polygon-draw query against UGRC, and an Import button, all
together. Split instead into RECONCILE (2a, built now) and DISCOVER (2b, still
pending) — reconcile is the smaller, verifiable step and doesn't need the
design session the combined version did; discover still does (untracked-parcel
import creates records off a still-unproven-in-production integration, which
is exactly the kind of decision this file's other "design session first" notes
exist to gate).

**What 2a does:** "Reconcile with UGRC" (Parcels view toolbar, scoped to the
current search/status filters — clear them to check everything) and "Check
now" (inside the parcel modal, `#f-pc-ugrc`) look a tracked parcel's APN up
against UGRC's statewide parcel layer and record whether the county's own GIS
has that APN, cross-checking `OWN_TYPE` and address. **It never creates a
pi_parcels row** — that stays 2b's job. `_ugrcReconcileParcel` /
`_ugrcReconcileList` / `ugrcReconcileVisible` / `ugrcReconcileOne`, next to
`delParcel` in `index.html`.

- **Endpoint:** `https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahStatewideParcels/FeatureServer/0`
  — the statewide basic layer (all 29 counties, one mosaic), CC BY 4.0, no API
  key (ArcGIS Online hosted feature layers published for public access, unlike
  the separate key-gated `api.mapserv.utah.gov` UGRC API). Fields used:
  `PARCEL_ID`, `PARCEL_ADD`/`_CITY`/`_ZIP`, `OWN_TYPE`. **LIR enrichment
  (acreage, market value, property class) is deliberately NOT pulled in
  yet** — those live on UGRC's per-county LIR layers, a different endpoint per
  county, and are staged as a later enrichment step on top of this one, per
  the roadmap's own priority (statewide basic now, LIR later).
  **⚠ This was WRONG for the first day it shipped, and the wrong-ness was
  invisible in exactly the way the caveat below warned about.** The sandboxed
  build environment cannot reach `*.arcgis.com` at all, so the endpoint was
  picked from search-result corroboration — three independent hits naming the
  same org id and a layer called `Parcels_Utah` — and shipped without a live
  request. `Parcels_Utah` turned out to be a REAL service under the same org:
  correctly schemaed, fully populated (284,759 rows), and answering every
  query with a clean 200. It just isn't the statewide layer — its actual
  coverage, decoded from its own extent, is roughly the Salt Lake Valley
  (lng -112.13..-110.98, lat 39.83..40.65). Every test against it for Weber
  County came back a well-formed `{count:0}` — indistinguishable from
  "genuinely nothing here" without decoding the extent. Found live, in the
  field, by a user drawing a real polygon around real tracked parcels and
  getting nothing back — ruled out ring winding, missing `where=1=1`, and
  location specificity one at a time before checking the layer's total row
  count (non-zero) and finally its extent (wrong region) settled it.
  **The per-APN match in `_ugrcQueryByApn` was affected too, and more
  seriously** — it matches on the bare 9-digit `PARCEL_ID` with no county
  scoping, so a "match" against the wrong regional layer is not a near-miss,
  it is a **coincidental digit collision with an unrelated parcel** presented
  as a confirmed compliance fact. `ugrc_matched`/`ugrc_own_type` values written
  before this fix are unverified and should be re-checked, not trusted.
  Corrected via `gis.utah.gov`'s own dataset page → "View API Resources" →
  GeoService, confirmed live (non-zero statewide count, non-zero Weber County
  count, extent decoding to the whole state) before merging. The lesson isn't
  "verify endpoints" in the abstract — it's that **a live 200 response proves
  nothing about coverage**, and search-result corroboration cannot substitute
  for decoding the actual extent of whatever the URL turns out to point at.
- **OWN_TYPE is not an owner name and never will be from this layer** — UGRC's
  own documentation says owner identity is withheld from parcel GIS sharing
  by design (a county data-sales protection). `ugrc_own_type` is a
  Federal/Private/State/Tribal cross-check field, nothing more; Phase 3 (county
  assessor APIs) is the only path to an actual owner name.
- **Matching is EXACT-MATCH ONLY**, same rule as the importer's owner
  attachment and for the same reason: a compliance-adjacent record either
  matches or is left for a human to resolve, never guessed into place.
  `_ugrcNormalizeApn` strips everything but digits (`pi_parcels.parcel_number`
  is free text like `"12-047-0001"`; UGRC's `PARCEL_ID` is a plain digit
  string) and queries for that exact value. No wildcard, no fuzzy fallback —
  a parcel number that doesn't reduce to a matching APN is a genuine
  not-found, not a bug to work around with a looser query.
- **A failed lookup is never recorded as "not found."** `ugrc_matched` is
  tri-state — `null` = never checked, `true`/`false` = a genuine answer was
  received. `ugrc_checked_at` is set ONLY alongside a real true/false. A
  network error, non-200, or an ArcGIS-level `{error:...}` payload throws and
  leaves both columns untouched. This app already paid for the alternative
  once, in production, when `sbGet` turned a 401 into an empty array
  indistinguishable from a table with genuinely no rows (see the "failed READ
  must never look like an empty table" note above) — the same shape of bug
  here would tell a consultant a parcel is missing from county records when
  the real story is "couldn't reach UGRC." `test/tests/44-ugrc-reconcile.test.js`
  asserts this by mocking a 500 and checking both columns stay `null`, then
  mocking success on the same parcel and asserting it recovers cleanly.
- **Coordinates are backfilled, never overwritten.** `latitude`/`longitude`
  are survey-grade by convention elsewhere in this app (see the map-layer
  notes above); reconciliation fills them from the matched feature's geometry
  bounding-box centroid ONLY when both are currently blank on the record. A
  centroid is an approximation, not a survey point, and is never allowed to
  replace one.
- **No boundary layer, no tile overlay, in this phase.** An always-on
  statewide tile answers a question nobody asked on most projects; a
  viewport-fetched boundary layer re-queries on every pan/zoom, which is the
  same unbounded-cost-behind-a-drag-gesture shape the portal map was already
  refused for (see the parcel map-layer section above). Rendering a real
  parcel boundary is worth doing only for a bounded set of parcels the app
  already has a reason to show — that stays with whichever later step
  actually returns one (2b's polygon-draw query, most likely).
- **Fully testable, unlike the polygon-draw feature it sits next to.** Phase 1
  (`_polyContains`/`_polyAreaAcres`) had to be hand-written because Google Maps
  cannot load in the harness at all. This feature is a plain `fetch()` with no
  map dependency, so `test/tests/44-ugrc-reconcile.test.js` drives the whole
  thing end to end — matched, genuine not-found, and the network-failure path —
  by intercepting the ArcGIS request the same way the harness already
  intercepts Supabase.
- Migration: `sql/2026-08-30_ugrc_reconciliation.sql` (4 nullable columns on
  `pi_parcels`; no grant change — existing table-level policies already cover
  new columns). CSP `connect-src` gained `https://services1.arcgis.com`
  (desktop only — mobile and importer don't touch parcel reconciliation, same
  "mobile reads, desktop manages" rule as the rest of the parcels module).

### PHASE 2b — UGRC discovery: untracked parcels in a drawn area — **BUILT (Aug 2026)**
On a drawn polygon (Phase 1), queries the same UGRC layer for every parcel
intersecting the shape, diffs against `pi_parcels` for the current project, and
appends an "Untracked parcels — UGRC" section to the polygon results panel
(`_mvDiscoverUntracked`, next to the reconciliation block in `index.html`).
Checkboxes, all checked by default; **Import creates nothing until pressed** —
the three open questions the roadmap left here were answered by the person
who'd actually use it (Jeff), locking scope BEFORE the build rather than
guessing:
- **Discovery only, not owner names.** UGRC has no owner identity to give —
  `OWN_TYPE` is Federal/Private/State/Tribal, never a name — so this phase
  answers "what's in this shape and is it already tracked," not "who do I
  contact." Getting an actual name means Phase 3 (county assessor APIs),
  which stays unbuilt and is its own decision.
- **Review before create.** Every checkbox starts checked, but nothing writes
  to `pi_parcels` until "Import checked" is pressed — same reasoning 2a
  already established for matching (never guess a compliance record into
  place), applied to creation this time instead of matching.
- **No boundary rendering.** 2a's reasoning against a tile/viewport layer
  holds here too — still an unbounded cost behind a drag gesture. What's new
  is only a bounded checklist of parcels UGRC returned, not a rendered shape.

**Bounded by a FEATURE COUNT, not acreage** — acreage doesn't bound parcel
count (a rural corridor can be huge and sparse, a city block small and dense),
and every result here costs a human a checkbox. `_ugrcCountInPolygon` asks
`returnCountOnly=true` FIRST; past `UGRC_DISCOVER_MAX_FEATURES` (300) the full
geometry+attribute query never runs at all — the same never-fetch-what-you're-
about-to-refuse discipline as 2a's own count-first design.

**`_mvDrawFinish()` stays synchronous** — test 42 asserts its return value
directly, and the whole point of the Phase 1 rewrite was a state machine the
harness can drive without a map object. So discovery is wired in as a
fire-and-forget async call made AFTER the synchronous point-in-polygon answer
is already shown (`_mvShowPolyResults` runs first; `_mvDiscoverUntracked` then
appends its own section once the network round-trip resolves) — the same
"answer sync facts immediately, patch in async ones as they land" pattern
`_mvGeocode` already uses for filling in markers after the synchronous
"no location" list.

**The diff normalizes both sides.** `_ugrcDiffUntracked` compares
`_ugrcNormalizeApn` on both the locally-tracked parcel numbers and UGRC's
`PARCEL_ID`, the same rule 2a's matching uses — a dashed local entry
("12-047-1001") and UGRC's undashed APN ("120471001") are recognized as the
same parcel, not two.

**A residual gap this makes more likely to bite, flagged rather than
silently fixed:** an imported row is stored under UGRC's raw undashed APN
(reformatting it into a guessed dash pattern would be exactly the kind of
guess this feature's own philosophy refuses). `saveParcel`'s duplicate guard
and the database's own unique index compare the RAW string, not a normalized
one — so a later hand-typed dashed entry for the same parcel would not be
caught as a duplicate by either. The import path's own re-check is normalized
(so a race against another import or a reconcile is caught), but the
general-purpose guards are not. That's a pre-existing gap this feature
increases the odds of hitting, not one it invents — normalizing `saveParcel`'s
guard and the unique index is a separate decision affecting every existing
row and hasn't been made.

**Outlines on the map, and a review-all convenience — both added after the
Aug 2026 endpoint fix, live-tested against real Weber County data (158
untracked parcels in a 162-acre corridor).** `_ugrcQueryPolygon` already asked
UGRC for full geometry (`returnGeometry=true`) to compute the centroid marker
position; `_ugrcRingToPath` keeps the outer ring too, and
`_mvDrawUntrackedBoundaries` draws each untracked parcel as an amber
`google.maps.Polygon` outline — a CORE shape, same as Phase 1's own drawing,
no new dependency. Inner rings (holes) are not drawn; a residential lot is
essentially never a donut, and the outline exists to orient the eye, not to
survey the parcel. Shapes are tracked in `_mvUntrackedShapes` and cleared on
every re-run (a vertex drag re-queries) and on `_mvClearPoly`, so they never
stack across shapes or survive a cleared drawing. **"Check all" / "Uncheck
all"** (`_mvSetAllUntracked`) sit above the checklist once a real corridor
turned up 158 candidates in one pass — reviewing each individually did not
scale. Because "Check all" makes a big batch one click away, **importing more
than 20 checked parcels asks for confirmation** naming the count, the same
size-guard spirit as the drawn shape's own acreage warning, just on the create
side instead of the query side.

Covered by `test/tests/45-ugrc-discover.test.js` (33 checks): both early-exit
guards (no project selected, contacts-only layer) make zero network calls; the
count-too-high guard refuses before the full query ever runs; a genuine zero
stays quiet rather than cluttering the panel; a count-check failure is
reported as a failure, never as "nothing found"; import writes only the
checked, genuinely-untracked parcel and never duplicates the already-tracked
one; `_mvDrawFinish` actually triggers discovery with the finished path; a
geometry-bearing feature carries an outline path in the same `{lat,lng}` shape
the rest of the app's map code uses; Check all / Uncheck all toggle every box;
and the >20 import confirmation is asked, named correctly, and actually gates
creation in both directions (decline creates nothing, accept creates all of
it).

---

### PHASE 3 — County assessor integration for owner name + mailing address
**What:** Auto-populate actual owner name and mailing address from county assessor
public REST APIs when importing parcels from UGRC

Utah county assessor data availability:
- Salt Lake County: robust public assessor API — owner name + mailing address
- Utah County: public parcel viewer with REST endpoint
- Weber County: public assessor data accessible via REST
- Cache County, Davis County: varying levels of API availability
- All 29 counties contribute to UGRC monthly — APN is the key to cross-reference

**What Phase 3 adds:**
- On UGRC parcel import: auto-query county assessor API using APN to get
  actual owner name and mailing address
- Auto-populate pi_parcel_owners record with assessor data
- Flag data source (UGRC / county assessor / manual) on each parcel record
- This completes the ROW campaign workflow: draw corridor → get all parcels →
  auto-fill owner contact info → import to HC → begin outreach

**Requires design session + county-by-county API mapping before build**
- Start with Salt Lake County and Utah County (highest UDOT project volume)
- Build county adapter pattern so adding new counties is additive not structural

---

### Draw-area placeholder contacts — BUILT (Sep 2026)
A small in-person canvass (walking a block of property owners door to door)
knows the situs address of a house before it knows who lives or owns there —
name, phone and email, several of which the app requires to save a contact,
simply aren't known yet at the moment of drawing the shape. "New contacts —
draw area" sits beside the existing "Untracked parcels — UGRC" section (Phase
2b, above) in the same polygon results panel, reads the SAME
UtahStatewideParcels layer for the same reason that section does (situs
addresses are already right there in county GIS records), and offers up to
10 addresses per capture with no linked contact yet, for reviewed creation.

**This is contact creation, not ROW/acquisition tracking — no pi_parcels row
is written, ever.** Confirmed explicitly before building: the feature
populates the project's ordinary contact list (`pi_stakeholders` +
`pi_project_stakeholders`), the same list `renderBulkAdd`'s AI contact
importer feeds, not the Parcels module. A canvassing project like this one
usually isn't a ROW/acquisition project at all, and the two modules track
different things — acquisition status and notice dates have no meaning here.

- **`DRAW_AREA_CONTACT_MAX = 10`** — a deliberate workflow-scoping choice
  (this is meant to be walked one small block at a time), not a technical
  ceiling like `UGRC_DISCOVER_MAX_FEATURES`. Softer than that cap too:
  candidates beyond it are simply not shown, with a note to draw a smaller
  shape, rather than refusing the whole result the way an oversized area
  refuses Phase 2b's discovery.
- **A SEPARATE UGRC query from `_mvDiscoverUntracked`, not a shared fetch.**
  UGRC is a public, keyless, free-to-query layer, so a second round trip when
  the layer is "Both" costs nothing that matters, and keeping the two
  features' queries independent means neither one's tests or gating rules
  have to account for the other. Mirrors Phase 2b's own count-first,
  never-silently-truncate, failure-is-never-silently-zero discipline exactly
  (`_ugrcCountInPolygon` before `_ugrcQueryPolygon`; a network error leaves
  the panel saying so, never "nothing found").
- **Layer gating is the mirror image of the untracked-parcels section's.**
  That section bails when the layer is contacts-only; this one bails when the
  layer is parcels-only (`(S.mapLayer||'contacts')==='parcels'`) — showing
  contact candidates while looking at a parcels-only map would be exactly the
  wrong-content-for-the-view mistake the other section's own rule exists to
  avoid, just in the other direction.
- **The candidate diff (`_mvContactCandidateDiff`) matches on the STREET
  address only**, normalized (`_normAddr` — lowercase, strip punctuation,
  collapse whitespace, compare the segment before the first comma), against
  every stakeholder already linked to the project. UGRC's city/zip
  formatting and whatever a contact's address was typed or Places-picked as
  don't line up closely enough to compare the whole string. A false negative
  here (offering a candidate that already has a contact) is safe — the human
  reviewing the checklist just unchecks it; a false positive (hiding a real
  gap) would not be, so the match errs toward showing more, never fewer.
- **Naming: `firstName` "Property", `lastName` a running number, scoped to
  the project and never restarting.** `_mvNextPropertyNum` counts what is
  already stored — the same rule `getAnonLabel()` already uses for anonymous
  interaction labels — so a second capture on the same project continues
  from Property 4, say, rather than minting a second "Property 1" that would
  collide with a different house's placeholder in the contact list.
- **`needs_review` (new `pi_stakeholders` column,
  `sql/2026-09-26_stakeholder_needs_review.sql`) is the flag, not the name.**
  Earlier drafts of this feature considered encoding "unverified" only in the
  placeholder name, and that was deliberately rejected: this app has already
  been bitten more than once by something that *looks* complete but silently
  isn't (the anonymous-interaction-as-internal bug, the docx table-toggle
  leak — both elsewhere in this file), and "Property 3" reads as a real
  logged contact the moment it appears in a report or export. The flag badges
  amber ("Needs review") in place of the normal role/type tag everywhere a
  contact renders — the project contact list row and the detail pane, which
  also shows a callout banner explaining the address is a situs address, not
  a confirmed mailing address, with a one-click "Edit contact" straight into
  the real edit modal. Placeholders are `is_master:false` — project-only,
  never added to the firm's master registry, since nothing about them has
  been confirmed yet.
- **The address IS populated immediately, deliberately — not left blank.**
  A live design question while planning this feature: should the mailing
  address stay blank until confirmed, matching the parcels module's owner-
  mailing-address-vs-situs split? Rejected for THIS feature specifically —
  without a linked `pi_parcels` row (there isn't one here) there is nowhere
  else on a plain contact record to put "which house this is," and the whole
  point of the capture is knowing where to knock. So `address` is filled with
  the situs address right away — often correct (the owner lives there) and
  when it isn't, `needs_review` plus the notes field it seeds say so loudly
  rather than leaving the field team with no address at all.
- **A renter answering the door is a SEPARATE contact, never a patch to the
  placeholder.** Discussed explicitly before building: if the person at the
  door turns out to be a renter, not the owner, they get logged as their own
  contact (type `Resident`, their own real address) rather than overwriting
  the placeholder meant to represent the owner — the placeholder still stands
  for "someone owns this parcel, needs review," and the renter conversation's
  detail (owner lives elsewhere, is unresponsive, whatever) goes in that
  interaction's summary, not into either contact record's static fields.
- **Sequential `sbAdd` per row, real id awaited before the next starts —
  never the lazier `DB.set`-with-a-temporary-id pattern** the untracked-
  parcels import next to it uses. This is the SAME race this codebase has
  already diagnosed and fixed once (see the "freshly logged interaction
  could open its own Edit modal blank" note above): a new row rendered
  before its real Supabase id lands can open blank if clicked within about a
  second. Reviewing a placeholder immediately after creating it — editing in
  the real name once you've spoken to someone — is the expected next action
  here, squarely inside that failure's risk window, not a hypothetical one.
  Mirrors the Bulk-add grid's own stakeholder-creation loop for exactly this
  reason.
- **Clearing the flag — added Oct 2026; until then NOTHING could.** Desktop
  `saveStake()` rebuilds the record from the form and never carried
  `needsReview`, so `toSB` dropped the key, the PATCH never touched the column,
  and the badge came back on every reload however complete the contact became.
  Now a flagged contact's edit form (desktop `#f-sneeds`, mobile `#add-needs`)
  shows a ticked **Needs review** toggle — rendered ONLY for a flagged contact,
  so nobody can flag an ordinary one by accident — and `saveStake()` always
  writes an explicit boolean (absent box = `false`), since `undefined` would be
  dropped again. Untick it once the name and mailing address are confirmed.
  Mobile is where this is mostly done: the canvass happens on the phone.
- Guarded by `test/tests/52-draw-area-contacts.test.js` (44 checks): both
  layer-gating guards (no project, parcels-only) make zero network calls; an
  address with an existing contact is excluded from the checklist; the
  10-per-capture cap trims the list and says so; the over-threshold and
  network-failure paths behave exactly as Phase 2b's own do; creation writes
  the checked candidates only, tagged `needs_review`, typed Property Owner,
  project-only; numbering continues across two separate captures on the same
  project rather than restarting; the "Needs review" badge and callout
  banner render on the created contact; and `_mvDrawFinish` actually wires
  discovery in.

**Two gaps found live, both fixed the same day, before this ever shipped to a
real canvass:**
- **A UGRC record with no `PARCEL_ADD` on file joins down to just "City,
  Zip"** (`_ugrcQueryPolygon`'s `[PARCEL_ADD, PARCEL_CITY, PARCEL_ZIP]
  .filter(Boolean).join(', ')` — a blank street just drops out). Seen live: a
  drawn shape offered several checklist rows reading only "Plain City,
  84404" — real UGRC parcels (vacant land, an ag parcel, a common/HOA strip),
  just none with a county-assigned street address. A placeholder contact for
  an address nobody can walk up to defeats the point of the feature, so
  `_mvHasStreetAddress(addr)` (`/^\d/.test(...)` — a real US situs address
  starts with a house number) filters those out of `_mvDiscoverContacts`
  before they ever reach the checklist, the same say-what-can't-be-placed
  instinct `_mvShowNoLoc` already applies to parcels the map can't locate at
  all. If EVERY leftover record in the shape fails this check, the section
  says so explicitly ("N parcels … have no street address … nothing to
  canvass") rather than silently disappearing, which would look identical to
  "every address already has a contact."
  **Deliberately scoped to contacts only — confirmed explicitly, not
  guessed.** `_mvHasStreetAddress` is called from exactly one place,
  `_mvDiscoverContacts`. `_mvDiscoverUntracked` (the untracked-PARCELS
  section right next to it) is untouched and still offers a streetless UGRC
  record for import — a vacant or unsubdivided parcel with no street address
  is a completely normal, trackable ROW/easement record, coordinates-only,
  which is the entire reason the Parcels module already treats coordinates
  as first-class (`_parcHasLoc` = coordinates OR situs address — a street
  address was never required for a PARCEL). The two sections read the same
  UGRC data and answer differently on purpose: a house needs a street
  address to be worth knocking on; a parcel does not need one to be worth
  tracking.
- **The candidate diff can never catch the OTHER half of the "might already
  have this contact" problem.** Raised live, working through the feature:
  what if the project already has a real contact — name, phone, email all
  captured — for one of these houses, but their `address` field was simply
  never filled in? `_mvContactCandidateDiff` only excludes a candidate when
  an *existing* contact's address matches; a blank address has nothing to
  match against, so a duplicate placeholder was a real, silent risk.
  **Not solved by better matching** — deliberately: there is no reliable
  signal to connect a bare situs address to a nameless-address contact
  without guessing by name, and this app has repeatedly rejected fuzzy
  matching for exactly this class of link (parcel-import owner attachment,
  UGRC APN matching — both exact-match-only, a human resolves the rest).
  A hard usage fence was considered and rejected too — gating the feature to
  "before this project has any contacts" would only ever allow ONE capture
  per project, contradicting `_mvNextPropertyNum`'s own design for repeat
  visits, and a "before any interactions" version doesn't close the gap at
  all (importing known contacts via Bulk-add first, then canvassing, is a
  completely normal sequence with zero interactions logged).
  `_mvAddresslessContacts(projId)` instead hands the reviewer a short, honest
  list — every project contact with a blank `address` — rendered as an amber
  warning inside the SAME checklist panel ("N contacts already on this
  project have no address on file — check the list below against them
  first: <names>"), so the one person who can actually make that judgment
  call (do I recognize this name) sees it right where the decision is being
  made. It does not suppress or alter any candidate; it is visibility, not
  an automated filter. If a duplicate slips through anyway, the fix is
  manual — copy the address onto the real contact, delete the placeholder —
  not worth building merge tooling for a 10-per-capture feature.
  **EXTERNAL only, found live the same day.** On a real 63-contact project
  the first version of this list came back 48 names — nearly the whole
  roster — because internal team members (agency PMs, engineering staff)
  almost never have an address on file either, for the ordinary reason that
  nobody bothers to add one for a colleague. An internal contact is
  essentially never who you'd meet walking a construction route, so
  including them buried the genuinely useful signal in noise a reviewer
  would just learn to skip past. `stakeholderRole` lives on the
  `pi_project_stakeholders` LINK, not the stakeholder record itself (a person
  can be Internal on one project and External on another), and blank/unset
  defaults to External — the same convention the contact list's own role
  badge already uses (`(lk.stakeholderRole||'External')`). `_mvAddresslessContacts`
  now excludes `stakeholderRole==='Internal'` before checking the address.

---

### Strategic note
This feature set directly addresses the FHWA AID Demonstration grant narrative —
geospatial querying for environmental review and public involvement is exactly the
"innovation in the environment phase of highway project delivery" FHWA wants to fund.
No competitor (Dialog, PublicInput, Simply Stakeholders, Tractivity, Borealis)
offers a polygon-draw-to-stakeholder-query capability. Dialog has a GIS layer
display but no interactive spatial query against stakeholder and parcel records.

## Link crawl (`test/tests/27-link-crawl.test.js`, Aug 2026)
Walks every view and exercises every link. Written because four bugs in one
session were the same shape — a control that rendered fine, threw nothing, and
quietly did the wrong thing. Two layers, because the click surface is lopsided
(~1,700 clickable elements, only ~51 distinct handlers, 1,218 of them the rows
of one list):
1. **Static, total coverage** — every `onclick` in every view is parsed and every
   function it names must exist. String literals are blanked first, or prose
   inside a toast (`showToast('API key saved (obfuscated)')`) reads as a call to
   a function named `saved`.
2. **Behavioural, sampled** — one element per (view, scope, handler) is clicked
   and must not throw, blank `#main`, or leave `S.view` invalid. Run **twice per
   view**: unscoped and scoped to a project, since several controls only exist
   when a project is selected.

Crawl-specific rules learned the hard way:
- **Identify the element by WHAT IT CALLS, never by index.** The first version
  recorded an index while planning and reused it after a click had changed
  `S.projectFilter`; the view re-rendered with different controls and the crawl
  silently clicked the wrong button — skipping the very handler a deliberately
  injected fault was meant to catch.
- **`window.open` must return a window-ish object, not `null`.** `openImportTool`
  treats `null` as "popup blocked" and falls back to same-tab navigation, which
  destroys the test context. Correct app behaviour turned into a fake bug.
- `blob:` URLs are the .docx/.xlsx downloads, not popups.
- Writes are stubbed and `confirm()` answers no, so a crawl cannot delete a demo
  record. The crawl tests wiring; what each handler DOES has its own test.
- **Verify it can fail.** Injecting a renamed handler and a throwing handler is
  the only way to know it works — the second injection is what exposed the index
  bug above.

## Supabase project
- URL: `https://ncfbblhlsiglxkoiounv.supabase.co`
- Anon keys for both projects live in the ENVIRONMENT block of each app (`CC_SUPA`)
- Tables use Row Level Security (anon key has read/write via policy)

## Dev and live (Oct 2026)
| | Live | Dev |
|---|---|---|
| Address | app.cirruscc.com (GitHub Pages, `main`) | dev.cirruscc.com + `*.cirruscc-dev.pages.dev` previews (Cloudflare Pages, `develop`) |
| Supabase | `cirruscc-live` · `ncfbblhlsiglxkoiounv` | `cirruscc-dev` · `oxbonrnilvadszgfctfl` (same org, us-west-1) |
| Data | real projects only | demo seed only — never a copy of live rows |
- **The switch is ONE block, byte-identical in all four apps** —
  `// ── ENVIRONMENT (begin)` … `(end)`: `CC_ENV`, `CC_SUPA {url,key}`,
  `CC_BASE` (where share links / sign-in redirects point), `CC_LIVE_BASE`, and
  an amber "DEV" tab on every dev page. **Only `app.cirruscc.com` and
  `putzke.github.io` are live; EVERY other hostname is dev** (previews, files,
  localhost, look-alikes) — an unfamiliar address can never touch real data.
  `SUPA_URL`/`SUPA_KEY`/`APP_BASE_URL` read from it. CSP `connect-src` lists
  both projects. The harness opens files, so tests run as dev.
  Guarded by `test/tests/81-dev-live-switch.test.js` (hostname table, key↔project
  match, identical copies; verified to fail with a loosened rule).
- **Database changes go to dev first**, then to live at release. Sign-ins are
  separate per database (and browser storage is per address).
- **Reset dev** (`putzke/cirruscc-backups` → Actions → Reset dev, type
  `RESET DEV`): wipes dev and rebuilds it from live's STRUCTURE (pg_dump
  --schema-only — never live rows), copies `pi_staff` + `pi_team_members`, loads
  the demo seed from `develop`, recreates the report-files bucket and its
  storage rules, then FAILS unless every column and every table/function
  permission matches live. (New dev tables inherit Supabase's "expose new
  tables" grants; the script revokes the API roles' rights and re-applies
  live's, because pg_dump records grants, not removals.) Refuses unless
  `DEV_DB_URL` is the dev project. Dev auth users survive resets. A migration
  not yet on live is wiped by a reset — re-apply it to dev afterwards.
- **CI:** `.github/workflows/tests.yml` runs the full `test/run.js` suite on
  every push to `develop`, `main` and `claude/**` (Postgres 16 + Playwright
  Chromium on the runner; `test/lib/app.js` uses `/opt/pw-browsers/chromium`
  only where it exists). **A red run on `develop` means: do not release.**

### How we work (agreed with Jeff, Oct 2026)
- **Bug reports come in a session** — where (live/dev + screen), the clicks,
  expected vs. actual, a screenshot, urgent or normal. NOT as GitHub Issues on
  this repo: it is public and a screenshot can carry a stakeholder's name.
- **Small vs. big — decide by this table, never by feel; unsure = big.**
  SMALL (straight to live): fixes something plainly broken, screens and steps
  unchanged for staff, NO database change. BIG (dev first, waits for Jeff's
  "release"): new features; a changed screen or workflow; ANY database change;
  anything changing what clients see in the portal or reports.
- **Fix loop:** look at live READ-ONLY via the Supabase connector → reproduce
  in the harness → a test that fails for the bug → fix → full suite green.
  SMALL: push the same commit to `develop` AND `main`. If `develop` carries
  unreleased big work, branch the fix from `main`, push it to `main`, then
  merge `main` back into `develop` — never let unreleased work ride out on a
  hotfix. BIG: `develop` only; tell Jeff what to click on dev.cirruscc.com;
  release = `git push origin develop:main` on his word.
- **Every finished piece of work ends with a status block**, in plain words:
  **Live:** what changed for staff (or "nothing") · **Dev only (waiting for
  release):** what to try and where · **Needs you:** SQL to paste / a check /
  nothing.
- **Live data repairs:** write the SQL (into `sql/fixes/`) for Jeff to paste in
  the live SQL Editor — the connector times out on writes, and a human check on
  anything that changes real data is the point. Confirm counts before/after.
- **Releases:** fixes whenever Jeff approves; larger changes bundled roughly
  weekly so staff aren't surprised mid-task. Each release with a database
  change lists the live SQL to paste, in order, BEFORE the code push.
- **Coach dev vs. live in every instruction.** Jeff and staff work on LIVE.
  Every step given to Jeff names where it happens — "on LIVE
  (app.cirruscc.com / the pi-registry Supabase project)" or "on DEV
  (dev.cirruscc.com / cirruscc-dev)". New features are tried on DEV; real
  work, staff set-up (two-step sign-in, team list) and client access on LIVE.
- **The connector writes to DEV fine** (only live writes time out), so dev
  migrations are applied directly; live SQL still goes to Jeff to paste.
- **Supabase advisor warnings that are deliberate** — leave them:
  "SECURITY DEFINER function executable by anon/authenticated" on
  `pi_is_staff`, `pi_is_portal_client`, `pi_portal_project_ids`,
  `pi_resolve_portal_token`, `pi_portal_contact`. RLS policies call the first
  three as the requesting role (revoking EXECUTE would break every policy),
  and the portal calls the last two by RPC. Each only answers about the caller
  or the token the caller holds.

## Backups (Oct 2026)
- **Supabase Pro** (upgraded 2026-10-10): daily backups kept 7 days, restored
  from the dashboard (Database → Backups). First thing to reach for.
- **Off-site nightly copy — `putzke/cirruscc-backups` (PRIVATE repo).** A GitHub
  Action at 09:17 UTC dumps `public` (schema, data, policies, grants),
  `auth.users`/`identities`/`mfa_factors` and `storage.buckets`/`objects` rows,
  downloads every `report-files` object, encrypts all of it with
  `BACKUP_PASSPHRASE` (gpg AES256), then **restores it into a scratch
  Postgres 17 and fails unless every public table's row count and every file
  match** — each night's backup is proven restorable. Kept 35 days as an
  Actions artifact. Secrets: `SUPABASE_DB_URL` (session pooler, port 5432 —
  GitHub runners are IPv4-only, the direct host is IPv6),
  `SUPABASE_SERVICE_ROLE_KEY`, `BACKUP_PASSPHRASE` (Jeff holds it; without it
  no backup opens). First live run 2026-10-10: 26 tables, 7 files, 3.9 MB.
- **Never put backup tooling or output in THIS repo** — it is public, and so
  are its Actions logs and artifacts.
- A failed night emails the repo owner. A table added to `public` is picked
  up automatically; a new Storage bucket is NOT (the script reads
  `report-files` only) — add it to `backup.sh` there.
