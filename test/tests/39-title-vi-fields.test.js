// Title VI / LEP / EJ fields, and the public comment form.
//
// Roadmap item 3. `underserved` and `equity_form_submitted` appeared in ZERO
// tests, and `lep` only in a schema listing. These are civil-rights compliance
// fields: an LEP contact who silently loses their flag is a Title VI
// documentation failure, not a display quirk — and this codebase has already
// shipped exactly that bug once, when saveStake() read an element id that did
// not exist and blanked every parcel number on save.
//
// So the shape of this test is deliberate. It is not "does the checkbox
// render" — it is: does the flag survive a round trip, does it survive an
// UNRELATED edit, can you still find the contact afterwards, and does it reach
// the compliance report.
module.exports = {
  name: 'Title VI — LEP/EJ flags survive, stay findable, and reach the report',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(
        `select id, pid from pi_projects where pid='25-154-001'`))[0];
      const P = String(proj.id);

      // ── both checkboxes exist, and saveStake reads the ids that exist ────
      // The parcel-ID bug was exactly this: a save reading an element that was
      // never rendered, so every save quietly wrote a blank.
      const wiring = await app.page.evaluate(async () => {
        await openStakeModal();
        const ids = ['f-slep', 'f-sund'];
        const present = ids.filter(i => document.getElementById(i));
        const src = String(saveStake);
        const read = ids.filter(i => src.includes("'" + i + "'"));
        closeM && closeM();
        return { present, read };
      });
      t.eq(wiring.present, ['f-slep', 'f-sund'], 'both equity checkboxes render');
      t.eq(wiring.read, ['f-slep', 'f-sund'],
           'and saveStake reads those exact ids — not ones that never existed');

      // ── round trip: tick both, save, reopen ──────────────────────────────
      const NAME = { first: 'Alma', last: 'Verde-Testcase' };
      const created = await app.page.evaluate(async ([pid, nm]) => {
        await openStakeModal();
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
        set('f-fn', nm.first); set('f-ln', nm.last);
        set('f-em', 'alma.verde@demo.test');
        set('f-st', 'Resident');
        document.getElementById('f-slep').checked = true;
        document.getElementById('f-sund').checked = true;
        const lp = document.getElementById('f-lp'); if (lp) lp.value = pid;
        await saveStake();
        const s = DB.get('stakeholders').find(x => x.lastName === nm.last);
        return s ? String(s.id) : null;
      }, [P, NAME]);
      t.ok(created, 'the contact saved');

      await app.page.waitForTimeout(900);
      let row = (await t.sql(
        `select id, lep, underserved from pi_stakeholders where last_name=$1`,
        [NAME.last]))[0];
      t.ok(row, 'and reached the database');
      t.eq(row.lep, true, 'lep is stored true');
      t.eq(row.underserved, true, 'underserved is stored true');

      const reopened = await app.page.evaluate(async id => {
        await openStakeModal(id);
        const r = { lep: document.getElementById('f-slep').checked,
                    ej:  document.getElementById('f-sund').checked };
        closeM && closeM();
        return r;
      }, created);
      t.eq(reopened.lep, true, 'reopening shows LEP still ticked');
      t.eq(reopened.ej, true, 'and EJ still ticked');

      // ── the failure that actually bites: an UNRELATED edit ───────────────
      // Change the phone number and save. The flags must not move. This is the
      // exact shape of the parcel-ID bug, which nobody noticed until a whole
      // imported column had been wiped.
      await app.page.evaluate(async id => {
        await openStakeModal(id);
        document.getElementById('f-ph').value = '801-555-0199';
        await saveStake();
      }, created);
      await app.page.waitForTimeout(900);
      row = (await t.sql(
        `select lep, underserved, phone from pi_stakeholders where last_name=$1`,
        [NAME.last]))[0];
      t.ok(/0199/.test(row.phone || ''), 'the unrelated edit saved');
      t.eq(row.lep, true, 'LEP survived an edit that had nothing to do with it');
      t.eq(row.underserved, true, 'so did EJ');

      // Unticking must still work, or the flag would be write-once.
      await app.page.evaluate(async id => {
        await openStakeModal(id);
        document.getElementById('f-slep').checked = false;
        await saveStake();
      }, created);
      await app.page.waitForTimeout(900);
      row = (await t.sql(
        `select lep, underserved from pi_stakeholders where last_name=$1`, [NAME.last]))[0];
      t.eq(row.lep, false, 'unticking LEP clears it');
      t.eq(row.underserved, true, 'without disturbing EJ');

      // ── findable ─────────────────────────────────────────────────────────
      // A flag you cannot filter on documents nothing.
      const found = await app.page.evaluate(([pid, last]) => {
        S.projectFilter = pid;
        const out = {};
        S.skLEP = false; S.skEJ = true; setView('stakeholders');
        out.ejRows = document.querySelectorAll('#main .lrow').length;
        out.ejHasOurs = /Verde-Testcase/.test(document.getElementById('main').innerHTML);
        S.skEJ = false; setView('stakeholders');
        out.allRows = document.querySelectorAll('#main .lrow').length;
        S.skLEP = false; S.skEJ = false;
        return out;
      }, [P, NAME.last]);
      t.gt(found.allRows, found.ejRows,
           `the EJ filter narrows the list (${found.ejRows} of ${found.allRows})`);
      t.ok(found.ejHasOurs, 'and the flagged contact is in it');

      // ── it reaches the compliance report ─────────────────────────────────
      const compliance = await app.page.evaluate(pid => {
        const html = _buildSectionPreviewTable('auto-pi-compliance', pid,
                                               '2020-01-01', '2030-01-01', true) || '';
        // Pull the number that sits next to each label, however it is marked up.
        const near = re => {
          const m = html.replace(/<[^>]+>/g, '\u0001').match(re);
          return m ? Number(m[1]) : null;
        };
        return { hasLEP: /LEP|Limited English/i.test(html),
                 hasEJ: /EJ|Environmental Justice|Underserved/i.test(html),
                 lep: near(/LEP[^0-9]{0,80}?(\d+)/i),
                 ej:  near(/(?:Environmental Justice|Underserved|EJ)[^0-9]{0,80}?(\d+)/i),
                 sample: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 260) };
      }, P);
      t.ok(compliance.hasLEP, 'the PI compliance section reports LEP');
      t.ok(compliance.hasEJ, 'and environmental justice');
      t.ok(compliance.lep !== null && compliance.ej !== null,
           `with counts beside each label (LEP ${compliance.lep}, EJ ${compliance.ej})`);
      t.ok((compliance.lep || 0) + (compliance.ej || 0) > 0,
           `and they are not both zero — the flags reach the record (${compliance.sample.slice(0,120)})`);

      // ── meeting equity toggle ────────────────────────────────────────────
      const mtg = await app.page.evaluate(async pid => {
        S.projectFilter = pid;
        openMeetingModal();
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
        set('f-mt', 'Equity toggle testcase');
        set('f-md', '2026-05-14');
        set('f-mp', pid);
        const eq = document.getElementById('f-mequity');
        const existed = !!eq;
        if (eq) eq.checked = true;
        await saveMeeting();
        return { existed };
      }, P);
      t.ok(mtg.existed, 'the meeting modal renders the equity toggle');
      await app.page.waitForTimeout(900);
      const mrow = (await t.sql(
        `select title, equity_form_submitted from pi_meetings where title=$1`,
        ['Equity toggle testcase']))[0];
      t.ok(mrow, 'the event saved');
      t.eq(mrow.equity_form_submitted, true,
           'and equity_form_submitted round-tripped as true');

      // Public comments are NOT covered here. The desktop form is broken:
      // saveComment() writes internal names (commentText, submittedDate,
      // commenterName, topic, commentMethod) that are absent from
      // SB_TO_INT.pi_public_comments, so toSB() drops every one and the row
      // persists with project_id and response_status and nothing else. See
      // test/tests/40-public-comment-loss.test.js, which asserts the bug
      // rather than pretending it isn't there.

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
