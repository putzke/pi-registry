// Mobile contacts in walking order (Nov 2026, Jeff): a project's contact list
// follows the street, read from the Utah grid address, and one tap reverses
// it for the second walker. The street part of the address shows large;
// names sort with numbers in order (Property 2 before Property 10).
module.exports = {
  name: 'mobile contacts — address (walking) order, reverse, street-only address; numeric name sort',
  async run({ t }) {
    t.seed();
    const P = String((await t.sql(`select id from pi_projects where pid='25-154-001'`))[0].id);
    const mob = await t.open('mobile.html', { email: 'putzke@demo.test', viewport: { width: 414, height: 896 } });
    try {
      await mob.page.waitForFunction(() => typeof _syncCache !== 'undefined' && (_syncCache.project_stakeholders || []).length > 0, null, { timeout: 15000 });
      const r = await mob.page.evaluate(pid => {
        const mk = (id, last, addr) => ({ id, firstName: 'Property', lastName: last, address: addr, needsReview: true });
        const fake = [
          mk('w1', '1', '33 S 300 W, Heber City, 84032'),
          mk('w2', '10', '287 W 200 N, Heber City, 84032'),
          mk('w3', '12', '240 N 300 W, Heber City, 84032'),
          mk('w4', '16', '354 North 300 West, Heber City, 84032'),
          mk('w5', '20', '460 N 300 W, Heber City, 84032'),
          mk('w6', '2', 'Heber Valley Elementary'),
        ];
        _syncCache.stakeholders = fake;
        _syncCache.project_stakeholders = fake.map((s, i) => ({ id: 'l' + i, projectId: pid, stakeholderId: s.id }));
        try { localStorage.removeItem('cc_addr_rev_' + pid); } catch (e) {}
        const sel = document.getElementById('contacts-proj');
        if (![...sel.options].some(o => o.value === pid)) sel.add(new Option('p', pid));
        sel.value = pid; document.getElementById('contacts-search').value = '';
        renderContacts();
        const order = () => [...document.querySelectorAll('#contacts-list .list-item .item-name')].map(e => e.textContent.trim());
        const first = order();
        const cap1 = document.getElementById('contacts-caption').textContent;
        const addrs = [...document.querySelectorAll('#contacts-list .item-addr')].map(e => e.textContent.trim());
        document.getElementById('addr-order').click();
        const rev = order();
        const cap2 = document.getElementById('contacts-caption').textContent;
        // Master list: names sort with numbers in order.
        sel.value = '';
        _syncCache.stakeholders = fake.map(s => ({ ...s, isMaster: true }));
        renderContacts();
        const master = order();
        return { first, cap1, addrs, rev, cap2, master, grid: [_gridPos('287 W 200 N'), _gridPos('Main St')] };
      }, P);
      t.eq(r.first.join(','), 'Property 20,Property 16,Property 12,Property 10,Property 1,Property 2', 'north to south by grid address; no grid address last');
      t.ok(/Address order: North → South/.test(r.cap1), 'caption names the order');
      t.eq(r.addrs.slice(0, 2).join('|'), '460 N 300 W|354 North 300 West', 'street part only, no city or zip');
      t.eq(r.rev.join(','), 'Property 1,Property 10,Property 12,Property 16,Property 20,Property 2', 'one tap reverses (south to north); unplaced still last');
      t.ok(/South → North/.test(r.cap2), 'caption follows the reverse');
      t.eq(r.master.join(','), 'Property 1,Property 2,Property 10,Property 12,Property 16,Property 20', 'names sort with numbers in order');
      t.eq(JSON.stringify(r.grid), '[{"x":-287,"y":200},null]', 'grid reading: corner lot placed at its cross street; non-grid not placed');
      t.eq(mob.errors, [], 'no page errors');
    } finally { await mob.close(); }
  },
};
