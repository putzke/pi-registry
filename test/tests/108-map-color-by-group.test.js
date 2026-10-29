// Map view: "Color markers by → Group" (Oct 2026, Jeff). A contact's numbered
// marker takes its group's colour on the project; no group = grey; in several
// groups the first in the project's order wins (as the contact list's bar).
module.exports = {
  name: 'map view — color markers by group',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(async () => {
        const ps = DB.get('project_stakeholders');
        const projId = ps[0].projectId;
        const links = ps.filter(l => String(l.projectId) === String(projId)).slice(0, 3);
        const stakes = links.map(l => DB.get('stakeholders').find(s => String(s.id) === String(l.stakeholderId)));
        _syncCache.groups = (DB.get('groups') || []).concat([
          { id: 'ga', projectId: projId, name: 'North block', color: '#7986cb', sortOrder: 0 },
          { id: 'gb', projectId: projId, name: 'South block', color: '#ef9f27', sortOrder: 1 },
        ]);
        _syncCache.group_members = (DB.get('group_members') || []).concat([
          { id: 'm1', groupId: 'ga', stakeholderId: stakes[0].id },
          { id: 'm2', groupId: 'gb', stakeholderId: stakes[1].id },
          { id: 'm3', groupId: 'ga', stakeholderId: stakes[1].id },
        ]);
        S.projectFilter = projId;
        const col = i => _mvMarkerColor({ s: stakes[i], lk: links[i] }, 'group');
        S.view = 'map'; S.mapColorBy = 'group'; render();
        const opt = !!document.querySelector('#mv-colorby option[value="group"]');
        const legend = _mapLegendContactsHtml('group');
        S.projectFilter = '';
        const legendAll = _mapLegendContactsHtml('group');
        return { c0: col(0), c1: col(1), c2: col(2), opt, legend, legendAll };
      });
      t.eq(r.c0, '#7986cb', 'a member takes its group colour');
      t.eq(r.c1, '#7986cb', 'in two groups, the first in the project order wins');
      t.eq(r.c2, '#888888', 'no group = grey');
      t.ok(r.opt, 'the Map view offers "Group" under Color markers by');
      t.ok(/North block/.test(r.legend) && /South block/.test(r.legend) && /No group/.test(r.legend), 'legend lists the groups and No group');
      t.ok(/Pick a project/.test(r.legendAll), 'without a project the legend says to pick one');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
