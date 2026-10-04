// Importer hardening (Oct 2026), three things:
//   1. A failed read of existing records STOPS the import. sbGet used to turn a
//      401/500 into [], so every row looked new and the import wrote a second
//      copy of contacts and parcels that were already there.
//   2. Parcel numbers are compared without separators (_parcNumKey), so the
//      county's "120470001" — how a UGRC draw-area import stores it — and a
//      spreadsheet's "12-047-0001" are one parcel. Letters are kept.
//   3. An optional "Owner role" column, matched exactly to OWNER_ROLES; blank or
//      unknown falls back to Owner (it was always Owner).
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'importer — failed reads block the import, dash-blind parcel numbers, owner role',
  async run({ t }) {
    t.seed();
    const [proj] = await t.sql(`select id from pi_projects where pid='25-LC-400N'`);
    const P = String(proj.id);
    const owner = (await t.sql(
      `select s.id, s.email from pi_stakeholders s join pi_project_stakeholders l on l.stakeholder_id::text = s.id::text
        where l.project_id::text=$1 and s.email <> '' order by s.id limit 2`, [P]));
    t.eq(owner.length, 2, 'two project contacts to attach as owners');
    await t.sql(`insert into pi_parcels (project_id, parcel_number, status) values ($1,'120470001','Not started'), ($1,'A-12','Not started')`, [P]);

    const csv = [
      'Parcel,Situs Address,Owner Email,Owner Role',
      '12-047-0001,dashed copy of the UGRC-style number,,',
      `B-12,letters keep it distinct from A-12,${owner[0].email},Property manager`,
      `13-112-0009,first,${owner[1].email},Landlord`,
      '13 112 0009,same parcel spaced,,',
    ].join('\n');
    const csvPath = path.join(__dirname, '..', '_parcels64.csv');
    fs.writeFileSync(csvPath, csv);

    const app = await t.open('importer.html', { email: 'putzke@demo.test' });
    const dialogs = [];
    app.page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    try {
      await app.page.waitForFunction(() => typeof parcState !== 'undefined', null, { timeout: 20000 });
      await app.page.evaluate(() => switchImpTab('parcels'));
      await app.page.waitForTimeout(300);
      await app.page.evaluate(id => { document.getElementById('parc-project-select').value = id; updateParcProject(); }, P);
      await app.page.setInputFiles('#parc-file-input', csvPath);
      await app.page.waitForFunction(() => parcState.rawRows.length > 0, null, { timeout: 5000 });
      t.eq(await app.page.evaluate(() => parcState.columnMap[3]), 'ownerRole', '"Owner Role" maps to the role, not the owner name');

      // ── 1. a failed read stops the review step on every tab ──────────────
      const blocked = await app.page.evaluate(async () => {
        const real = window.fetch;
        window.fetch = (u, o) => /\/rest\/v1\/pi_(parcels|stakeholders|project_stakeholders)\?/.test(String(u))
          ? Promise.resolve({ ok: false, status: 401, text: async () => 'JWT expired', json: async () => ({}) })
          : real(u, o);
        ['parcels', 'stakeholders', 'project_stakeholders'].forEach(cacheClear);
        const before = parcState.step;
        await parcGoToStep(3);
        const parc = { stayed: parcState.step === before, parsed: parcState.parsed.length };
        state.rawRows = [['x']];
        await goToStep(3);
        const stake = state.step;
        await intGoToStep(3);
        const ints = intState.step;
        window.fetch = real;
        return { parc, stake, ints, cached: ['parcels', 'stakeholders'].some(k => !!_cache[k]) };
      });
      t.ok(blocked.parc.stayed, 'parcels: a 401 on existing parcels keeps the wizard off the review step');
      t.eq(blocked.parc.parsed, 0, 'and nothing is classified as new');
      t.ok(blocked.stake !== 3, 'stakeholders: the review step is not reached either');
      t.ok(blocked.ints !== 3, 'interactions: nor here');
      t.eq(blocked.cached, false, 'a failed read is never cached as an empty list');
      t.eq(dialogs.length, 3, 'each attempt tells the user');
      t.ok(dialogs.every(m => /Nothing was imported/.test(m) && /401/.test(m)), 'saying nothing was imported, and why');

      // ── 2 + 3. with the read working again ───────────────────────────────
      await app.page.evaluate(() => { state.rawRows = []; });
      await app.page.evaluate(() => parcGoToStep(3));
      await app.page.waitForTimeout(500);
      const review = await app.page.evaluate(() => parcState.parsed.map(r => ({ num: r.parcelNumber, skip: r.skip, reason: r.reason, role: r.ownerRole })));
      t.eq(review[0].skip, true, '"12-047-0001" is recognised as the stored "120470001"');
      t.ok(/already/i.test(review[0].reason), 'and skipped as already on the project');
      t.eq(review[1].skip, false, '"B-12" is NOT mistaken for "A-12" — letters are kept');
      t.eq(review[3].skip, true, '"13 112 0009" duplicates "13-112-0009" earlier in the file');
      t.eq(review[1].role, 'Property manager', 'a listed role is taken');
      t.eq(review[2].role, 'Owner', 'an unknown role ("Landlord") falls back to Owner');

      await app.page.evaluate(() => runParcImport());
      await app.page.waitForFunction(() => parcState.result !== null, null, { timeout: 20000 });
      const nums = (await t.sql(`select parcel_number from pi_parcels where project_id::text=$1 order by 1`, [P])).map(r => r.parcel_number);
      t.eq(nums, ['120470001', '13-112-0009', 'A-12', 'B-12'], 'two new parcels, no duplicates');
      const roles = await t.sql(
        `select p.parcel_number, o.ownership_role from pi_parcel_owners o join pi_parcels p on p.id::text = o.parcel_id::text
          where p.project_id::text=$1 order by 1`, [P]);
      t.eq(roles.map(r => r.parcel_number + ':' + r.ownership_role), ['13-112-0009:Owner', 'B-12:Property manager'], 'owner links carry the role');
      t.eq(app.errors.filter(e => !/SB GET error|Import blocked/.test(e)), [], 'no unexpected page errors');
    } finally {
      fs.unlinkSync(csvPath);
      await app.close();
    }

    // ── the desktop add-parcel check and the shared lists agree ────────────
    const imp = fs.readFileSync(path.join(__dirname, '..', '..', 'importer.html'), 'utf8');
    const idx = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
    const body = src => (src.match(/function _parcNumKey\s*\(\s*v\s*\)\s*\{([^}]*)\}/) || [])[1].replace(/\s+/g, '');
    t.eq(body(idx), body(imp), 'index.html and importer.html use the same _parcNumKey');
    t.ok(/_parcNumKey\(p\.parcelNumber\)===_parcNumKey\(num\)/.test(idx), 'desktop saveParcel compares with it');
    const list = (src, name) => (src.match(new RegExp('const ' + name + '\\s*=\\s*(\\[[^\\]]*\\])')) || [])[1];
    t.eq(JSON.parse(list(imp, 'OWNER_ROLES_IMP').replace(/'/g, '"')), JSON.parse(list(idx, 'OWNER_ROLES').replace(/'/g, '"')),
      "the importer's owner roles match the desktop's OWNER_ROLES");
  },
};
