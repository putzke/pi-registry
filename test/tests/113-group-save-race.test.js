// Stakeholder groups (Nov 2026, reported live by Jeff): a second group could be
// saved with the same name as the first, and clicking Edit on a group just
// saved threw "Cannot read properties of undefined (reading 'color')" — the
// list was drawn with the group's temporary id, which stopped matching once
// the insert landed.
module.exports = {
  name: 'groups — buttons carry the real id after a save; duplicate names refused',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(async () => {
        const projId = String(DB.get('projects')[0].id);
        const alerts = []; window.alert = m => alerts.push(m);
        showGroupsManager(projId);
        _openGroupEditModal(null);
        document.getElementById('g-name').value = 'North property owners';
        await _saveGroup('');
        const btn = document.querySelector('#m-body button[onclick*="_openGroupEditModal(\'"]');
        const btnId = btn ? btn.getAttribute('onclick').match(/'([^']*)'/)[1] : '';
        let threw = null;
        try { btn.click(); } catch (e) { threw = e.message; }
        const editOpen = !!document.getElementById('g-name') && document.getElementById('g-name').value === 'North property owners';
        // A second group with the same name, different case and spacing.
        showGroupsManager(projId);
        _openGroupEditModal(null);
        document.getElementById('g-name').value = '  north  PROPERTY owners ';
        await _saveGroup('');
        const sameName = DB.get('groups').filter(g => String(g.projectId) === projId && /north\s+property owners/i.test(g.name)).length;
        // A stale id opens nothing and throws nothing.
        let threwStale = null;
        try { _openGroupEditModal('tmp_gone'); } catch (e) { threwStale = e.message; }
        return { btnId, threw, editOpen, alerts, sameName, threwStale };
      });
      t.ok(/^\d+$/.test(r.btnId), 'Edit button carries the real database id (' + r.btnId + ')');
      t.eq(r.threw, null, 'Edit on a just-saved group does not throw');
      t.ok(r.editOpen, 'Edit opens the group just saved');
      t.eq(r.sameName, 1, 'a second group with the same name is not saved');
      t.ok(r.alerts.some(a => /already has a group called/.test(a)), 'the user is told why');
      t.eq(r.threwStale, null, 'an id the cache no longer has redraws the list instead of throwing');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
