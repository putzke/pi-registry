// "+ Log interaction" on a contact's own detail pane must open with that
// contact already selected.
//
// openIntModal(preStake) seeded the hidden #f-is from its argument and then,
// a few lines later, called updateIntStakeholders() — which blanks the field.
// That call is correct in its own right: it also runs when the project changes,
// where the previously chosen contact may not belong to the new project. But it
// meant the pre-selection was dead on arrival whenever a project was in scope,
// which is precisely the case on a contact's detail pane. You clicked "Log
// interaction" on Lachere Fackrell and had to search for Lachere Fackrell.
module.exports = {
  name: 'log interaction — opens with the contact you clicked from already selected',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const row = (await t.sql(`
        select ps.project_id, ps.stakeholder_id, s.first_name, s.last_name, s.org
          from pi_project_stakeholders ps
          join pi_stakeholders s on s.id::text = ps.stakeholder_id::text
         where coalesce(s.last_name,'') <> '' order by ps.id limit 1`))[0];
      t.ok(row, 'found a contact linked to a project');

      const read = () => app.page.evaluate(() => ({
        hidden: (document.getElementById('f-is') || {}).value,
        shown: (document.getElementById('f-is-search') || {}).value,
        placeholder: (document.getElementById('f-is-search') || {}).placeholder,
        project: (document.getElementById('f-ip') || {}).value,
      }));

      // ── the case that was broken ────────────────────────────────────────
      await app.page.evaluate(([proj, sid]) => {
        S.projectFilter = proj;
        openIntModal(sid);
      }, [String(row.project_id), String(row.stakeholder_id)]);
      await app.page.waitForTimeout(150);   // the placeholder runs on a timeout

      let v = await read();
      t.eq(v.hidden, String(row.stakeholder_id), 'the contact is selected');
      t.ok(v.shown.includes(row.last_name),
           `and their name is visible in the box — got "${v.shown}"`);
      if (row.org) t.ok(v.shown.includes(row.org), 'along with their organization');
      t.eq(v.project, String(row.project_id), 'the project is scoped too');
      t.eq(/Anonymous/i.test(v.placeholder || ''), false,
           'the Anonymous placeholder does not sit under a named contact');

      // Saving must attribute the interaction to them, not to Anonymous.
      await app.page.evaluate(() => {
        document.getElementById('f-isu').value = 'Prefill check — logged from the contact pane.';
        saveInt();
      });
      const saved = await t.until(async () => (await t.sql(
        `select stakeholder_id, anon_label from pi_interactions
          where summary = 'Prefill check — logged from the contact pane.'`))[0]);
      t.ok(saved, 'the interaction saved');
      t.eq(saved && String(saved.stakeholder_id), String(row.stakeholder_id),
           'attributed to the contact it was logged from');
      t.eq(saved && (saved.anon_label || ''), '', 'and not labelled anonymous');

      // ── the general button still opens empty ────────────────────────────
      await app.page.evaluate(proj => { S.projectFilter = proj; closeM(); openIntModal(); },
                              String(row.project_id));
      await app.page.waitForTimeout(150);
      v = await read();
      t.eq(v.hidden, '', 'opening without a contact selects nobody');
      t.eq(v.shown, '', 'and leaves the box empty');
      t.ok(/Anonymous/i.test(v.placeholder || ''),
           'so the anonymous default still shows there');

      // ── changing project still clears the selection ─────────────────────
      // That behaviour is why the pre-selection had to be re-applied rather
      // than the clearing removed: a contact on one project may not be on the
      // next, and a stale id would silently mis-attribute the interaction.
      const other = (await t.sql(
        `select id from pi_projects where id::text <> $1 order by id limit 1`,
        [String(row.project_id)]))[0];
      await app.page.evaluate(([proj, sid, otherId]) => {
        closeM(); S.projectFilter = proj; openIntModal(sid);
        const sel = document.getElementById('f-ip');
        sel.value = otherId; sel.dispatchEvent(new Event('change'));
      }, [String(row.project_id), String(row.stakeholder_id), String(other.id)]);
      await app.page.waitForTimeout(150);
      v = await read();
      t.eq(v.hidden, '', 'switching project drops the pre-selected contact');
      t.eq(v.shown, '', 'and empties the visible box');

      // An id that resolves to nobody must not fake a selection.
      const bogus = await app.page.evaluate(() => {
        closeM(); openIntModal('nonexistent-id-999');
        return { hidden: document.getElementById('f-is').value,
                 shown: document.getElementById('f-is-search').value };
      });
      t.eq(bogus.hidden, '', 'an unknown contact id selects nobody');
      t.eq(bogus.shown, '', 'and shows nothing');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
