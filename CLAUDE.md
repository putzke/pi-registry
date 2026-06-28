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

## Pending / next tasks
1. **Manual "Save to archive" button** — checkpoint a draft without exporting (discussed, not yet built)
2. **Absorb popup report windows** — currently `generateReport()`, `generatePISummary()`, `generateIssuesReport()` open `window.open()` popups; absorb into inline output panel (deferred by user)
3. **AI cross-report trend summary testing** — needs 2+ real exports to test fully
4. **Mobile app** (`mobile.html`) — may need same bug fixes applied to `index.html`
5. **NEPA checklist progress bar on project cards** — mentioned in verify skill context, may be partially implemented
6. **Continue testing** stakeholders LEP/EJ checkboxes, public meeting equity toggle, public comments nav/form

## Supabase project
- URL: `https://ncfbblhlsiglxkoiounv.supabase.co`
- Anon key in `index.html` line ~505 (`SUPA_KEY`)
- Tables use Row Level Security (anon key has read/write via policy)
