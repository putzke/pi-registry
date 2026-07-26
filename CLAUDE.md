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
- `exportPIDocx()` — 8848: async, auto-archives then exports Word file
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
- `ARCHIVE_LIMIT = 50` per project
- `_archiveReport(projF)` — async, called inside `exportPIDocx()` before download
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
- **Shared lists live in 3 separate files — update all together.** `index.html`,
  `mobile.html`, and `importer.html` are standalone; none imports the others,
  so any list a user picks from is duplicated. When changing one, grep all three
  (+ the importer's embedded `.xlsx` template) and reconcile. Known duplicated lists:
  - **Stakeholder types** — canonical `STAKE_TYPES` in `index.html` (13: Business,
    Elected Official, Agency, Community Group, Contractor, Engineering, Media,
    Property Owner, Resident, Tribal, Utility, Non-profit, Other). Mirrored in
    mobile's `#add-type` dropdown, importer's `normalizeType()` + the `.xlsx`
    template's StakeholderType data-validation dropdown + its Legend sheet.
  - **Distribution groups** — `DIST_GROUPS` in `index.html` (Project team, Agency
    contacts, Media, Other). Importer normalizes to it (`normalizeDistributionGroups`)
    + `.xlsx` dropdown. Report filtering matches these strings exactly.
  - Editing the `.xlsx` template = decode the base64 in `downloadTemplate()`
    (importer), edit the sheet XML, re-zip, re-base64. Verify all sheets survive.

## CSP (line 6)
```
connect-src https://ncfbblhlsiglxkoiounv.supabase.co https://maps.googleapis.com https://places.googleapis.com https://api.anthropic.com https://cdnjs.cloudflare.com;
```

## Mobile app (`mobile.html`)
Field companion for logging interactions, managing contacts, follow-ups, and issues. ~2,420 lines.
- **Status: current** — LEP, EJ (`underserved`), and `equityFormSubmitted` fields are all implemented
- Has its own `SB_TABLES`, `SB_TO_INT`, `toSB()`, `fromSB()`, `sbGet/Add/Update/Delete()`, `loadAllData()`
- Does NOT have the reports module — reports are desktop-only
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
6. **REMIND JEFF: remove debug logging before go-live (TWO sets, both kept deliberately).**
   (a) The `AI draft-all:` / `Claude:` diagnostics in `generateAllSectionDrafts` and
   `_claudeNarrative` — added July 2026 after a silent `content[0]` bug wasted a
   testing cycle. Recommendation when the time comes: keep the *warnings* (they only
   fire on failure and are how a silent AI failure is diagnosable) and drop only the
   routine `console.log('AI draft-all: tasks=…')`. (b) The `SB UPDATE` pair below.
   `sbUpdate()`
   in `index.html` has two `console.log` calls (`'SB UPDATE sending:'` and
   `'SB UPDATE response:'`) left in as instrumentation while chasing save bugs.
   Jeff explicitly chose to KEEP them for now (still in testing, July 2026) and
   asked to be reminded to strip them "some day in the future." When reminding,
   remove only those two success-path logs — keep the error logging (`SB UPDATE
   error`, `SB ADD/DELETE network error`, `_sbNetworkWarn`). If asked to reduce
   console noise or prep for production/go-live, surface this proactively.

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

**Deferred (decoupled, do NOT entangle with the importer work):** an optional
desktop **quick-log interaction grid** — a rapid multi-row manual entry surface
(date · stakeholder typeahead over the project's existing linked stakeholders ·
channel · summary · logged-by initials) that writes to the same `pi_interactions`
table with the other fields defaulted (`direction`/`subject`/`category` blank,
`sentiment` 'Neutral', `followUp` false). Constrained to stakeholders that
ALREADY exist at the project level — no new-contact creation, no fuzzy matching.
Build only after the contact importer proves itself; keep it a separate, small,
desktop-only feature.

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

## PI Client Portal — BUILT (`client-portal.html`, ~1,120 lines)

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


## FUTURE — ArcGIS Survey123 Integration (in development)

Import public outreach survey responses directly from ArcGIS Survey123 into
Horizon COMPASS as interaction log entries. Goal: eliminate manual re-entry
of field survey data, closing the gap between DOT/agency field outreach data
collection tools and the internal PI stakeholder record. Integration via
ArcGIS Survey123 API — pull completed survey responses, map fields to
Horizon COMPASS interaction schema (stakeholder, date, subject, channel,
summary), and create draft interactions for PI manager review before saving.

Relevant because ArcGIS Survey123 is already widely used by transportation
agencies and field teams; this positions Horizon COMPASS as compatible with
the DOT technology ecosystem rather than requiring a separate workflow.

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
