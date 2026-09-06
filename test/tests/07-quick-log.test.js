// The quick-log grid, driven the way a user drives it: type into the real
// inputs, click the real save button, then check Postgres.
//
// Two things here are worth guarding specifically. Anonymous rows get their
// label from getAnonLabel(), which counts what is already STORED — so a naive
// implementation hands every anonymous row in one batch the same label. And the
// stakeholder picker must only ever offer contacts already linked to the
// project; the moment it offers anything else, the grid has quietly become a
// contact-creation surface, which is exactly what the locked scope forbids.
module.exports = {
  name: 'quick log — multi-row interaction entry writes through correctly',
  async run({ t, shim }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(
        `select id, name from pi_projects where pid = '25-154-001'`))[0];
      t.ok(proj, 'demo project found');
      const projId = String(proj.id);

      const before = Number((await t.sql(
        'select count(*) c from pi_interactions where project_id::text=$1', [projId]))[0].c);

      // ── the grid only opens with a project selected ──────────────────────
      const noProj = await app.page.evaluate(() => {
        S.projectFilter = null;
        openQuickLog();
        return !!S.showQuickLog;
      });
      t.eq(noProj, false, 'quick log refuses to open with no project selected');

      await app.page.evaluate(id => { S.projectFilter = id; setView('interactions'); }, projId);
      await app.page.waitForTimeout(100);
      t.ok(await app.page.$('button[onclick="openQuickLog()"]'),
           'Quick log button shows on the interactions view');

      await app.page.evaluate(() => openQuickLog());
      await app.page.waitForSelector('#ql-body tr', { timeout: 5000 });
      t.eq(await app.page.$$eval('#ql-body tr', r => r.length), 12, 'grid opens with 12 rows');

      // The copy-down arrows propagate a changed value downward, so the last
      // row's six arrows would copy to nothing. They are hidden, and "+ Add
      // rows" has to give them back to the row that is no longer last.
      const arrows = await app.page.evaluate(() => {
        const vis = i => [...document.getElementById('qlrow' + i).querySelectorAll('.ql-dn')]
          .filter(a => a.style.display !== 'none').length;
        return { first: vis(0), last: vis(11) };
      });
      t.eq(arrows.first, 6, 'row 1 offers copy-down on all six defaulted columns');
      t.eq(arrows.last, 0, 'the last row has no copy-down arrows');

      await app.page.evaluate(() => qlAddMoreRows());
      const grown = await app.page.evaluate(() => {
        const vis = i => [...document.getElementById('qlrow' + i).querySelectorAll('.ql-dn')]
          .filter(a => a.style.display !== 'none').length;
        return { rows: document.querySelectorAll('#ql-body tr').length,
                 wasLast: vis(11), nowLast: vis(21) };
      });
      t.eq(grown.rows, 22, '+ Add rows appended 10 more');
      t.eq(grown.wasLast, 6, 'the previously-last row got its arrows back');
      t.eq(grown.nowLast, 0, 'and the new last row has none');

      // ── Direction defaults to Outgoing; Subject/Nature are now real
      // per-row columns defaulting to General/Inquiry ─────────────────────
      const defaults = await app.page.evaluate(() => ({
        direction: document.getElementById('qldr0').value,
        subject: document.getElementById('qlsub0').value,
        nature: document.getElementById('qlnat0').value,
        natureHasNotification: [...document.getElementById('qlnat0').options].some(o => o.value === 'Notification'),
      }));
      t.eq(defaults.direction, 'Outgoing', 'direction defaults to Outgoing — bulk initial outreach is the common case');
      t.eq(defaults.subject, 'General', 'subject defaults to General');
      t.eq(defaults.nature, 'Inquiry', 'nature defaults to Inquiry');
      t.ok(defaults.natureHasNotification, 'Nature offers Notification, for bulk outreach batches');

      // ⇩ on Nature should propagate to every row below, same as the other
      // defaulted columns. Uses rows 15/18 (unused by the fill/save flow
      // below, which relies on rows 0-4) so this doesn't disturb the
      // 'Inquiry' default those later assertions check.
      const natureCopy = await app.page.evaluate(() => {
        document.getElementById('qlnat15').value = 'Notification';
        qlApplyDown('qlnat', 15);
        return document.getElementById('qlnat18').value;
      });
      t.eq(natureCopy, 'Notification', 'copy-down works on the new Nature column');

      // ── the picker is confined to contacts already on the project ────────
      const picker = await app.page.evaluate(id => {
        const inp = document.getElementById('qls0');
        inp.value = '';
        qlStakeInput(inp, 0);
        const dd = document.getElementById('ql-stake-dropdown');
        const offered = [...dd.querySelectorAll('div[onclick^="qlPickStake"]')]
          .map(d => (d.getAttribute('onclick').match(/qlPickStake\(0,'([^']*)'/) || [])[1])
          .filter(Boolean);
        const linked = new Set(DB.get('project_stakeholders')
          .filter(x => x.projectId === id).map(x => String(x.stakeholderId)));
        return {
          offered: offered.length,
          allLinked: offered.every(sid => linked.has(String(sid))),
          linkedTotal: linked.size,
          // Nothing in the list may create or link a contact.
          creates: /intShowNewContactForm|intAddMasterToProject/.test(dd.innerHTML),
          anonOption: /— Anonymous —/.test(dd.innerHTML),
        };
      }, projId);
      t.gt(picker.offered, 0, 'picker offers contacts');
      t.ok(picker.allLinked, 'every contact offered is already linked to the project');
      t.eq(picker.creates, false, 'picker offers no contact creation or master-list linking');
      t.ok(picker.anonOption, 'picker offers an anonymous option');

      // Searching a name that exists only on another project must find nothing.
      const foreign = await app.page.evaluate(() => {
        const linked = new Set(DB.get('project_stakeholders')
          .filter(x => x.projectId === S.projectFilter).map(x => String(x.stakeholderId)));
        const other = DB.getActive('stakeholders').find(s => !linked.has(String(s.id)));
        if (!other) return null;
        const inp = document.getElementById('qls0');
        inp.value = dispName(other);
        qlStakeInput(inp, 0);
        const dd = document.getElementById('ql-stake-dropdown');
        return { name: dispName(other),
                 hits: dd.querySelectorAll('div[onclick^="qlPickStake"]').length };
      });
      t.ok(foreign, 'found a stakeholder not on this project');
      // 1 = the anonymous row only.
      t.eq(foreign && foreign.hits, 1, 'a contact from another project is not offered');

      // ── fill three rows: two named, two anonymous ───────────────────────
      const filled = await app.page.evaluate(() => {
        const set = (id, v) => { document.getElementById(id).value = v; };
        const picks = [...document.getElementById('ql-stake-dropdown')
          .querySelectorAll('div[onclick^="qlPickStake"]')];
        // Row 0 + row 1 get real contacts, rows 2 + 3 stay anonymous.
        const inp = document.getElementById('qls0'); inp.value = ''; qlStakeInput(inp, 0);
        const opts = [...document.getElementById('ql-stake-dropdown')
          .querySelectorAll('div[onclick^="qlPickStake"]')]
          .map(d => d.getAttribute('onclick').match(/qlPickStake\(0,'([^']*)','([^']*)'/))
          .filter(m => m && m[1]);
        qlPickStake(0, opts[0][1], opts[0][2]);
        qlPickStake(1, opts[1][1], opts[1][2]);

        set('qld0', '2026-03-02'); set('qlc0', 'Phone');  set('qldr0', 'Incoming');
        set('qlsu0', 'Resident called about night paving noise.');
        set('qld1', '2026-03-03'); set('qlc1', 'Email');  set('qldr1', 'Outgoing');
        set('qlsu1', 'Sent detour exhibit for review.'); set('qlby1', 'sha');
        set('qld2', '2026-03-04'); set('qlc2', 'Phone');
        set('qlsu2', 'Anonymous caller asked about driveway access.');
        set('qld3', '2026-03-04'); set('qlc3', 'Comment card');
        set('qlsu3', 'Comment card left at the open house.');
        _qlUpdateFooter();
        return { stake0: opts[0][1], stake1: opts[1][1],
                 footer: document.getElementById('ql-footer-info').textContent,
                 btn: document.getElementById('ql-save-btn').textContent };
      });
      t.ok(/^4 of 22/.test(filled.footer), `footer counts filled rows (${filled.footer})`);
      t.eq(filled.btn, 'Save 4 interactions', 'save button names the batch size');

      // ── a row missing its summary blocks the whole batch ─────────────────
      const blocked = await app.page.evaluate(() => {
        document.getElementById('qlsu4').value = '   ';
        const inp = document.getElementById('qls4'); inp.value = ''; qlStakeInput(inp, 4);
        const o = [...document.getElementById('ql-stake-dropdown')
          .querySelectorAll('div[onclick^="qlPickStake"]')]
          .map(d => d.getAttribute('onclick').match(/qlPickStake\(4,'([^']*)','([^']*)'/))
          .filter(m => m && m[1])[0];
        qlPickStake(4, o[1], o[2]);
        saveQuickLog();
        return { marked: document.getElementById('qlsu4').style.borderColor,
                 stillOpen: S.showQuickLog };
      });
      t.ok(/red/.test(blocked.marked), 'the offending row is flagged');
      t.ok(blocked.stillOpen, 'nothing is saved while a row is incomplete');
      const midway = Number((await t.sql(
        'select count(*) c from pi_interactions where project_id::text=$1', [projId]))[0].c);
      t.eq(midway, before, 'a blocked batch wrote nothing at all');

      // ── clear the bad row and save for real ─────────────────────────────
      await app.page.evaluate(() => { qlClearRow(4); saveQuickLog(); });
      await app.page.waitForFunction(() => S.showQuickLog === false, null, { timeout: 5000 });

      // Match on the summaries rather than the date window — the seed already
      // has interactions in early March for this project.
      const fetchRows = () => t.sql(
        `select summary, channel, direction, subject, nature, logged_by, anon_label,
                stakeholder_id, interaction_date, follow_up
           from pi_interactions
          where project_id::text=$1
            and summary in ('Resident called about night paving noise.',
                            'Sent detour exhibit for review.',
                            'Anonymous caller asked about driveway access.',
                            'Comment card left at the open house.')
          order by interaction_date, summary`, [projId]);
      const rows = (await t.until(async () => {
        const r = await fetchRows();
        return r.length === 4 ? r : null;
      })) || await fetchRows();
      t.eq(rows.length, 4, 'all four rows landed in the database');

      const after = Number((await t.sql(
        'select count(*) c from pi_interactions where project_id::text=$1', [projId]))[0].c);
      t.eq(after, before + 4, 'exactly four interactions were added');

      const byNoise = rows.find(r => /night paving/.test(r.summary));
      t.ok(byNoise, 'the first row saved');
      if (byNoise) {
        t.eq(byNoise.channel, 'Phone', 'channel persisted');
        t.eq(byNoise.direction, 'Incoming', 'direction persisted');
        t.eq(byNoise.subject, 'General', 'subject defaults the way saveInt() defaults it');
        t.eq(byNoise.nature, 'Inquiry', 'nature defaults the way saveInt() defaults it');
        t.eq(byNoise.logged_by, 'PUT', 'logged_by falls back to the signed-in user');
        t.eq(byNoise.follow_up, false, 'no follow-up is created');
        t.eq(String(byNoise.stakeholder_id), String(filled.stake0), 'linked to the chosen contact');
      }

      const byEmail = rows.find(r => /detour exhibit/.test(r.summary));
      t.eq(byEmail && byEmail.logged_by, 'SHA', 'a per-row logged-by override is upper-cased and kept');

      // The label bug this test exists for.
      const anon = rows.filter(r => !r.stakeholder_id).map(r => r.anon_label);
      t.eq(anon.length, 2, 'both anonymous rows saved without a stakeholder');
      t.eq(new Set(anon).size, 2, `anonymous rows got distinct labels (${anon.join(', ')})`);
      t.ok(anon.every(l => /^Anonymous( \d+)?$/.test(l || '')),
           'anonymous labels follow the app format');

      // Nothing may be quietly linked into the project by a quick log.
      const links = Number((await t.sql(
        'select count(*) c from pi_project_stakeholders where project_id::text=$1', [projId]))[0].c);
      t.eq(links, picker.linkedTotal, 'quick log added no project_stakeholders rows');

      const posted = shim.calls.filter(c => c.method === 'POST'
        && /pi_interactions/.test(c.url) && c.status < 400).length;
      t.gt(posted, 0, 'the rows went through real POSTs, not just the local cache');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
