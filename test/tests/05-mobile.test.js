// mobile.html against real seeded data.
//
// Narrow on purpose: mobile is a field logging tool, and the thing worth
// guarding here is that its SB_TO_INT actually resolves against the database.
// It has its own copy of the mapping, separate from index.html, which is how
// raisedBy came to point at a pi_issues.raised_by column that never existed —
// the issue detail screen rendered a "Raised by" row that was always blank
// because fromSB had nothing to read.
module.exports = {
  name: 'mobile — boots and its own SB_TO_INT resolves against real rows',
  async run({ t }) {
    t.seed();
    const app = await t.open('mobile.html', { email: 'putzke@demo.test',
                                              viewport: { width: 414, height: 896 } });
    try {
      await app.page.waitForFunction(
        () => typeof _syncCache !== 'undefined' && Array.isArray(_syncCache.issues),
        null, { timeout: 15000 });

      const data = await app.page.evaluate(() => ({
        projects: _syncCache.projects.length,
        issues: _syncCache.issues.length,
        interactions: _syncCache.interactions.length,
        // Every issue in the seed has created_by set, so after repointing the
        // mapping this must be populated for all of them.
        raisedByFilled: _syncCache.issues.filter(i => !!i.raisedBy).length,
        sampleRaisedBy: (_syncCache.issues[0] || {}).raisedBy,
        dateRaisedFilled: _syncCache.issues.filter(i => !!i.dateRaised).length,
      }));

      t.eq(data.projects, 3, 'mobile loaded every demo project');
      t.eq(data.issues, 8, 'mobile loaded all issues');
      t.gt(data.interactions, 500, 'mobile loaded interactions');
      t.eq(data.raisedByFilled, data.issues, 'raisedBy resolves for every issue');
      t.ok(/^[A-Z]{3}$/.test(data.sampleRaisedBy || ''),
           `raisedBy holds the logger's initials (got ${JSON.stringify(data.sampleRaisedBy)})`);
      t.eq(data.dateRaisedFilled, data.issues, 'dateRaised resolves too');

      // ── follow-up ownership must match the desktop ─────────────────────
      // Mobile is where a field worker checks what is theirs. Its "Mine" filter
      // used to compare logged_by only, so a follow-up a teammate assigned to
      // them on the desktop never reached the phone — precisely the case the
      // assignment feature exists for.
      const assigned = (await t.sql(
        `select id, logged_by from pi_interactions
          where follow_up and not coalesce(follow_up_done,false)
            and follow_up_assigned_to is not null
            and follow_up_assigned_to <> logged_by order by id limit 1`))[0];
      t.ok(assigned, 'seed has a follow-up assigned away from its logger');
      if (assigned) {
        const own = await app.page.evaluate(id => {
          const i = _syncCache.interactions.find(x => String(x.id) === id);
          return { mapped: i.followUpAssignedTo, owner: _fuOwner(i), loggedBy: i.loggedBy };
        }, String(assigned.id));
        t.ok(own.mapped, 'mobile maps follow_up_assigned_to');
        t.eq(own.owner, own.mapped, 'ownership follows the assignee, not the logger');
        t.ok(own.owner !== own.loggedBy, 'and that differs from who logged it');

        // The assignee sees it under "Mine"; the logger no longer does.
        const seen = await app.page.evaluate(id => {
          const i = _syncCache.interactions.find(x => String(x.id) === id);
          const open = _syncCache.interactions.filter(x => x.followUp && !x.followUpDone);
          const mine = who => open.filter(x => _fuOwner(x) === who).map(x => String(x.id));
          return { forAssignee: mine(i.followUpAssignedTo).includes(id),
                   forLogger:   mine(i.loggedBy).includes(id) };
        }, String(assigned.id));
        t.ok(seen.forAssignee, 'the assignee sees it in their list');
        t.eq(seen.forLogger, false, 'the original logger no longer does');
      }

      // Mobile must not silently drop an assignment it never edits.
      const before = (await t.sql(
        'select follow_up_assigned_to a from pi_interactions where id::text=$1',
        [String(assigned.id)]))[0].a;
      await app.page.evaluate(id => {
        const all = DB.get('interactions');
        const n = all.findIndex(x => String(x.id) === id);
        all[n] = { ...all[n], summary: all[n].summary + ' (edited on mobile)' };
        DB.set('interactions', all);
      }, String(assigned.id));
      const kept = await t.until(async () => {
        const r = (await t.sql(
          'select summary, follow_up_assigned_to a from pi_interactions where id::text=$1',
          [String(assigned.id)]))[0];
        return /edited on mobile/.test(r.summary) ? r : null;
      });
      t.ok(kept, 'a mobile edit reached the database');
      t.eq(kept && kept.a, before, 'the edit preserved the assignment');

      // ── parcels: mobile reads them, it does not manage them ─────────────
      // Same rule as follow-up assignment. Letting the phone type a parcel into
      // the contact column would recreate the two-sources-of-truth problem the
      // desktop input was removed to end.
      const parc = await app.page.evaluate(() => ({
        loadsParcels: Array.isArray(_syncCache.parcels),
        loadsOwners: Array.isArray(_syncCache.parcel_owners),
        hasInput: !!document.getElementById('add-parcel'),
        mapsParcels: !!(SB_TO_INT.pi_parcels && SB_TO_INT.pi_parcel_owners),
      }));
      t.ok(parc.loadsParcels && parc.loadsOwners, 'mobile loads both parcel tables');
      t.ok(parc.mapsParcels, 'and maps their columns');
      t.eq(parc.hasInput, false, 'the contact form has no free-text parcel input');

      // An edit must carry the stored parcel reference forward, not blank it —
      // the element is gone, and reading a missing one is how this column wiped
      // itself on the desktop.
      const st = (await t.sql('select id from pi_stakeholders order by id limit 1'))[0];
      await t.sql('update pi_stakeholders set parcel_id=$1 where id=$2',
                  ['13-112-0777', st.id]);
      const carried = await app.page.evaluate(id => {
        window._editStakeId = id;
        // Through _syncCache — DB.get() hands back a copy.
        const cur = _syncCache.stakeholders.find(x => String(x.id) === id);
        if (cur) cur.parcelId = '13-112-0777';
        return _mobExistingParcelId();
      }, String(st.id));
      t.eq(carried, '13-112-0777', 'a mobile edit carries the parcel reference forward');

      t.eq(app.errors, [], 'no page errors on boot');
    } finally {
      await app.close();
    }
  },
};
