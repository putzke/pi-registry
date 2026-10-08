// Mobile's home screen read 66 Contacts on 3600 West Reconstruction where the
// desktop Contact list read 65. Cause, found in production: one project link
// whose stakeholder_id was 'tmp_mrspoajt7fh' — a temporary local id that never
// became a real contact. Mobile counted link ROWS; the desktop counts links
// whose contact exists. And the way it got there was mobile's own
// "new contact" paths: when the contact insert failed, sbAdd returned null,
// the tmp_ id stayed, and the project link was written with it anyway.
//
// Also guarded: both paths used to hand DB.set an ACTIVE-only contact array,
// and DB._sync deletes any stored row missing from the array it is handed —
// so an archived contact would have been deleted by adding a new one.
module.exports = {
  name: 'mobile — contact count matches the desktop, and a failed contact save links nothing',
  async run({ t }) {
    t.seed();
    const [proj] = await t.sql(`select id from pi_projects where pid='25-LC-400N'`);
    const P = String(proj.id);
    // The production shape: a link to a contact that does not exist.
    await t.sql(`insert into pi_project_stakeholders (project_id, stakeholder_id, stakeholder_role)
                 values ($1, 'tmp_mrspoajt7fh', 'External')`, [P]);
    // An archived contact, to prove a mobile save no longer deletes it.
    const [arch] = await t.sql(`insert into pi_stakeholders (first_name, last_name, is_master, is_archived)
                                values ('Archie','Ved', true, true) returning id`);

    const linkRows = (await t.sql(`select count(*)::int n from pi_project_stakeholders where project_id::text=$1`, [P]))[0].n;
    const realContacts = (await t.sql(
      `select count(*)::int n from pi_project_stakeholders ps join pi_stakeholders s on s.id::text=ps.stakeholder_id
        where ps.project_id::text=$1 and not coalesce(s.is_archived,false)`, [P]))[0].n;
    t.eq(linkRows, realContacts + 1, 'fixture: one more link row than real contacts');

    const desk = await t.open('index.html', { email: 'putzke@demo.test' });
    let deskCount;
    try {
      await desk.ready();
      deskCount = await desk.page.evaluate(pid => {
        S.view = 'stakeholders'; S.projectFilter = pid; S.skView = 'list'; render();
        const ct = [...document.querySelectorAll('.vtab')].find(b => /Contact list/.test(b.textContent));
        return parseInt(ct.querySelector('.vtab-ct').textContent, 10);
      }, P);
      t.eq(deskCount, realContacts, 'desktop Contact list counts real contacts');
    } finally { await desk.close(); }

    const mob = await t.open('mobile.html', { email: 'putzke@demo.test', viewport: { width: 414, height: 896 } });
    try {
      await mob.page.waitForFunction(() => typeof _syncCache !== 'undefined' && (_syncCache.project_stakeholders || []).length > 0, null, { timeout: 15000 });
      const mobCount = await mob.page.evaluate(pid => {
        const sel = document.getElementById('home-proj');
        if (![...sel.options].some(o => o.value === pid)) sel.add(new Option('p', pid));
        sel.value = pid; refreshHome();
        return parseInt(document.querySelector('#home-stats .stat-val').textContent, 10);
      }, P);
      t.eq(mobCount, deskCount, 'mobile home Contacts matches the desktop (was one higher)');

      // ── a contact save that fails must not write a link with a tmp_ id ──
      const before = (await t.sql(`select count(*)::int n from pi_project_stakeholders where stakeholder_id like 'tmp\\_%'`))[0].n;
      const res = await mob.page.evaluate(async pid => {
        const realAdd = sbAdd;
        let tried = 0;
        window.sbAdd = async (table, obj) => { if (table === 'stakeholders') { tried++; return null; } return realAdd(table, obj); };
        try {
          prepAddStakeholderSheet && prepAddStakeholderSheet();
          document.getElementById('add-fn').value = 'Failing';
          document.getElementById('add-ln').value = 'Save';
          document.getElementById('add-email').value = 'failing.save@example.com';
          const ps = document.getElementById('add-proj');
          if (![...ps.options].some(o => o.value === pid)) ps.add(new Option('p', pid));
          ps.value = pid;
          await saveStakeholder();
          await new Promise(r => setTimeout(r, 500));
          return { tried, tmpInCache: (_syncCache.stakeholders || []).some(s => String(s.id).startsWith('tmp_')),
                   tmpLinkInCache: (_syncCache.project_stakeholders || []).some(x => String(x.stakeholderId).startsWith('tmp_') && x.stakeholderId !== 'tmp_mrspoajt7fh') };
        } finally { window.sbAdd = realAdd; }
      }, P);
      const after = (await t.sql(`select count(*)::int n from pi_project_stakeholders where stakeholder_id like 'tmp\\_%'`))[0].n;
      t.eq(res.tried, 1, 'the failing save really reached the contact insert');
      t.eq(after, before, 'a failed contact save writes no tmp_ project link');
      t.eq(res.tmpLinkInCache, false, 'and none in the cache either');
      t.eq(res.tmpInCache, false, 'the unsaved contact is dropped from the cache');

      // ── a successful save still links the REAL id, and keeps archived rows ──
      await mob.page.evaluate(async pid => {
        document.getElementById('add-fn').value = 'Working';
        document.getElementById('add-ln').value = 'Save';
        document.getElementById('add-email').value = 'working.save@example.com';
        document.getElementById('add-proj').value = pid;
        await saveStakeholder();
      }, P);
      const link = await t.until(async () => (await t.sql(
        `select ps.stakeholder_id from pi_project_stakeholders ps join pi_stakeholders s on s.id::text=ps.stakeholder_id
          where s.email='working.save@example.com' and ps.project_id::text=$1`, [P]))[0]);
      t.ok(link && /^\d+$/.test(link.stakeholder_id), 'a successful save links the real numeric id');
      const still = (await t.sql(`select count(*)::int n from pi_stakeholders where id=$1`, [arch.id]))[0].n;
      t.eq(still, 1, 'an archived contact survives a mobile contact save');
      // ── the email check on mobile ───────────────────────────────────────
      const em = await mob.page.evaluate(() => ['jeff@sunrise.com','jsmith@udot.utah.gov','bad@nodot','two words@x.com']
        .map(e => validateEmail(e) === null));
      t.eq(em, [true, true, false, false], 'mobile accepts addresses with an "s" and still rejects bad ones');
      t.eq(mob.errors, [], 'no page errors on mobile');
    } finally { await mob.close(); }
  },
};
