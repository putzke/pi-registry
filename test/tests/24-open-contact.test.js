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
