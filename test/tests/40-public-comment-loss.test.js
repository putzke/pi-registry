// ⚠ THIS TEST DOCUMENTS A LIVE BUG. It asserts the CURRENT broken behaviour so
// the failure is visible and measured; when the bug is fixed this test must be
// inverted, not deleted. Read the note at the bottom before touching it.
//
// The desktop "Log public comment" form loses everything the user types.
//
// saveComment() builds its record with internal names — commentText, topic,
// commentMethod, submittedDate, commenterName, commenterOrg, commenterEmail,
// commentPeriodId, commentPeriodType, respondedBy, notes. NONE of those appear
// in SB_TO_INT.pi_public_comments, which maps summary, category, channel,
// commentDate, commenter, affiliation, periodId, commentType. toSB() silently
// drops any key it cannot map, so the row that reaches Supabase carries
// project_id, response_status and response_text — and nothing else.
//
// The failure IS visible — DB._sync logs "1 write(s) to public_comments were
// rejected by the database" — but the row that does land is a shell, and the
// comment the user typed is gone the moment the modal closes.
//
// Why this matters more than an ordinary field bug: on a NEPA project, public
// comments during a comment period ARE the formal record. "23 received, 18
// responded" is a compliance figure, and a row with a null summary cannot be
// responded to, categorised, or reported.
//
// The app is split into two vocabularies over one table. The form writes and
// reads one set; the REPORT sections (_buildSectionDraft, the
// auto-comments/auto-comment-matrix tables) read c.summary and c.category —
// the mapped set. So seeded comments show up in reports and are blank in the
// form's own views, and form-created comments are empty rows that no report
// will ever count.
module.exports = {
  name: 'public comments — the desktop form drops every field it collects (KNOWN BUG)',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const proj = (await t.sql(
        `select id from pi_projects where pid='25-154-001'`))[0];
      const P = String(proj.id);

      const TEXT = 'Testcase comment: requesting Spanish-language materials.';

      // ── the two vocabularies ─────────────────────────────────────────────
      const vocab = await app.page.evaluate(() => {
        const map = SB_TO_INT.pi_public_comments;
        const written = ['commentText', 'topic', 'commentMethod', 'submittedDate',
                         'commenterName', 'commenterOrg', 'commenterEmail',
                         'commentPeriodId', 'commentPeriodType', 'respondedBy', 'notes'];
        return { mapped: Object.keys(map),
                 unmapped: written.filter(k => !(k in map)),
                 written };
      });
      t.eq(vocab.unmapped.length, vocab.written.length,
           `every field the form collects is unmapped (${vocab.unmapped.join(', ')})`);
      t.ok(vocab.mapped.includes('summary') && vocab.mapped.includes('category'),
           'while the mapping expects summary/category — the report sections\' names');

      // ── save a comment through the real form ─────────────────────────────
      const before = (await t.sql(
        `select count(*)::int n from pi_public_comments`))[0].n;
      await app.page.evaluate(async ([pid, text]) => {
        window.alert = () => {};
        S.projectFilter = pid;
        setView('comments');
        openCommentModal();
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
        set('f-cmtproj', pid);
        set('f-cmttext', text);
        set('f-cmtdate', '2026-05-20');
        set('f-cmtname', 'Alma Verde');
        set('f-cmtorg', 'Riverton resident');
        set('f-cmtemail', 'alma.verde@demo.test');
        set('f-cmttopic', 'Title VI / LEP');
        set('f-cmtmethod', 'Email');
        saveComment();
      }, [P, TEXT]);
      await app.page.waitForTimeout(1200);

      const after = (await t.sql(
        `select count(*)::int n from pi_public_comments`))[0].n;
      t.eq(after, before + 1, 'a row is inserted — the write itself succeeds');

      const row = (await t.sql(
        `select * from pi_public_comments order by created_at desc limit 1`))[0];

      // ── everything the user typed is gone ────────────────────────────────
      t.eq(String(row.project_id), P, 'the project survives');
      t.eq(row.summary, null, 'THE COMMENT TEXT IS LOST');
      t.eq(row.comment_date, null, 'the date is lost');
      t.eq(row.commenter, null, 'the commenter name is lost');
      t.eq(row.affiliation, null, 'their affiliation is lost');
      t.eq(row.category, null, 'the topic is lost');
      t.eq(row.channel, null, 'the method is lost');
      t.eq(row.period_id, null, 'and the comment period it belongs to is lost');
      t.ok(row.response_status,
           `only the two accidentally-matching keys land (response_status="${row.response_status}")`);

      // ── not even the session keeps it ────────────────────────────────────
      const inSession = await app.page.evaluate(text => {
        const all = DB.get('public_comments') || [];
        return { cached: all.some(x => (x.commentText || '') === text
                                    || (x.summary || '') === text),
                 rendersNow: /Testcase comment/.test(
                   document.getElementById('main').innerHTML) };
      }, TEXT);
      t.eq(inSession.cached, false,
           'the comment is not in _syncCache either — it is gone immediately, '
           + 'not on the next reload');
      t.eq(inSession.rendersNow, true,
           'though the Comments view DID paint it — saveComment renders from the '
           + 'cache before the sync is rejected, so the user watches it appear and '
           + 'then vanish');

      // A reload confirms nothing was recoverable.
      const reloaded = await t.open('index.html', { email: 'putzke@demo.test' });
      try {
        await reloaded.ready();
        const gone = await reloaded.page.evaluate(([pid, text]) => {
          const all = DB.get('public_comments') || [];
          const mine = all.filter(c => String(c.projectId) === String(pid));
          return { any: all.some(c => (c.commentText || c.summary || '').includes(text)),
                   blanks: mine.filter(c => !c.summary && !c.commentText).length };
        }, [P, TEXT]);
        t.eq(gone.any, false,
             'after a reload the comment text cannot be recovered from anywhere');
        t.gt(gone.blanks, 0, 'what is left is a blank row on the compliance record');
      } finally { await reloaded.close(); }

      // ── and no report will ever count it ─────────────────────────────────
      const report = await app.page.evaluate(pid => {
        const html = _buildSectionPreviewTable('auto-comments', pid,
                                               '2020-01-01', '2030-01-01', true) || '';
        return { has: /Testcase comment/.test(html) };
      }, P);
      t.eq(report.has, false,
           'the comment does not appear in the report section that documents the period');

      // The one piece of good news: this does NOT fail silently.
      t.ok(app.errors.some(e => /rejected by the database/i.test(e)),
           'DB._sync reports the rejected write, so the failure is at least visible '
           + 'in the console');
    } finally {
      await app.close();
    }
  },
};

// ── WHEN FIXING ───────────────────────────────────────────────────────────
// The mapping the form's fields want, against the columns that exist:
//
//   commentText       → summary          commentPeriodId   → period_id
//   topic             → category         commentPeriodType → comment_type
//   commentMethod     → channel          responseStatus    → response_status ✓
//   submittedDate     → comment_date     responseText      → response_text ✓
//   commenterName     → commenter        responseDate      → response_date
//   commenterOrg      → affiliation
//
// Three fields the form collects have NO column at all and need a decision,
// not a rename: commenterEmail, respondedBy, notes.
//
// Renaming inside saveComment() alone is not enough — openCommentModal() and
// renderComments() read the same 19 occurrences of the form's vocabulary, and
// the report sections already read the mapped one. Whichever direction is
// chosen, both sides have to move together or the split just changes address.
