// Settings → Project hotlines: the hotline list comes first, the settings
// for every hotline (ring defaults, voicemail prompt) after it (Jeff, Nov 2026).
module.exports = {
  name: 'hotline settings — the list first, then the settings for every hotline',
  async run({ t }) {
    t.seed();
    await t.sql(`insert into pi_hotlines (name, phone_number) values ('Order Test','+18015550199')`);
    const app = await t.open('index.html');
    const r = await app.page.evaluate(async () => {
      await _refreshData(['hotlines']).catch(() => {});
      setView('settings'); renderHotlineCard();
      const body = document.getElementById('hotline-card-body');
      const pos = sel => { const e = body.querySelector(sel); return e ? [...body.querySelectorAll('*')].indexOf(e) : -1; };
      return { list: pos('#hot-list'), table: pos('#hot-list table'), add: pos('#hot-list button'), defaults: pos('#hot-defaults'),
        all: pos('#hot-all-settings'), text: body.innerText };
    });
    t.ok(r.list >= 0 && r.table > r.list, 'the hotline table sits in the list block');
    t.ok(r.add > r.table, '+ Add hotline sits right under the list');
    t.ok(r.defaults > r.add && r.all > r.add, 'the ring defaults come after the list');
    t.ok(/Order Test/.test(r.text) && /Settings for every hotline/i.test(r.text), 'the hotline shows and the settings are headed');
    t.ok(r.text.indexOf('Order Test') < r.text.indexOf('Voicemail prompt'), 'the voicemail prompt comes after the list');
    await app.close();
  },
};
