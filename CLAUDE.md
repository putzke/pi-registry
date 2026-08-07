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
- `_claudeNarrative(systemPrompt, userContent)` — shared fetch wrapper, model: `claude-haiku-4-5-20251001`, max_tokens: 400
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
  - Editing the `.xlsx` template = decode the base64 in `downloadTemplate()`
    (importer), edit the sheet XML, re-zip, re-base64. Verify all sheets survive
    — the test asserts the entry count (19) precisely because a bad re-zip
    silently drops sheets.
  - `normalizeType()` in the importer matches an exact canonical type first,
    then keyword rules, then falls back to `Other`. It used to return the raw
    input unchanged, which let `Nonprofit` or `Contracting` into the database as
    stakeholder types nothing could filter on.

## CSP (line 6)
```
connect-src https://ncfbblhlsiglxkoiounv.supabase.co https://maps.googleapis.com https://places.googleapis.com https://api.anthropic.com https://cdnjs.cloudflare.com;
```

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
1. **Absorb popup report windows** — the Issues report was converted to inline
   this session; verify whether `generateReport()` / `generatePISummary()` still
   use `window.open()` and absorb them into the inline output panel too (deferred by user).
2. **AI cross-report trend summary testing** — needs 2+ real exports to test fully.
3. **Continue testing** stakeholders LEP/EJ checkboxes, public meeting equity toggle, public comments nav/form.
4. **Tribal consultation tracker** — nav view exists (`renderTribal()`), but classified
   as **in development / not production-ready**. Do not present as live to external
   users. Needs full testing and validation before going live.
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
   **STILL OUTSTANDING — `importer.html` has four of the same kind**:
   `[sbAdd]` (logs the request body), `[sbAdd] OK`, `[Int insert]` (logs the
   whole interaction record) and `[Auto-link]`. Higher exposure than the
   index.html pair was, because a bulk import prints every contact in the file.

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

### Demo dataset — `sql/2026-07-26_udot_conference_demo_seed.sql`
Two realistic Utah projects (SR-154 / UDOT Region 2, EA; Logan City 400 North /
CE, construction) with ~52 stakeholders, ~586 interactions, deliverables,
events, issues, commitments, a comment period with 23 public comments, portal
links and grant-by-email rows. Built for the UDOT conference demo.
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
multi-tenant org_id work). Reminder learned the hard way: new portal tables
need an explicit `grant ... to anon;` — RLS policies alone give "permission
denied for table" (see sql/2026-07-06_client_summaries_grant_fix.sql).

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
5. ⬜ End-to-end test (after migration is run): share a report, publish a trend,
   open portal link, confirm both render.

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

## Supabase project
- URL: `https://ncfbblhlsiglxkoiounv.supabase.co`
- Anon key in `index.html` line ~505 (`SUPA_KEY`)
- Tables use Row Level Security (anon key has read/write via policy)
