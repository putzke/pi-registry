// The final, hand-edited .docx as the report of record
// (sql/2026-09-16_report_final_docx_attachment.sql).
//
// The FROZEN JSON snapshot the archive captures was never actually what the
// client received — the consultant downloads the exported .docx and hand-
// edits it (sometimes adding photos/tables the app has no model for) before
// delivery. This migration makes the real uploaded file the report of
// record: a database trigger blocks a NEW share without one attached, and
// Storage RLS scopes who can read a given report's file the same way every
// other portal table is scoped (staff / a granted OTP client / a token-link
// visitor). Reports already shared before this shipped are grandfathered —
// the trigger only fires on a fresh false→true transition, never on a row
// that predates it.
//
// Two halves, like 47-portal-rls-isolation.test.js: a raw-connection,
// role-switched transaction proves the DATABASE actually enforces this
// (the shim used everywhere else runs as postgres and bypasses RLS/
// triggers no differently... actually triggers DO fire under the shim,
// since it's real SQL — but RLS itself still needs the role switch to mean
// anything), then an app-level pass proves the UI wiring — the attach flow,
// the client-side share guard, and the portal's download-vs-preview choice
// — actually uses what the migration built.
module.exports = {
  name: 'report .docx attachment — DB enforcement + app wiring',
  async run({ t, db }) {
    // ── Part 1: raw connection, role-switched — the trigger and Storage RLS ──
    const client = await db.pool.connect();
    try {
      await client.query('begin');

      await client.query(`insert into pi_projects (id, name, pid) overriding system value values (5001, 'Corridor Project', 'T-DOCX')`);
      const shared = await client.query(
        `insert into pi_report_archive (project_id, report_num, report_title, sections, archived_at, archived_by, client_visible, docx_path)
         values ('5001', '1', 'Shared Report', '[]'::jsonb, now(), 'tester', false, null) returning id`);
      const sharedId = shared.rows[0].id;
      const unattached = await client.query(
        `insert into pi_report_archive (project_id, report_num, report_title, sections, archived_at, archived_by, client_visible, docx_path)
         values ('5001', '2', 'Unattached Report', '[]'::jsonb, now(), 'tester', false, null) returning id`);
      const unattachedId = unattached.rows[0].id;

      // ── Trigger: blocks a fresh share with no file attached ──────────────
      await client.query('savepoint sp1');
      let blocked = false;
      try { await client.query(`update pi_report_archive set client_visible=true where id=$1`, [unattachedId]); }
      catch (e) { blocked = /final \.docx must be attached/.test(e.message); }
      await client.query('rollback to savepoint sp1');
      t.ok(blocked, 'trigger blocks client_visible=true with no docx_path');

      // ── Trigger: allows it once a path is attached ────────────────────────
      await client.query(`update pi_report_archive set docx_path=$2 where id=$1`, [sharedId, '5001/' + sharedId + '.docx']);
      await client.query(`update pi_report_archive set client_visible=true where id=$1`, [sharedId]);
      const check1 = await client.query(`select client_visible, docx_path from pi_report_archive where id=$1`, [sharedId]);
      t.eq(check1.rows[0].client_visible, true, 'trigger allows the share once docx_path is set');
      t.eq(check1.rows[0].docx_path, '5001/' + sharedId + '.docx', 'and the path is what was set');

      // ── Grandfathering: a row that predates the trigger (simulated by ────
      // disabling it for one insert, since CREATE TRIGGER in real Postgres
      // never re-validates rows that already existed) stays shared, and an
      // unrelated later edit does not get caught by the guard.
      await client.query(`alter table pi_report_archive disable trigger trg_report_archive_require_docx`);
      const gf = await client.query(
        `insert into pi_report_archive (project_id, report_num, report_title, sections, archived_at, archived_by, client_visible, docx_path)
         values ('5001', '3', 'Grandfathered Report', '[]'::jsonb, now(), 'tester', true, null) returning id`);
      await client.query(`alter table pi_report_archive enable trigger trg_report_archive_require_docx`);
      const gfId = gf.rows[0].id;
      await client.query(`update pi_report_archive set overall_summary='revised wording' where id=$1`, [gfId]);
      const check2 = await client.query(`select client_visible, docx_path, overall_summary from pi_report_archive where id=$1`, [gfId]);
      t.eq(check2.rows[0].client_visible, true, 'a grandfathered pre-existing share survives untouched');
      t.eq(check2.rows[0].docx_path, null, 'still with no docx_path — nothing here force-attaches one');
      t.eq(check2.rows[0].overall_summary, 'revised wording', 'and an unrelated edit to it is not blocked by the trigger');

      // ── Storage RLS: staff sees every object; a granted OTP client and a ──
      // token-link visitor each see only the SHARED report's file, never the
      // unattached one's.
      await client.query(`insert into storage.objects (bucket_id, name) values ('report-files', $1)`, ['5001/' + sharedId + '.docx']);
      await client.query(`update pi_report_archive set docx_path=$2 where id=$1`, [unattachedId, '5001/' + unattachedId + '.docx']);
      await client.query(`insert into storage.objects (bucket_id, name) values ('report-files', $1)`, ['5001/' + unattachedId + '.docx']);
      await client.query(`insert into pi_client_access (project_id, email) values ('5001', 'client@example.com')`);
      await client.query(`insert into pi_portal_links (project_id, token) values (5001, '22222222-2222-2222-2222-222222222222')`);

      await client.query('set role authenticated');
      await client.query(`set request.jwt.claims to '{"email":"staff@sunrise.example"}'`);
      let r = await client.query(`select name from storage.objects where bucket_id='report-files' order by name`);
      t.eq(r.rows.map(x => x.name), ['5001/' + sharedId + '.docx', '5001/' + unattachedId + '.docx'].sort(),
           'staff sees every object in the bucket');

      await client.query(`set request.jwt.claims to '{"email":"client@example.com"}'`);
      r = await client.query(`select name from storage.objects where bucket_id='report-files' order by name`);
      t.eq(r.rows.map(x => x.name), ['5001/' + sharedId + '.docx'],
           'an OTP-granted client sees only the file behind a report that is actually shared');
      await client.query('reset role');
      await client.query('reset request.jwt.claims');

      await client.query('set role anon');
      r = await client.query(`select name from storage.objects where bucket_id='report-files' order by name`);
      t.eq(r.rows.map(x => x.name), ['5001/' + sharedId + '.docx'],
           'a token-link visitor sees only the shared report\'s file too');
      await client.query('reset role');

      await client.query('rollback');
    } finally {
      client.release();
    }

    // ── Part 2: app-level wiring — the archive panel and the portal ─────────
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
      t.ok(proj, 'found a demo project');

      const out = await app.page.evaluate(async (pid) => {
        S.projectFilter = pid;
        window.__toasts = [];
        const realToast = showToast;
        window.showToast = (msg, type) => { window.__toasts.push({ msg, type }); realToast(msg, type, 1); };

        // A fresh archive with no file attached — never went through the UI's
        // "Save to archive" flow, so it exercises the same code path.
        const insId = await sbAdd('report_archive', {
          projectId: pid, reportNum: '99', reportTitle: 'Wiring Test Report',
          sections: [], archivedAt: new Date().toISOString(), archivedBy: 'tester',
          clientVisible: false,
        });
        if (!_syncCache.report_archive) _syncCache.report_archive = [];
        _syncCache.report_archive.push({ id: insId, projectId: pid, reportNum: '99', reportTitle: 'Wiring Test Report', sections: [], archivedAt: new Date().toISOString(), archivedBy: 'tester', clientVisible: false, docxPath: null });

        const res = {};

        // The panel renders every archived report for the project, including
        // the demo seed's own rows — isolate to just this test's row so a
        // "disabled Share" or "no docx" check can't accidentally match some
        // OTHER report's row instead of the one actually being exercised.
        function isolatedArchiveHTML() {
          const full = _syncCache.report_archive;
          _syncCache.report_archive = full.filter(r => String(r.id) === String(insId));
          const html = _buildArchiveHTML(pid);
          _syncCache.report_archive = full;
          return html;
        }

        // ── Panel shows the unattached state and a disabled Share ──────────
        const htmlBefore = isolatedArchiveHTML();
        res.showsNoDocx = /No final \.docx attached/.test(htmlBefore);
        res.showsAttachButton = /Attach final \.docx/.test(htmlBefore);
        res.shareDisabledBefore = new RegExp('disabled[^>]*>Share<').test(htmlBefore);

        // ── Client-side guard: toggling share with no file attached is refused ──
        await toggleReportShared(insId);
        res.toastAfterBlockedShare = window.__toasts.slice(-1)[0];
        const recAfterBlocked = _syncCache.report_archive.find(r => String(r.id) === String(insId));
        res.clientVisibleAfterBlocked = recAfterBlocked.clientVisible;

        // ── Rejects a non-.docx file without touching the record ───────────
        const badFile = new File(['not a docx'], 'notes.txt', { type: 'text/plain' });
        await _doUploadReportDocx(insId, badFile);
        res.toastAfterBadFile = window.__toasts.slice(-1)[0];
        res.docxPathAfterBadFile = recAfterBlocked.docxPath || null;

        // ── Attaches a real .docx, then Share becomes available and works ──
        const goodFile = new File(['docx bytes'], 'Final Report.docx',
          { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        await _doUploadReportDocx(insId, goodFile);
        res.docxPathAfterUpload = recAfterBlocked.docxPath;

        const htmlAfter = isolatedArchiveHTML();
        res.showsAttachedAfter = /Final \.docx attached/.test(htmlAfter);
        res.shareEnabledAfter = /onclick="toggleReportShared\('/.test(htmlAfter) && !new RegExp('disabled[^>]*>Share<').test(htmlAfter);

        await toggleReportShared(insId);
        res.clientVisibleAfterShare = recAfterBlocked.clientVisible;

        return res;
      }, proj.id);

      t.ok(out.showsNoDocx, 'archive panel names the unattached state honestly');
      t.ok(out.showsAttachButton, 'and offers "Attach final .docx"');
      t.ok(out.shareDisabledBefore, 'Share is disabled before a file is attached');

      t.ok(out.toastAfterBlockedShare && /Attach the final/i.test(out.toastAfterBlockedShare.msg),
           'toggling share with no file attached is refused client-side with a clear reason');
      t.eq(out.clientVisibleAfterBlocked, false, 'and clientVisible never actually flips');

      t.ok(out.toastAfterBadFile && /\.docx file/i.test(out.toastAfterBadFile.msg),
           'a non-.docx file is rejected before any upload is attempted');
      t.eq(out.docxPathAfterBadFile, null, 'so the record is left untouched');

      t.ok(out.docxPathAfterUpload && /\.docx$/.test(out.docxPathAfterUpload),
           `a real .docx upload records a path (got: ${out.docxPathAfterUpload})`);
      t.ok(out.showsAttachedAfter, 'the panel reflects the attached file after upload');
      t.ok(out.shareEnabledAfter, 'and Share is no longer disabled');
      t.eq(out.clientVisibleAfterShare, true, 'sharing now succeeds once a file is attached');

      // Confirm it actually round-tripped through the real DB, not just the cache.
      const dbRow = (await t.sql(`select docx_path, client_visible from pi_report_archive where report_num='99'`))[0];
      t.ok(dbRow && dbRow.docx_path, 'docx_path persisted to the database');
      t.eq(dbRow.client_visible, true, 'client_visible persisted too');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }

    // ── Part 3: the portal renders Download-only for an attached report, ────
    // and keeps the original View/Print for a grandfathered one with none.
    const proj2 = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
    await t.sql(
      `insert into pi_report_archive (project_id, report_num, report_title, sections, archived_at, archived_by, client_visible, docx_path)
       values ($1, '201', 'Portal Download Report', '[]'::jsonb, now(), 'tester', true, $2)`,
      [String(proj2.id), proj2.id + '/portal-test.docx']);
    // Simulates a report shared before this feature existed — see the trigger
    // disable/enable around the demo seed's own report_archive insert for why
    // a fresh INSERT needs this to stand in for a genuinely pre-existing row.
    await t.sql(`alter table pi_report_archive disable trigger trg_report_archive_require_docx`);
    await t.sql(
      `insert into pi_report_archive (project_id, report_num, report_title, overall_summary, sections, archived_at, archived_by, client_visible, docx_path)
       values ($1, '202', 'Portal Preview Report', 'Grandfathered summary text', '[]'::jsonb, now(), 'tester', true, null)`,
      [String(proj2.id)]);
    await t.sql(`alter table pi_report_archive enable trigger trg_report_archive_require_docx`);

    const link = (await t.sql(`select token from pi_portal_links where project_id=$1`, [proj2.id]))[0]
      || (await t.sql(`insert into pi_portal_links (project_id, token) values ($1, gen_random_uuid()) returning token`, [proj2.id]))[0];

    const portal = await t.open(`client-portal.html?token=${link.token}`);
    try {
      await portal.page.waitForFunction(
        () => typeof renderSection === 'function' && document.querySelector('.nav-item, nav'),
        { timeout: 15000 });
      await portal.page.evaluate(() => renderSection('summary'));
      await portal.page.waitForFunction(
        () => /Portal Download Report|Portal Preview Report/.test(document.body.innerHTML), { timeout: 8000 });

      const html = await portal.page.evaluate(() => document.body.innerHTML);
      t.ok(/Download report \(\.docx\)/.test(html), 'a report with docx_path shows a Download button in the portal');
      t.ok(/Portal Preview Report/.test(html) && />View</.test(html),
           'a grandfathered report (no docx_path) still shows View');
      t.ok(/Print \/ PDF/.test(html), 'and still shows Print / PDF');
      t.eq(portal.errors, [], 'no page errors in the portal');
    } finally {
      await portal.close();
    }
  },
};
