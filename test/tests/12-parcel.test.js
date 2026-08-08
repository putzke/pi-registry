// pi_stakeholders.parcel_id — the field a ROW campaign is tracked by.
//
// The column exists and mobile and the importer both write it, but index.html
// had no input for it: saveStake() read v('f-parc') and no element with that id
// existed, so v() returned '' and EVERY desktop save silently blanked whatever
// parcel id was there. Import a few dozen parcel numbers, edit one of those
// contacts on the desktop, and that number is gone with no warning.
module.exports = {
  name: 'stakeholders — parcel ID survives a desktop edit and is searchable',
  async run({ t }) {
    t.seed();

    // Give a stakeholder a parcel id the way the importer would, before the app
    // boots — sbGet() serves from its own cache, so writing it afterwards and
    // re-running loadAllData() would just return the stale copy.
    const target = (await t.sql(
      `select id, first_name, last_name from pi_stakeholders order by id limit 1`))[0];
    await t.sql('update pi_stakeholders set parcel_id=$1 where id=$2',
                ['13-112-0002', target.id]);

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const loaded = await app.page.evaluate(id =>
        (DB.get('stakeholders').find(s => String(s.id) === id) || {}).parcelId, String(target.id));
      t.eq(loaded, '13-112-0002', 'the parcel id loads into the cache');

      // ── the modal no longer offers an editable field ────────────────────
      // pi_parcels is the record now, and one text box on the contact can only
      // ever be wrong for an owner holding several parcels. Two places to record
      // the same fact diverge.
      const hasInput = await app.page.evaluate(async id => {
        await openStakeModal(id);
        return !!document.getElementById('f-parc');
      }, String(target.id));
      t.eq(hasInput, false, 'the stakeholder modal has no parcel input');

      // ── but a save must not blank the column ────────────────────────────
      // Reading a missing element yields '', which is exactly how this field
      // silently wiped itself before. The value has to be carried forward.
      await app.page.evaluate(() => { saveStake(); });
      await app.page.waitForTimeout(1400);
      let row = (await t.sql('select parcel_id p from pi_stakeholders where id=$1',
                             [target.id]))[0];
      t.eq(row.p, '13-112-0002', 'saving a contact preserves its imported parcel id');

      // It still displays, labelled as the reference value it now is.
      const pane = await app.page.evaluate(id => {
        closeM();
        setView('master');
        selectStake(id);
        renderMaster(document.getElementById('main'));
        return document.getElementById('main').innerHTML;
      }, String(target.id));
      t.ok(/13-112-0002/.test(pane), 'the detail pane still shows it');
      t.ok(/imported reference/i.test(pane), 'and marks it as a reference, not the record');

      // ── searchable, so a campaign can be worked by parcel ────────────────
      const found = await app.page.evaluate(() => {
        setView('master');
        S.masterSearch = '13-112-0002';
        renderMaster(document.getElementById('main'));
        const stakes = DB.getActive('stakeholders');
        const q = S.masterSearch.toLowerCase();
        return stakes.filter(s => (s.firstName + ' ' + s.lastName + ' ' + (s.org || '')
          + ' ' + (s.parcelId || '')).toLowerCase().includes(q)).length;
      });
      t.eq(found, 1, 'the master list search matches on parcel id');

      const placeholders = await app.page.evaluate(() =>
        [...document.querySelectorAll('input[placeholder]')]
          .map(i => i.placeholder).filter(p => /parcel/i.test(p)).length);
      t.gt(placeholders, 0, 'the search box says parcel is searchable');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
