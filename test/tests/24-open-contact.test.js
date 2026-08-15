// Clicking a contact's name should open that contact.
//
// Every cross-view link spelled it selectStake(id) then setView('stakeholders'),
// which cannot work: setView() clears S.selStakeholder, and filterByProject()
// clears it too. Both are right to — a view change and a project change each
// invalidate a selection made under the old scope — so the selection has to be
// applied AFTER them. It wasn't, so clicking a name in the interaction log
// landed on the unfiltered contact list and left you searching for the person
// whose row you had just clicked.
//
// The same shape as the openIntModal pre-selection bug: the argument was passed
// and then thrown away by a later call that is correct in isolation.
module.exports = {
  name: 'contact links — clicking a name opens that contact, scoped to its project',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const row = (await t.sql(`
        select i.id, i.stakeholder_id, i.project_id, s.last_name
          from pi_interactions i
          join pi_stakeholders s on s.id::text = i.stakeholder_id::text
         where coalesce(s.last_name,'') <> '' order by i.id limit 1`))[0];
      t.ok(row, 'found an interaction with a named contact');

      // ── the state that used to be wiped ─────────────────────────────────
      const after = await app.page.evaluate(([sid, pid]) => {
        S.projectFilter = ''; setView('interactions');
        openContact(sid, pid);
        return { view: S.view, sel: S.selStakeholder, proj: S.projectFilter, tab: S.stakeTab };
      }, [String(row.stakeholder_id), String(row.project_id)]);
      t.eq(after.view, 'stakeholders', 'it lands on Project contacts');
      t.eq(after.sel, String(row.stakeholder_id), 'with the contact SELECTED, not just listed');
      t.eq(after.proj, String(row.project_id), 'scoped to the interaction\'s own project');
      t.eq(after.tab, 'info', 'on the profile tab');

      // And the detail pane actually shows them — the state is only worth
      // anything if it survives the render.
      const pane = await app.page.evaluate(() => {
        const m = document.getElementById('main');
        return { html: m.innerHTML.length, text: m.textContent };
      });
      t.gt(pane.html, 200, 'the view rendered');
      t.ok(pane.text.includes(row.last_name),
           `the contact's name appears on screen (${row.last_name})`);

      // ── the row is highlighted AND scrolled into view ───────────────────
      // Landing on a contact whose row is below the fold means the detail pane
      // names one person while the list shows another, with no way to see where
      // you are or to click back after looking at someone else.
      // Deliberately the LAST contact in the list. A contact near the top is
      // visible at scrollTop 0 whether or not anything scrolled, so testing one
      // of those proves nothing — verified by removing the scroll call and
      // watching this still pass.
      const last = await app.page.evaluate(pid => {
        S.projectFilter = pid; setView('stakeholders');
        const rows = [...document.querySelectorAll('.lrow')];
        const el = rows[rows.length - 1];
        const m = (el.getAttribute('onclick') || '').match(/selectStake\('([^']+)'\)/);
        return { id: m && m[1], total: rows.length };
      }, String(row.project_id));
      t.ok(last.id, 'found the last contact in the project list');
      t.gt(last.total, 10, 'the list is long enough to need scrolling');

      const inList = await app.page.evaluate(async ([sid, pid]) => {
        setView('interactions');                    // arrive from somewhere else
        openContact(sid, pid);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(
          () => setTimeout(r, 30))));               // let the scroll settle
        // The scroller is the .data-list INSIDE the pane; the pane itself is
        // overflow:hidden and its scrollTop never moves.
        const pane = _skScroller();
        const rows = [...document.querySelectorAll('.lrow')];
        const sel = document.querySelector('.lrow.sel');
        if (!pane || !sel) return { pane: !!pane, sel: !!sel };
        const pr = pane.getBoundingClientRect(), sr = sel.getBoundingClientRect();
        return {
          pane: true, sel: true,
          selCount: document.querySelectorAll('.lrow.sel').length,
          index: rows.indexOf(sel), total: rows.length,
          overflows: pane.scrollHeight > pane.clientHeight,
          visible: sr.top >= pr.top - 1 && sr.bottom <= pr.bottom + 1,
          scrolled: pane.scrollTop,
          matches: (sel.getAttribute('onclick') || '').includes(sid),
        };
      }, [String(last.id), String(row.project_id)]);
      t.ok(inList.pane, 'the list pane rendered');
      t.ok(inList.sel, 'a row is marked selected');
      t.eq(inList.selCount, 1, 'exactly one');
      t.ok(inList.matches, 'and it is the contact that was opened');
      t.ok(inList.overflows, 'the list really is taller than its pane');
      t.gt(inList.scrolled, 0, 'the pane scrolled rather than sitting at the top');
      t.ok(inList.visible,
           `the selected row is visible (row ${inList.index} of ${inList.total}, `
           + `scrollTop ${inList.scrolled})`);

      // ── proof the old spelling really was broken ────────────────────────
      // Not a hypothetical: this is exactly what every call site did.
      const oldWay = await app.page.evaluate(sid => {
        setView('interactions');
        selectStake(sid); setView('stakeholders');
        return S.selStakeholder;
      }, String(row.stakeholder_id));
      t.eq(oldWay, null, 'selectStake() then setView() still ends with no selection');

      const viaFilter = await app.page.evaluate(([sid, pid]) => {
        setView('interactions');
        filterByProject(pid); selectStake(sid); setView('stakeholders');
        return S.selStakeholder;
      }, [String(row.stakeholder_id), String(row.project_id)]);
      t.eq(viaFilter, null, 'and so does the filterByProject variant');

      // ── the rendered links use the working path ─────────────────────────
      await app.page.evaluate(() => { S.projectFilter = ''; setView('interactions'); });
      await app.page.waitForTimeout(200);
      const links = await app.page.evaluate(() => {
        const els = [...document.querySelectorAll('#main .td-link')]
          .map(e => e.getAttribute('onclick') || '');
        return { total: els.length,
                 viaOpenContact: els.filter(x => /openContact\(/.test(x)).length,
                 stale: els.filter(x => /selectStake\([^)]*\);\s*setView/.test(x)).length };
      });
      t.gt(links.total, 0, 'the interaction log renders contact links');
      t.eq(links.stale, 0, 'none of them uses the spelling that loses the selection');
      t.eq(links.viaOpenContact, links.total, 'they all go through openContact');

      // ── an anonymous interaction has nobody to open ─────────────────────
      const anon = (await t.sql(`
        select id from pi_interactions where stakeholder_id is null limit 1`))[0];
      if (anon) {
        const guard = await app.page.evaluate(() => {
          S.selStakeholder = 'sentinel';
          openContact('', '123');
          return S.selStakeholder;
        });
        t.eq(guard, 'sentinel', 'opening a blank contact id does nothing at all');
      }

      // ── a contact reached from another project keeps working ────────────
      // The contact may not be linked to whatever project was in scope, which
      // is why the link passes the interaction's own project rather than S.
      const cross = (await t.sql(`
        select i.stakeholder_id, i.project_id from pi_interactions i
          join pi_stakeholders s on s.id::text = i.stakeholder_id::text
         where i.project_id::text <> $1 order by i.id limit 1`,
        [String(row.project_id)]))[0];
      t.ok(cross, 'seed spans more than one project');
      const moved = await app.page.evaluate(([sid, pid, other]) => {
        S.projectFilter = other; setView('interactions');
        openContact(sid, pid);
        return { proj: S.projectFilter, sel: S.selStakeholder };
      }, [String(cross.stakeholder_id), String(cross.project_id), String(row.project_id)]);
      t.eq(moved.proj, String(cross.project_id),
           'the scope follows the contact, not the view you came from');
      t.eq(moved.sel, String(cross.stakeholder_id), 'and the contact is selected');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
