// A public comment logged through the desktop form must survive.
//
// It did not. saveComment() built its record with internal names that were
// absent from SB_TO_INT.pi_public_comments — commentText, topic, commentMethod,
// submittedDate, commenterName, commenterOrg, commentPeriodId,
// commentPeriodType, commenterEmail, respondedBy, notes. toSB() drops any key
// it cannot map, so the row that persisted carried project_id and
// response_status and nothing else. The comment painted into the list from the
// cache and then vanished when DB._sync's write was rejected.
//
// On a NEPA project the public comments received during a comment period ARE
// the formal record — "23 received, 18 responded" is a compliance figure — so
// those were blank rows on a compliance artifact.
//
// The cause was one table with two vocabularies. The form wrote and read one
// set; the REPORT sections (auto-comments, auto-comment-matrix,
// _buildSectionDraft) read c.summary and c.category — the mapped set, i.e. the
// columns that actually exist. Seeded comments showed up in reports and were
// blank in the form's own views; form-created comments were shells no report
// would ever count.
//
// Fixed by collapsing to the mapped vocabulary, plus
// sql/2026-08-25_public_comments_missing_columns.sql for the three fields that
// had no column at all and so needed a decision rather than a rename.
module.exports = {
  name: 'public comments — the desktop form round-trips every field it collects',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const proj = (await t.sql(
        `select id from pi_projects where pid='25-154-001'`))[0];
      const P = String(proj.id);
      const period = (await t.sql(
        `select id from pi_comment_periods where project_id::text=$1 limit 1`, [P]))[0];

      const C = {
        text:  'Testcase comment: requesting Spanish-language materials for the corridor mailing.',
        date:  '2026-05-20',
        name:  'Alma Verde',
        org:   'Riverton resident',
        email: 'alma.verde@demo.test',
      };

      // ── one vocabulary ───────────────────────────────────────────────────
      // Every key the form writes must be mappable, or toSB() drops it in
      // silence. This is the assertion that would have caught the original bug.
      const vocab = await app.page.evaluate(() => {
        const map = SB_TO_INT.pi_public_comments;
        const src = String(saveComment);
        const body = src.slice(src.indexOf('const data={'), src.indexOf('const all='));
        const keys = [...body.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:/gm)].map(m => m[1]);
        return { keys, unmapped: keys.filter(k => !(k in map)) };
      });
      t.gt(vocab.keys.length, 10, `saveComment writes ${vocab.keys.length} fields`);
      t.eq(vocab.unmapped, [],
           'and every one of them maps to a real column — nothing is dropped');

      // ── save through the real form ───────────────────────────────────────
      const before = (await t.sql(`select count(*)::int n from pi_public_comments`))[0].n;
      const seeded = (await t.sql(
        `select count(*)::int n from pi_public_comments where project_id::text=$1`, [P]))[0].n;
      await app.page.evaluate(async ([pid, c, periodId]) => {
        window.alert = () => {};
        S.projectFilter = pid;
        setView('comments');
        openCommentModal();
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
        set('f-cmtproj', pid);
        set('f-cmttext', c.text);
        set('f-cmtdate', c.date);
        set('f-cmtname', c.name);
        set('f-cmtorg', c.org);
        set('f-cmtemail', c.email);
        if (periodId) set('f-cmtperiodid', periodId);
        const topic = document.getElementById('f-cmttopic');
        if (topic && topic.options.length > 1) topic.selectedIndex = 1;
        const method = document.getElementById('f-cmtmethod');
        if (method && method.options.length > 1) method.selectedIndex = 1;
        set('f-cmtrby', 'J. Putzke');
        set('f-cmtnotes', 'Internal: flagged for the Title VI file.');
        saveComment();
      }, [P, C, period ? String(period.id) : '']);
      await app.page.waitForTimeout(1200);

      t.eq((await t.sql(`select count(*)::int n from pi_public_comments`))[0].n,
           before + 1, 'the comment is inserted');

      // ── and it is all there ──────────────────────────────────────────────
      const row = (await t.sql(
        `select * from pi_public_comments where summary=$1`, [C.text]))[0];
      t.ok(row, 'the row is findable BY ITS TEXT — the field that used to be null');
      if (row) {
        t.eq(String(row.project_id), P, 'project');
        t.eq(row.summary, C.text, 'the comment text survives');
        t.eq(row.comment_date, C.date, 'the date survives');
        t.eq(row.commenter, C.name, 'the commenter name survives');
        t.eq(row.affiliation, C.org, 'their affiliation survives');
        t.ok(row.category, `the topic survives (${row.category})`);
        t.ok(row.channel, `the method survives (${row.channel})`);
        if (period) t.eq(String(row.period_id), String(period.id),
                         'and it is tied to its comment period');

        // The three columns the migration added.
        t.eq(row.commenter_email, C.email,
             'commenter_email — the reply-to for a formal response');
        t.eq(row.responded_by, 'J. Putzke', 'responded_by — attribution');
        t.ok(/Title VI/.test(row.notes || ''), 'notes — internal, and kept');
      }

      // ── no rejected write ────────────────────────────────────────────────
      t.eq(app.errors.filter(e => /rejected by the database/i.test(e)), [],
           'DB._sync reports no rejection — the whole record was accepted');

      // ── it survives a reload ─────────────────────────────────────────────
      const reloaded = await t.open('index.html', { email: 'putzke@demo.test' });
      try {
        await reloaded.ready();
        const back = await reloaded.page.evaluate(([pid, text]) => {
          const c = (DB.get('public_comments') || []).find(x => x.summary === text);
          if (!c) return null;
          S.projectFilter = pid; setView('comments');
          return { commenter: c.commenter, affiliation: c.affiliation,
                   commentDate: c.commentDate, category: c.category,
                   channel: c.channel, commenterEmail: c.commenterEmail,
                   respondedBy: c.respondedBy, notes: c.notes,
                   renders: document.getElementById('main').innerHTML.includes(text),
                   // Built HERE, on a page that loaded this row from the
                   // database, so the counts cannot be a stale-cache artefact.
                   total: (DB.get('public_comments') || [])
                            .filter(x => String(x.projectId) === String(pid)).length,
                   matrix: _buildSectionPreviewTable('auto-comment-matrix', pid,
                             '2020-01-01', '2030-01-01', true) || '',
                   draft: _buildSectionDraft('auto-comment-matrix') || '' };
        }, [P, C.text]);
        t.ok(back, 'after a reload the comment is still in the cache');
        if (back) {
          t.eq(back.commenter, C.name, 'with its commenter');
          t.eq(back.commenterEmail, C.email, 'its email');
          t.eq(back.respondedBy, 'J. Putzke', 'and its responder — fromSB maps them back');
          t.ok(back.renders, 'and the Comments view shows it');

          // ── and the report can finally count it ──────────────────────
          // The point of the whole fix: the form's comments and the
          // report's comments are now the same records.
          //
          // NOTE the section names are a trap. 'auto-comments' does NOT read
          // pi_public_comments at all — it reads INTERACTIONS whose channel
          // is Comment card / Public meeting / Mail / In-person. Only
          // 'auto-comment-matrix' reads the public-comments table.
          t.eq(back.total, seeded + 1,
               `the project now has ${back.total} public comments, one more than the seed`);
          t.ok(back.matrix.includes(back.category),
               `the matrix groups it under its topic (${back.category})`);
          const n = (back.draft.match(/^(\d+) formal public comment/) || [])[1];
          t.eq(Number(n), seeded + 1,
               `and the AI facts count it (${n} formal public comments)`);
        }
      } finally { await reloaded.close(); }

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
