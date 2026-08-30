# Horizon COMPASS — Claude Code Context

## What this app is
Single-file FHWA/NEPA public involvement (PI) compliance platform. All code lives in **`index.html`** (~13,600 lines). No build step. Deployed on **GitHub Pages** at `https://putzke.github.io/pi-registry/`. Backend is **Supabase** (REST API, no Supabase JS client).

Other files: `mobile.html` (mobile companion), `importer.html` (bulk data import), `seed-sample-data.js` (seed script run from browser console).

## Architecture

### Data layer
- `DB.get('table')` / `DB.getActive('table')` — reads from `_syncCache[k]`
- `DB.set('table', arr)` — writes cache and triggers `DB._sync()` to push to Supabase
- `_syncCache` is populated at startup via `loadAllData()`
- `SB_TABLES` (line ~657) maps internal names → Supabase table names
- `SB_TO_INT` (line ~678) maps Supabase column names → internal field names (used in `fromSB()`)
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

The footer row is omitted entirely when a project has neither, rather than
rendering an empty bordered strip. `fuTag` lost its `margin-left:auto` (it is
now the first chip, not the last) and the portal chip keeps its own, so the two
sit at opposite ends. The `psSt` / `champ` / `opp` / `ints2` scans went with the
markup — they ran per card on every render for numbers nothing displayed.

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
`meetingId` is still mapped and still read (the "N open actions" event-card badge
and `delMeeting`'s cascade), but since nothing writes it and no row carries it,
**both of those are dead paths** — remove them if you touch this area. Do not
re-introduce the cascade without checking it first: `delMeeting` deletes every
interaction sharing the meeting id.

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
  The consultant has both in COMPASS. Guarded by `test/tests/04-client-portal.test.js`,
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
    (COMPASS -> Sheet, `drive.file` scope, client-side OAuth) is safe; a
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

### Key functions (by line)
- `render()` — 1480: main dispatch
- `renderDash()` — 1501
- `renderMaster()` — 2994: stakeholder master list
- `renderStakeholders()` — 3127
- `renderInteractions()` — 4494
- `renderReports()` — 6652: Reports view with 3-tab layout (Quick Reports / PI Report Editor / Archive)
- `openPIReport()` — 8311: replaces main area with split-pane PI report editor
- `exportPIDocx()` — 8848: async, exports the Word file. Does NOT archive —
  archiving is deliberate, via "Save to archive" (`manualArchiveReport()`).
- `renderMeetings()` — 10308
- `renderTribal()` — 11827
- `renderComments()` — 12183
- `renderSettings()` — 13067

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

### The UDOT logo lives in TWO places — update both (Aug 2026)
Replaced Aug 2026 with the navy beehive mark (`UDOT_Logo_Blue.png`, 1000x258,
transparent, kept in the repo root as the source of record). It is embedded
twice and neither copy reads the other:
- **`window._srUdotLogo`** (~line 498) — a data: URI, used by `_rptBrandHeader()`
  for the HTML quick reports, the print package and the archived-report preview.
- **`word/media/image2.png` inside `window._piDocxTemplateUdot`** — the .docx.
  (`image3.png` in the same header is the Horizon COMPASS mark. Do not touch it.)

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
logo level with the COMPASS mark) and recomputes the width — 1615044 → 2030019
EMU here, since the new mark is 3.88:1 against the old 3.08:1. It finds the part
by following `header1.xml`'s first drawing through its relationship, never by
file name (numbering differs across the three templates), and refuses a format
change rather than producing a file Word will not open.

Resolution: 1000px drawn at 2.22" is **450 DPI**, up from 600px at 1.77" (340).
Upscaling the PNG would add pixels, not detail — only a higher-res original or
the vector source would. `client-portal.html` carries no UDOT branding at all.

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
- **FROZEN SNAPSHOTS (July 2026) — do not break this.** An archived report is a
  point-in-time compliance record. `_buildReportSnapshot(projF, saved)` captures,
  at archive time, everything the report renders: `recipients` (the Distributed-To
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
- `_claudeNarrative(systemPrompt, userContent, maxTokens, model)` — shared fetch
  wrapper. Defaults: model `claude-sonnet-5`, `max_tokens` 400. (This line said
  Haiku long after the default became Sonnet — check the function, not this
  line, before quoting a cost.)
- CSP `connect-src` includes `https://api.anthropic.com`
- Confirmation dialog required before bulk AI calls (cost estimate shown)

## Important conventions
- **No `fmtDate()`** — use `fmt(d)` (defined ~line 1311)
- **No build step** — edit `index.html` directly, syntax-check with:
  ```bash
  node -e "const fs=require('fs'),html=fs.readFileSync('index.html','utf8');const s=[];let m,r=/<script>([\s\S]*?)<\/script>/g;while((m=r.exec(html)))s.push(m[1]);try{new Function(s.join('\n'));console.log('OK');}catch(e){console.log('ERROR:',e.message);}"
  ```
- After every edit, run the syntax check before committing
- Push to `main` branch: `git push origin HEAD:main`
- Working branch also: `claude/pi-registry-scroll-fixes-c2i1cc`
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

## CSP (line 6)
```
connect-src https://ncfbblhlsiglxkoiounv.supabase.co https://maps.googleapis.com https://places.googleapis.com https://api.anthropic.com https://cdnjs.cloudflare.com https://services1.arcgis.com;
```
(`services1.arcgis.com` added Aug 2026 for UGRC parcel reconciliation — see the
Polygon Phase 2a section.)

## Mobile app (`mobile.html`)
Field companion for logging interactions, managing contacts, follow-ups, and issues. ~2,420 lines.
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
- No known bugs as of this session

## Importer app (`importer.html`)
Bulk CSV import wizard for stakeholders and interactions. ~2,420 lines.
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

**Recently completed (verified in code, 2026-07-24):**
- ✅ **Manual "Save to archive" button** — `manualArchiveReport()` → `_archiveReport()`.
- ✅ **NEPA checklist progress bar on project cards** — dashboard + cards render
  per-project checklist %; portfolio avg in `renderDash` (`avgNepaPct`).
- ✅ **NEPA Compliance section in PI Report Editor** — section type
  `'auto-nepa-compliance'` in Add Section; auto-populates checklist progress +
  comment-period compliance; AI-draft path; also a standalone quick report
  (`generateNepaComplianceReport()`).
- ✅ **AI contact importer Phase 2 (vision)** — image/PDF → Sonnet 5, in the
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

## PARKED — Survey/public-input ingestion bridge (validate first, July 2026)

**Idea:** Jeff floated a built-in survey tool (prompted by QuestionPro). Decision:
**do NOT build a survey engine.** The survey-builder market (QuestionPro,
Qualtrics, SurveyMonkey, Alchemer, Typeform) is mature/commoditized — 80+
question types, AI generation, panels, dashboards. Rebuilding it lands us at a
worse QuestionPro and repeats the "don't compete on engagement scale" trap.

**What IS strategically sound — an ingestion bridge, not an engine.** Every
survey tool is generic; NONE ties responses to a NEPA comment period, Title
VI/LEP/EJ documentation, or the consultant's system of record. That linkage is
the COMPASS thesis. So: pull survey responses via API into
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
separate **Horizon Interactive Technologies** app to keep COMPASS's focus clean.

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
text-only paste → Haiku; any image/PDF attached → **Sonnet 5** (`claude-sonnet-5`)
vision. `_aiParseContacts(content, model)` takes either a string (text) or an
array of content blocks — images as `{type:'image',source:{type:'base64',…}}`,
PDFs as `{type:'document',source:{type:'base64',media_type:'application/pdf',…}}`
(helper reads files as raw base64). Still lands in the review grid; PII/API
notice covers uploaded images. Model-string note: the code uses
`claude-haiku-4-5-20251001` for the text path — the current unsuffixed id is
`claude-haiku-4-5` (see claude-api skill); leave as-is unless doing a model pass.

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
- Columns: date · stakeholder typeahead · channel · direction · summary ·
  logged-by. `⇩` on date/channel/direction/logged-by copies down to every row
  below. Enter advances a row, Shift+Enter is a line break.
- **Every one of those four columns opens pre-filled** (today / Phone / Incoming
  / your initials). The `⇩` is for propagating a CHANGED value — set row 1 to
  yesterday's date, click ⇩ — not for the initial state, so date is treated no
  differently from Channel. Blanking rows 2+ was considered and rejected: it
  costs a click or twelve date entries in the common "today's batch" case, and
  save requires a date (correctly — it's a compliance field, so silently
  defaulting a blank one would mis-date the record). `_qlDnRefresh()` hides the
  arrows on whichever row is last, since they'd copy to nothing, and re-runs
  after "+ Add rows".
- **Deviation from the original spec, deliberate:** the spec said direction
  blank, `subject`/`category` blank, `sentiment` 'Neutral'. `pi_interactions`
  has no `sentiment` and no `category` column (it's `nature`), and a blank
  direction renders as an empty badge in the interaction list. So: direction is
  a per-row select (default Incoming) and subject/nature are written as
  `General`/`Inquiry` — **the same defaults `saveInt()` writes** when its selects
  are untouched, which keeps a quick-logged row indistinguishable from a
  modal-logged one in every filter.
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
- Covered by `test/tests/07-quick-log.test.js` (32 checks), including that the
  picker never offers an unlinked contact.

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
COMPASS's defensible niche.

**Core distinction driving all product decisions:** PublicInput is built for
the *agency* to collect public input at scale. Horizon COMPASS is built for
the *PI consultant* (the Sunrise-style firm) to manage stakeholder
relationships, commitments, issues, and FHWA/NEPA compliance documentation
as their actual daily internal workflow. Compliance in PublicInput is a
byproduct of engagement data; in Horizon COMPASS it is the product itself.

**Differentiation priorities (do NOT build toward #1):**
1. Do not compete on public engagement scale — no mass SMS/social campaigns, no survey tooling. PublicInput owns this; not worth contesting.
2. Own the consultant's internal system of record — this is the underserved buyer.
3. Compliance docs (NEPA stage tagging, tribal consultation, LEP/EJ flags, comment periods) should stay daily-use workflow tools, not just report outputs.
4. AI report drafting (`_claudeNarrative()`) is a genuine wedge — no competitor researched offers this.
5. Win on price/speed of adoption vs. PublicInput's agency procurement cycle — sell to the consultant/firm, not the state.

**Strategic framing for any UDOT-facing pitch:** position Horizon COMPASS as
*complementary to* existing PublicInput contracts a DOT may already have,
not a replacement. Full positioning brief: `HC_Competitive_Positioning_Brief.docx`
(not in this repo — held by Jeff).

**Realistic market assessment (why this is winnable, not just defensible):**
1. No researched competitor is purpose-built for FHWA/NEPA-regulated U.S.
   transportation PI — this gap is real and currently unaddressed.
2. The builder is the buyer — every competitor was built by a software
   company selling to PI professionals from the outside; Horizon COMPASS is
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
that's PublicInput/Granicus/EngagementHQ territory; Horizon COMPASS stays
internal-facing.

## PI Client Portal — BUILT (`client-portal.html`, ~1,470 lines)

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

### Demo dataset — `sql/2026-07-26_udot_conference_demo_seed.sql`
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

**Security note (unchanged / known):** token isolation is client-side; the
anon key is public and RLS is permissive (blanket anon read on portal tables).
Server-side token-scoped RLS is the separate hardening project (ties to
multi-tenant org_id work).

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
2. ✅ COMPASS Report Archive: "Share with client" toggle per archived report
   (`toggleReportShared()` flips `client_visible`); trend button → generate →
   editable textarea → "Publish trend to client portal" (`publishClientTrend()`,
   keeps human gate). Client-portal status line in archive header.
3. ✅ Removed Client Summary tab + `generateClientSummaryDraft()` +
   `publishClientSummary()`. Stale `S.rptTab==='client-summary'` normalized to
   'reports'.
4. ✅ Portal (`client-portal.html`): "AI Summary" nav → "Project Updates";
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
say" and will do it better. COMPASS answers "what did we do about it, and can we
prove it to FHWA". ESRI is the instrument; COMPASS is the system of record.

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
interaction records in Horizon COMPASS. Construction-phase PI hotlines are
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
   proxy. Ties to the portal's known "token isolation is client-side / RLS is
   permissive" hardening note (see Client Portal section).
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

### WHO HORIZON COMPASS IS COMPETING AGAINST

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

Horizon COMPASS = built for the PI CONSULTANT's internal workflow +
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

- **Endpoint:** `https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/Parcels_Utah/FeatureServer/0`
  — the statewide basic layer (all 29 counties, one mosaic), CC BY 4.0, no API
  key (ArcGIS Online hosted feature layers published for public access, unlike
  the separate key-gated `api.mapserv.utah.gov` UGRC API). Fields used:
  `PARCEL_ID`, `PARCEL_ADD`/`_CITY`/`_ZIP`, `OWN_TYPE`. **LIR enrichment
  (acreage, market value, property class) is deliberately NOT pulled in
  yet** — those live on UGRC's per-county LIR layers, a different endpoint per
  county, and are staged as a later enrichment step on top of this one, per
  the roadmap's own priority (statewide basic now, LIR later).
  ⚠ **This exact endpoint could not be verified live from the build
  environment** (egress to `*.arcgis.com` and `*.gis.utah.gov` is blocked
  there) — it is corroborated by multiple independent search results
  referencing the same org id and layer name, not by a direct request. Smoke-
  test one real APN against production before relying on this in the field.
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

Covered by `test/tests/45-ugrc-discover.test.js` (24 checks): both early-exit
guards (no project selected, contacts-only layer) make zero network calls; the
count-too-high guard refuses before the full query ever runs; a genuine zero
stays quiet rather than cluttering the panel; a count-check failure is
reported as a failure, never as "nothing found"; import writes only the
checked, genuinely-untracked parcel and never duplicates the already-tracked
one; and `_mvDrawFinish` actually triggers discovery with the finished path.

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
- Anon key in `index.html` line ~505 (`SUPA_KEY`)
- Tables use Row Level Security (anon key has read/write via policy)
