// A deliverable's due date only means something for a MILESTONE.
//
// The portal Overview's "Upcoming Deadlines" card sorted EVERY incomplete
// deliverable by due_date. But pi_deliverables.scope_type has three values and
// only one of them has a deadline: a `recurring` deliverable is a cadence
// (freq 'Bi-weekly', bounded by milestone_start/_end — free text like "End of
// construction") and a `fixed` one is a quantity with no cadence. Both carry
// the end of the contract window in due_date, so on a construction project —
// where most PI deliverables are one of those two — the card collapsed into the
// project end date printed three times, and got worse as milestones completed.
//
// It is now a forward look-ahead, and the only thing on that page that faces
// forward at all: Recent Activity and the trend chart are backward, Heads Up is
// exception-based. Recurring and fixed deliverables are excluded BY KIND so the
// pile-up cannot return, and the Deliverables tab tells their real story
// (cadence and delivered-of-contracted) instead of a fake date.
module.exports = {
  name: 'portal — Coming Up looks forward, and a cadence is not a deadline',
  async run({ t }) {
    t.seed();

    const proj = (await t.sql(
      `select id, pid from pi_projects where pid='25-LC-400N'`))[0];
    t.ok(proj, 'found the construction-phase demo project');
    const token = (await t.sql(
      `select token from pi_portal_links where project_id::text=$1 limit 1`,
      [String(proj.id)]))[0];
    t.ok(token, 'it has a portal link');

    // Dated relative to now so the window is stable whenever the suite runs.
    const iso = d => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
    await t.sql(
      `insert into pi_deliverables
         (project_id, title, deliverable_type, scope_type, freq, status, progress,
          contracted_qty, delivered_count, due_date, milestone_start, milestone_end)
       values
         ($1,'Bi-weekly PI summary reports','PI summary report','recurring','Bi-weekly',
          'In progress',60,6,4,$2,'Start of construction','End of construction'),
         ($1,'Construction update newsletter','Digital newsletter','fixed','',
          'In progress',33,3,1,$2,null,null),
         ($1,'Pre-construction notice flyer','Notification flyer','milestone','',
          'Not started',0,1,0,$3,null,null),
         ($1,'Final PI closeout report','Final PI closeout report','milestone','',
          'Not started',0,1,0,$4,null,null)`,
      // The recurring and fixed rows sit INSIDE the 60-day window on purpose:
      // their kind is the only thing keeping them out, which is the real case —
      // "due" Oct 16 on a project that ends Oct 31, read in late August.
      [String(proj.id), iso(40), iso(20), iso(200)]);
    await t.sql(
      `insert into pi_meetings (project_id, title, meeting_date, meeting_type, status)
       values ($1,'Public open house',$2,'Public meeting','Scheduled')`,
      [String(proj.id), iso(9)]);
    await t.sql(
      `insert into pi_commitments (project_id, commitment, due_date, status)
       values ($1,'Restore driveway access on 400 North',$2,'Open'),
              ($1,'Send the noise study to the HOA',$3,'Open')`,
      [String(proj.id), iso(12), iso(-30)]);   // the second is already past due
    await t.sql(
      `insert into pi_comment_periods (id, project_id, title, status, start_date, end_date)
       values ('cp-coming-up',$1,'Design review','Open',$2,$3)`,
      [String(proj.id), iso(25), iso(45)]);

    const app = await t.open(`client-portal.html?token=${token.token}`);
    try {
      await app.page.waitForFunction(
        () => document.querySelector('#ov-coming .upcoming-list, #ov-coming .empty-state'),
        { timeout: 15000 });

      const card = await app.page.evaluate(() => {
        const el = document.getElementById('ov-coming');
        const rows = [...el.querySelectorAll('.upcoming-list li')].map(li => ({
          tag: li.querySelector('.up-tag')?.textContent.trim() || '',
          text: li.querySelector('.upcoming-title')?.textContent.trim() || '',
          due: li.querySelector('.upcoming-due')?.textContent.trim() || '',
          when: li.querySelector('.up-when')?.textContent.trim() || '',
        }));
        return { title: el.querySelector('.card-title').textContent, rows,
                 html: el.innerHTML };
      });

      t.ok(/Coming Up/i.test(card.title), 'the card is a look-ahead, not a deadline list');
      t.eq(/Upcoming Deadlines/i.test(card.html), false, 'the old title is gone');
      t.gt(card.rows.length, 2, `it lists what is coming (${card.rows.length} items)`);

      // ── the forward view carries every kind of dated thing ───────────────
      const tags = card.rows.map(r => r.tag);
      t.ok(tags.includes('Event'), 'scheduled events appear — the page had no forward view of outreach at all');
      t.ok(tags.includes('Commitment'), 'commitments coming due appear');
      t.ok(tags.includes('Deliverable'), 'and milestone deliverables');
      t.ok(card.rows.some(r => /Comment Period/i.test(r.tag)), 'and comment period dates');

      // ── the bug: a cadence is not a deadline ────────────────────────────
      t.eq(card.rows.some(r => /Bi-weekly PI summary/i.test(r.text)), false,
           'a RECURRING deliverable is not listed as a deadline');
      t.eq(card.rows.some(r => /Construction update newsletter/i.test(r.text)), false,
           'nor is a FIXED one — neither has a due date, only a contract window');
      t.ok(card.rows.some(r => /Pre-construction notice flyer/i.test(r.text)),
           'the milestone deliverable inside the window IS listed');
      t.eq(card.rows.some(r => /Final PI closeout/i.test(r.text)), false,
           'and one 200 days out is not — 60 days is the window');

      // Everything shown is genuinely in the future and genuinely sorted.
      const dates = card.rows.map(r => new Date(r.due));
      t.ok(dates.every(d => !isNaN(d)), 'every row carries a readable date');
      t.ok(dates.every((d, i) => i === 0 || dates[i-1] <= d), 'and they are in order');
      t.eq(card.rows.some(r => /noise study/i.test(r.text)), false,
           'a PAST-DUE commitment is not in the schedule — that is Heads Up\'s job');

      // A near item says how near; a far one does not repeat itself.
      const soon = card.rows.find(r => /open house/i.test(r.text));
      t.ok(soon && /in \d+ days|tomorrow|today/.test(soon.when),
           `an item inside two weeks says how soon (${soon && soon.when})`);
      const far = card.rows.find(r => /Design review/i.test(r.text));
      t.eq(far && far.when, '', 'one further out just shows its date');

      // ── the same period is not printed twice on one screen ──────────────
      const dupes = card.rows.filter(r => /Design review/.test(r.text) && /closes/.test(r.text));
      const inAttn = await app.page.evaluate(() =>
        [...document.querySelectorAll('.attn-item')].map(x => x.textContent).join(' '));
      if (/Design review/.test(inAttn) && /closes/.test(inAttn)) {
        t.eq(dupes.length, 0, 'a closing period Heads Up already named is not repeated');
      } else {
        t.ok(true, 'Heads Up did not claim this period (it closes beyond 14 days)');
      }

      // ── the Deliverables tab tells the recurring story properly ──────────
      await app.page.evaluate(() => renderSection('deliverables'));
      await app.page.waitForFunction(() => /Schedule/.test(document.body.innerHTML), { timeout: 8000 });
      const tbl = await app.page.evaluate(() => {
        const rows = [...document.querySelectorAll('table tbody tr')].map(tr =>
          [...tr.children].map(td => td.textContent.trim()));
        const heads = [...document.querySelectorAll('table thead th')].map(th => th.textContent.trim());
        return { heads, rows };
      });
      t.ok(tbl.heads.includes('Schedule'), 'the column is Schedule, not Due Date');
      t.eq(tbl.heads.includes('Due Date'), false, 'because most rows never had one');
      const find = name => tbl.rows.find(r => new RegExp(name, 'i').test(r[0]));
      const rec = find('Bi-weekly PI summary');
      t.ok(rec, 'the recurring deliverable is listed');
      t.ok(rec && /Bi-weekly/.test(rec[4]), `it shows its cadence ("${rec && rec[4]}")`);
      t.ok(rec && /End of construction/.test(rec[4]),
           'and its window verbatim — milestone_end is TEXT, and fmt() would have '
           + 'rendered it as an em dash and lost it');
      const fix = find('Construction update newsletter');
      t.ok(fix && /3 issues/.test(fix[4]), `a fixed one shows its contracted count ("${fix && fix[4]}")`);
      const mil = find('Pre-construction notice flyer');
      t.ok(mil && /\d{4}/.test(mil[4]), `a milestone still shows its date ("${mil && mil[4]}")`);

      // ── the kind is inferred, never guessed into a fake deadline ─────────
      const kinds = await app.page.evaluate(() => ({
        declared:  devKind({ scope_type: 'recurring', freq: '' }),
        byFreq:    devKind({ scope_type: '', freq: 'Monthly' }),
        byQty:     devKind({ scope_type: '', freq: '', contracted_qty: 4 }),
        single:    devKind({ scope_type: '', freq: '', contracted_qty: 1 }),
        bare:      devKind({}),
        casing:    devKind({ scope_type: ' Milestone ' }),
      }));
      t.eq(kinds.declared, 'recurring', 'a declared scope_type wins');
      t.eq(kinds.byFreq, 'recurring', 'an old row with a cadence is recurring');
      t.eq(kinds.byQty, 'fixed', 'one with a quantity above 1 is fixed');
      t.eq(kinds.single, 'milestone', 'a single-quantity row is a milestone');
      t.eq(kinds.bare, 'milestone', 'and so is a bare one');
      t.eq(kinds.casing, 'milestone', 'stored casing and padding do not matter');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
