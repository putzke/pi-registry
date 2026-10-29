// Stakeholder groups dialogs (Oct 2026, reported live by Jeff):
// - ticking a member in "Manage members" threw the list back to the top;
// - the "New group" dialog kept closing: a drag that started inside the dialog
//   (selecting text in a box) and ended on the dark backdrop counted as a
//   backdrop click and closed it.
module.exports = {
  name: 'group dialogs — member list keeps its scroll; dragging out of a box does not close the dialog',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(async () => {
        const ps = DB.get('project_stakeholders');
        const counts = {};
        ps.forEach(l => { counts[l.projectId] = (counts[l.projectId] || 0) + 1; });
        const projId = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        const ov = document.getElementById('modal-ov');
        const fire = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));

        // New group: a drag from the name box ending on the backdrop.
        showGroupsManager(projId);
        _openGroupEditModal(null);
        const name = document.getElementById('g-name');
        fire(name, 'mousedown'); fire(ov, 'click');          // click lands on the common ancestor
        const openAfterDrag = ov.classList.contains('open') && !!document.getElementById('g-name');
        fire(ov, 'mousedown'); fire(ov, 'click');            // a real backdrop click still closes
        const closedByBackdrop = !ov.classList.contains('open');

        // Manage members: tick a box far down the list.
        showGroupsManager(projId);
        _openGroupEditModal(null);
        document.getElementById('g-name').value = 'Test corridor';
        _saveGroup('');
        const g = DB.get('groups').find(x => x.name === 'Test corridor');
        _openGroupMembersModal(g.id);
        const listOf = () => document.querySelector('#m-body div[onclick*="_toggleGroupMember"]').closest('div[style*="overflow-y:auto"]');
        const list = listOf();
        list.scrollTop = 200;
        const before = list.scrollTop;
        const boxes = list.querySelectorAll('div[onclick*="_toggleGroupMember"]');
        boxes[boxes.length - 1].click();
        const after = listOf().scrollTop;
        const member = (DB.get('group_members') || []).some(m => String(m.groupId) === String(g.id));
        return { rows: counts[projId], openAfterDrag, closedByBackdrop, before, after, member };
      });
      t.ok(r.rows > 12, 'project has enough contacts to scroll (' + r.rows + ')');
      t.ok(r.openAfterDrag, 'dragging from a box onto the backdrop leaves the New group dialog open');
      t.ok(r.closedByBackdrop, 'a click that starts on the backdrop still closes the dialog');
      t.ok(r.before > 0 && r.after === r.before, 'ticking a member keeps the list scroll (' + r.before + ' → ' + r.after + ')');
      t.ok(r.member, 'the member was added');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
