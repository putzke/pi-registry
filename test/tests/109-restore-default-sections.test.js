// The default manual sections ("Recent PI action items", "Planned PI
// activities") could not be added back once removed (Jeff, Oct 2026).
module.exports = {
  name: 'report editor — removed default manual sections can be added back',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(() => {
        const ids = getAvailableSections().map(s => s.id);
        const kinds = getAvailableSections().filter(s => s.id === 'actions' || s.id === 'planned').map(s => s.type);
        return { ids, kinds, defaults: getDefaultSections().map(s => s.id) };
      });
      r.defaults.forEach(id => t.ok(r.ids.includes(id), 'default section "' + id + '" is offered under Add sections'));
      t.eq(r.kinds, ['manual', 'manual'], 'they come back as manual sections');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
