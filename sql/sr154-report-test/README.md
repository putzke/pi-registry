# SR-154 — client-reporting end-to-end test

Three archived reports on **25-154-001**, to exercise the whole client
reporting path: archive → share → publish trend → client portal.

Paste each file into the Supabase SQL editor **in order**, and do the archive
step in COMPASS between them.

| Run | Then, in COMPASS |
|---|---|
| `00-cleanup.sql` | — |
| `01-period-1.sql` | Archive report **#1** with the dates it prints · tick "Share with client" |
| `02-period-2.sql` | Archive report **#2** with its dates · share it |
| `03-period-3.sql` | Archive report **#3** · share it |
| `04-verify.sql` | Expect roughly **14 / 9 / 17** |

Finally: Reports → Archive → **AI: Project Status Report** → edit → **Publish
trend to client portal**. Then open the SR-154 portal link → **Project Updates**.
All three reports and the trend should be there.

Each block prints its period dates with `raise notice`, which in Supabase
appear in the **Messages / Notices** panel under the editor, not in the
results grid.

## Why it is split into blocks instead of one script

Three reports over three time windows is the obvious way to do this, and it is
half right. Only the **Recent public concerns and inquiries** section is bounded
by the report period. Deliverables, issues, commitments and the contact list all
show the project's *current* state whatever dates are in the header — and
`snapshot.trendFacts` freezes exactly those.

So three reports run over unchanging data produce three different concerns
narratives and three **identical** trendFacts. The Project Status Report then
correctly reports that nothing moved. That is a real run, but an empty test of
the headline feature.

The project therefore has to change *between* archives. Each block advances it:

| | Interactions | What moves |
|---|---|---|
| Period 1 · 90–61 days ago | 14 | 2 issues open, 2 commitments open |
| Period 2 · 60–31 days ago | 9 | 1 issue resolves, 1 opens, 1 commitment fulfilled, matrix 65% → 85% |
| Period 3 · 30–0 days ago | 17 | 1 issue resolves, 1 commitment fulfilled + 1 new, matrix → 100%, Final EIS Support → 20% |

**"Harvest Hills noise wall request" stays open across all three, deliberately.**
A persisting high-priority item is the most useful thing a trend comparison can
surface, and it cannot be tested without one. It also puts a row in the portal's
Heads Up panel, so that path gets covered too.

Volumes differ (14 / 9 / 17) so the engagement delta has something to compare,
and every period includes anonymous callers so the "an anonymous interaction is
EXTERNAL" rule is exercised as well.

## Safety

- **Idempotent.** Rows are tagged `updated_by = 'sr154-rpt-test'` — a provenance
  column that is displayed nowhere — so `00-cleanup.sql` removes only what this
  test created. Re-running the whole sequence does not double up.
- **Run this AFTER any final demo-seed re-run, not before.** Re-running
  `2026-07-26_udot_conference_demo_seed.sql` wipes `pi_reports` and
  `pi_report_archive` for this project, which would take the three archived
  reports with it.
- **Not a migration.** This folder is data, not schema. `test/run.js` applies
  every `*.sql` in `sql/` as a migration; a subfolder is skipped by that filter,
  which is why these live here rather than flat alongside the migrations.

Covered by `test/tests/37-sr154-report-data.test.js`, which runs the blocks in
this order and asserts the state actually moves at each step.
