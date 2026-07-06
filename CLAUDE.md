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

## Cross-app consistency rule
After every change to `index.html`, always check whether the same change (feature, bug fix, data field, SB_TO_INT mapping, etc.) should also be applied to `mobile.html` and/or `importer.html`. Explicitly state the assessment — even if the answer is "not applicable here" — so Jeff can confirm before closing the task. Do not silently skip this check.

- **`mobile.html`** — field companion for logging interactions, managing contacts, follow-ups, and issues. Apply data field changes (new columns, SB_TO_INT mappings) and interaction/stakeholder bug fixes if the same flow exists in mobile.
- **`importer.html`** — bulk CSV import for stakeholders and interactions. Apply new stakeholder/interaction field mappings and AUTO_MAP entries if the field is importable.

## Important conventions
- **No `fmtDate()`** — use `fmt(d)` (defined ~line 1311)
- **No build step** — edit `index.html` directly, syntax-check with:
  ```bash
  node -e "const fs=require('fs'),html=fs.readFileSync('index.html','utf8');const s=[];let m,r=/<script>([\s\S]*?)<\/script>/g;while((m=r.exec(html)))s.push(m[1]);try{new Function(s.join('\n'));console.log('OK');}catch(e){console.log('ERROR:',e.message);}"
  ```
- After every edit, run the syntax check before committing
- Push to `main` branch: `git push origin HEAD:main`
- Working branch also: `claude/pi-registry-scroll-fixes-c2i1cc`

## CSP (line 6)
```
connect-src https://ncfbblhlsiglxkoiounv.supabase.co https://maps.googleapis.com https://places.googleapis.com https://api.anthropic.com https://cdnjs.cloudflare.com;
```

## Mobile app (`mobile.html`)
Field companion for logging interactions, managing contacts, follow-ups, and issues. ~2,420 lines.
- **Status: current** — LEP, EJ (`underserved`), and `equityFormSubmitted` fields are all implemented
- Has its own `SB_TABLES`, `SB_TO_INT`, `toSB()`, `fromSB()`, `sbGet/Add/Update/Delete()`, `loadAllData()`
- Does NOT have the reports module — reports are desktop-only
- No known bugs as of this session

## Importer app (`importer.html`)
Bulk CSV import wizard for stakeholders and interactions. ~2,420 lines.
- **Updated this session**: added LEP and EJ/underserved field support:
  - `SB_TO_INT` pi_stakeholders: `lep` and `underserved` mappings added
  - `APP_FIELDS`: LEP and EJ appear in the column-mapping dropdown
  - `AUTO_MAP`: auto-detects headers `lep`, `limited english`, `underserved`, `ej`, `environmental justice`
  - Boolean parsing: `yes/true/1/y → true` for `lep`/`underserved` (same as `isMaster`)
- `sbAdd()` at line ~746 calls `r.json()` directly — safe because it uses plain POST (not upsert), so body is never empty

## Pending / next tasks
**Done this session:**
- ~~Manual "Save to archive" button~~ — built: `manualArchiveReport()` (line ~9041), wired to the "Save to archive" button in `openPIReport()` toolbar. Saves draft, checkpoints to `pi_report_archive`, enforces `ARCHIVE_LIMIT`, refreshes archive panel in place.
- ~~NEPA Compliance section in PI Report Editor~~ — built: section type `'nepa-compliance'` in Add Section dropdown, auto-populates with live checklist group progress + comment period compliance, AI Draft button via `_claudeNarrative()`.
- ~~Absorb popup report windows~~ — built: new `showInlineReport(html, title)` helper (~line 10000) renders an in-app overlay with an iframe + Print/Close buttons instead of `window.open()`. All 8 report generators (`exportIssuesPdf`, `generatePISummary`, `generateNepaComplianceReport`, `_openRptPopup`, `_portfolioPrintWin`, `printStakeholderMap`, `printEngagementMatrix`, `_mapPrint`) now call it. The bulk-import tool popup (`openImportTool`) intentionally still uses `window.open()` — it's a separate app window, not a report.
- ~~NEPA checklist progress bar on project cards~~ — verified working, no bug. Confirmed via headless-browser test (injected a synthetic project with a CE checklist directly into `_syncCache`, since this sandbox has no network path to Supabase): the progress bar on Dashboard row 4 (`renderDash`, ~line 2007), the Projects view card (`renderProjects`, ~line 5161), and the full checklist detail in the Deliverables view (~line 4754) all read `p.nepaChecklist` fresh off `DB.get('projects')` and agreed exactly (e.g. `2/33 · 6%`) after calling the real `toggleNepaCheck()` — including immediately after toggling, with no reload needed. This relies on last session's deep-clone fix in `DB.get`/`DB.set`, which is doing its job.

**Still open:**
1. **AI cross-report trend summary testing** — needs 2+ real exports to test fully
2. **Continue testing** stakeholders LEP/EJ checkboxes, public meeting equity toggle, public comments nav/form

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

## FUTURE — PI Client Portal (identified June 29, 2026, high strategic priority)

**The differentiator no competitor has:** every competitor researched is
either a public-facing engagement platform (talks to residents) or an
internal stakeholder CRM (talks to the PI team). Nobody builds the third
leg — keeping the PI firm's actual client (DOT, city, county leadership)
continuously informed without a manual reporting cycle. This is especially
valuable during construction, when physical impacts are greatest and the
client most wants visibility without waiting for a periodic report. Also
strengthens the FHWA compliance story — DOTs/FHWA already require
documented continuous PI communication; this gives the client a live
window into that record instead of a static quarterly PDF.

**Goal:** a client contact (e.g., Logan City Engineering) logs in and sees
ONLY the public engagement activity and deliverable progress for their
specific project — nothing else in the system.

**Requirements:**
- New role: Client Viewer — read-only, scoped to one project or a defined
  set of projects (e.g., a DOT region office overseeing multiple projects)
- Curated client-facing dashboard, distinct from internal PI team
  interface — likely: engagement activity summary, deliverable progress,
  recent outreach events, high-level issue status (open/resolved). Probably
  NOT full interaction-level detail, internal notes, or raw sentiment scores
- RLS scoping in Supabase so client logins only see their own project data
  — dovetails directly with the multi-tenant org_id work already on roadmap
- Field-level curation layer controlling exactly what surfaces externally

**Why this matters strategically:** not incremental feature parity — a
structurally different category move, and it fits naturally alongside
(not in competition with) the multi-tenant org layer and AI report
drafting already planned, rather than requiring a separate dev track.

**Before building:** design session to define exact client-visible vs.
internal-only fields/views, design the Client Viewer role and login flow,
and validate with one or two friendly DOT/municipal contacts first.

## FUTURE — Dialpad Hotline Capture Integration (identified July 6, 2026)

**Strategic note:** Acknowledged as a workflow efficiency feature rather than a
core differentiator. Teams Phone voicemail has no usable API; this replaces it
with a platform that exposes full transcript and call metadata programmatically.
Useful, but validate against other PI firms' hotline workflows before investing
— this may be Sunrise-specific friction rather than an industry-wide PI pain point.

**What:** Replace Teams Phone ring groups with Dialpad Connect Pro. Use Dialpad's
webhook + REST API to automatically capture voicemail transcripts, caller ID, call
metadata, and AI call transcripts into COMPASS. Build a "Hotline Capture" UI panel
for reviewing, editing, and converting captures into logged `pi_interactions`.

**Why Teams Phone can't work:** No usable API for voicemail transcript extraction.
Dialpad exposes `transcription_text`, `contact.phone`, `contact.name`,
`voicemail_link`, `internal_number`, and full AI call transcripts via webhook
events and GET endpoints (Call GET, Call Transcript GET at 1,200 req/min).

**Platform cost:** Dialpad Connect Pro, 3 users ($25/user/mo annual) + 6–7
additional local hotline numbers ($5/number/mo) = ~$95–110/month total.
Numbers can be ported from Teams via 10-digit porting PIN.

**Architecture:**

New Supabase table `pi_hotline_captures`:
```
call_id, caller_phone, caller_name, hotline_number, direction, call_type,
transcript_text, voicemail_url, call_duration, call_timestamp,
status, converted_interaction_id, project_id, notes, reviewed_by
```

- Supabase Edge Function as webhook receiver (Dialpad → Edge Function → `pi_hotline_captures`)
- Hotline-to-project mapping table (maps each hotline number to a `pi_projects` row)
- New nav view or Settings panel: **Hotline Capture inbox** — list of unreviewed captures
- Per-capture review card: edit transcript, assign project, fill in interaction fields
- "Convert to Interaction" button: creates `pi_interactions` row, sets `converted_interaction_id`, marks capture as converted

**Dependencies before building:**
- Dialpad account + API OAuth credentials
- Supabase Edge Functions enabled on project
- New `connect-src` entry in CSP (line ~6) for Dialpad webhook/API domain
- Design session to define inbox UI, mapping UI, and conversion flow
- Decision: new nav view vs. embedded in Interactions view vs. Settings panel

## Supabase project
- URL: `https://ncfbblhlsiglxkoiounv.supabase.co`
- Anon key in `index.html` line ~505 (`SUPA_KEY`)
- Tables use Row Level Security (anon key has read/write via policy)
