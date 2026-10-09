// Step 4 + 5 of the project-lead work (Oct 2026).
//
//  4a. A new follow-up defaults to the project's PI Lead (visible, overridable).
//  4b. A new close-out's signature defaults to the PI Lead.
//  4c. The client portal shows the lead as "Your PI contact" through
//      pi_portal_contact() — staff-only data, so the function is the only door,
//      and it opens only for a caller who can already see that project.
//  5.  The Team view: projects led, follow-ups owned, stale status reports.
module.exports = {
  name: 'project lead as default + portal contact + Team view',
  async run({ t, db }) {
    // ── 4c, the database side, role-switched (the shim runs as postgres) ──
    const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    const c = await db.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into pi_projects (id, name, lead) overriding system value values (911,'A','LDA'), (912,'B','LDB'), (913,'C', null)`);
      await c.query(`insert into pi_team_members (name, initials, title, phone, email) values
        ('Lead A','LDA','PI Coordinator','801-555-0101','a@firm.example'), ('Lead B','LDB','PI Manager','801-555-0102','b@firm.example')`);
      await c.query(`insert into pi_portal_links (token, project_id) values ($1, 911), ($2, 912)`, [A, B]);
      await c.query(`insert into pi_client_access (email, project_id) values ('client@agency.example', 911)`);
      const as = async (role, headers, claims, proj) => {
        await c.query(`set role ${role}`);
        await c.query(`select set_config('request.headers', $1, true), set_config('request.jwt.claims', $2, true)`, [headers, claims]);
        const r = (await c.query(`select * from pi_portal_contact($1)`, [proj])).rows;
        await c.query('reset role');
        return r.map(x => x.name);
      };
      t.eq(await as('anon', JSON.stringify({ 'x-portal-token': A }), '', 911), ['Lead A'], 'a token link sees its own project\'s lead');
      const full = (await (async () => { await c.query('set role anon'); await c.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-portal-token': A })]); const r = (await c.query('select * from pi_portal_contact(911)')).rows[0]; await c.query('reset role'); return r; })());
      t.eq(full, { name: 'Lead A', title: 'PI Coordinator', phone: '801-555-0101', email: 'a@firm.example' }, '…exactly four fields: name, title, phone, email');
      t.eq(await as('anon', JSON.stringify({ 'x-portal-token': A }), '', 912), [], 'not another project\'s lead with the same token');
      t.eq(await as('anon', '{}', '', 911), [], 'no token: nothing');
      t.eq(await as('authenticated', '{}', JSON.stringify({ email: 'client@agency.example' }), 911), ['Lead A'], 'a signed-in client sees the lead of a project granted to them');
      t.eq(await as('authenticated', '{}', JSON.stringify({ email: 'client@agency.example' }), 912), [], '…and not of one that is not');
      t.eq(await as('authenticated', '{}', JSON.stringify({ email: 'stranger@x.example' }), 911), [], 'a stranger\'s session: nothing');
      t.eq(await as('anon', JSON.stringify({ 'x-portal-token': A }), '', 913), [], 'a project with no lead: nothing');
      await c.query(`update pi_team_members set show_on_portal = false where initials='LDA'`);
      t.eq(await as('anon', JSON.stringify({ 'x-portal-token': A }), '', 911), [], 'a lead kept off the portal: nothing');
      await c.query(`update pi_team_members set show_on_portal = true, active = false where initials='LDA'`);
      t.eq(await as('anon', JSON.stringify({ 'x-portal-token': A }), '', 911), [], 'an inactive lead: nothing');
      await c.query('set role anon');
      let denied = false; try { await c.query('savepoint s'); await c.query('select * from pi_team_members'); } catch (e) { denied = true; await c.query('rollback to savepoint s'); }
      await c.query('reset role');
      t.ok(denied, 'the team table itself stays closed to anon');
    } finally { await c.query('rollback').catch(() => {}); c.release(); }

    // ── the app ──────────────────────────────────────────────────────────
    t.seed();
    await t.sql(`update pi_projects set pid = (10000 + id)::text`);
    const projs = await t.sql(`select id from pi_projects where status in ('Active','On hold') order by id`);
    const [P1, P2, P3] = projs.map(p => String(p.id));
    await t.sql(`insert into pi_team_members (name, initials, title, phone, email) values
      ('Jeff Putzke','PUT','PI Manager','801-555-0100','jputzke@firm.example'),
      ('Sam Lead','SLD','PI Coordinator','801-555-0199','sam@firm.example'),
      ('Gone Person','GON','PI Coordinator',null,null)`);
    await t.sql(`update pi_team_members set active=false where initials='GON'`);
    await t.sql(`update pi_projects set lead='SLD' where id=${P1}`);
    await t.sql(`update pi_projects set lead='PUT' where id=${P2}`);
    await t.sql(`update pi_projects set lead='GON' where id=${P3}`);

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      // ── 4a. follow-up defaults to the lead ──
      const fu = (pid) => app.page.evaluate(pid => {
        S.projectFilter = pid; openIntModal();
        const r = { v: document.getElementById('f-ifua').value, hint: document.getElementById('f-ifua-hint').textContent };
        return r;
      }, pid);
      const f1 = await fu(P1);
      t.eq(f1.v, 'SLD', 'a new follow-up on a project led by someone else starts assigned to the lead');
      t.ok(/PI Lead, Sam Lead/.test(f1.hint), '…and the label says so');
      const f2 = await fu(P2);
      t.eq(f2.v, '', 'on a project I lead it stays with me (unassigned = whoever logged it)');
      t.eq((await fu(P3)).v, '', 'an inactive lead is not defaulted to');
      const moved = await app.page.evaluate(([p1, p2]) => {
        S.projectFilter = p1; openIntModal();
        const sel = document.getElementById('f-ip'); sel.value = p2; sel.onchange();
        const after = document.getElementById('f-ifua').value;
        sel.value = p1; sel.onchange();
        const back = document.getElementById('f-ifua').value;
        const fua = document.getElementById('f-ifua'); fua.value = ''; fua.dataset.touched = '1';
        sel.value = p2; sel.onchange(); sel.value = p1; sel.onchange();
        return { after, back, kept: document.getElementById('f-ifua').value };
      }, [P1, P2]);
      t.eq([moved.after, moved.back], ['', 'SLD'], 'changing the project in the dialog follows that project\'s lead');
      t.eq(moved.kept, '', 'once you pick someone yourself, a project change leaves your choice alone');
      await app.page.evaluate(async p1 => {
        closeM(); S.projectFilter = p1; openIntModal();
        document.getElementById('f-isu').value = 'Lead default test';
        document.getElementById('f-ifu').checked = true;
        document.getElementById('f-ifun').value = 'Call back';
        await saveInt();
      }, P1);
      const saved = await t.until(async () => (await t.sql(`select follow_up_assigned_to a, logged_by l from pi_interactions where summary='Lead default test'`))[0]);
      t.eq([saved.a, saved.l], ['SLD', 'PUT'], 'saved: assigned to the lead, still logged by me');

      // ── 4b. close-out signature ──
      const sig = await app.page.evaluate(([p1, p2]) => {
        _syncCache.closeouts = [{ id: '1', projectId: p2, createdBy: 'putzke@demo.test', updatedAt: '2026-01-01', intake: { sigName: 'Jeff P.', sigRole: 'UDOT PI Consultant', sigCell: '801-555-7777' } }];
        return { other: _coSeedIntake(p1, 'putzke@demo.test'), mine: _coSeedIntake(p2, 'putzke@demo.test') };
      }, [P1, P2]);
      t.eq([sig.other.sigName, sig.other.sigTitle, sig.other.sigEmail, sig.other.sigPhone, sig.other.sigRole], ['Sam Lead', 'PI Coordinator', 'sam@firm.example', '801-555-0199', undefined],
        'led by someone else: their signature, none of my lines mixed in');
      t.eq([sig.mine.sigName, sig.mine.sigRole, sig.mine.sigTitle, sig.mine.sigEmail], ['Jeff P.', 'UDOT PI Consultant', 'PI Manager', 'jputzke@firm.example'],
        'led by me: my last signature wins, the team list fills the gaps (work email, not the login)');

      // ── 5. Team view ──
      await t.sql(`insert into pi_interactions (project_id, summary, logged_by, follow_up, follow_up_done, follow_up_due, interaction_date)
                    values ('${P1}','od1','SLD',true,false,'2020-01-01','2026-01-01'), ('${P1}','od2','SLD',true,false,'2099-01-01','2026-01-01')`);
      await app.page.evaluate(async () => { cacheClear('interactions'); cacheClear('projects'); await loadAllData(); setView('team'); });
      const tv = await app.page.evaluate(() => {
        const rows = {};
        document.querySelectorAll('#team-table .team-row').forEach(r => { rows[r.dataset.ini] = [...r.children].map(td => td.textContent.replace(/\s+/g, ' ').trim()); });
        return { rows, nav: !!document.getElementById('nav-team'), text: document.getElementById('main').textContent };
      });
      t.ok(tv.nav, 'Team is in the sidebar');
      t.ok(tv.rows.SLD && tv.rows.SLD[1] === '1', 'Sam leads one active project');
      const sldOpen = await app.page.evaluate(() => DB.get('interactions').filter(i => i.followUp && !i.followUpDone && _fuOwner(i) === 'SLD').length);
      const sldOver = await app.page.evaluate(() => DB.get('interactions').filter(i => i.followUp && !i.followUpDone && _fuOwner(i) === 'SLD' && i.followUpDue && i.followUpDue < localToday()).length);
      t.eq([tv.rows.SLD[3], tv.rows.SLD[4]], [String(sldOpen), String(sldOver)], 'open and overdue follow-ups use the Follow-ups page\'s owner rule');
      t.ok(sldOpen >= 3 && sldOver >= 1, `…including the new defaulted one (${sldOpen} open, ${sldOver} overdue)`);
      t.ok(tv.rows.GON && /inactive/.test(tv.rows.GON[0]) && tv.rows.GON[1] === '1', 'a deactivated member still leading a project is listed and flagged');
      t.ok(tv.rows.PUT && /1 of 1|0 of 1/.test(tv.rows.PUT[6]), 'status-report staleness is counted per lead');
      await t.sql(`update pi_projects set lead=null where id=${P3}`);
      await app.page.evaluate(async () => { cacheClear('projects'); await loadAllData(); render(); });
      t.ok(/1 active project has no PI Lead/.test(await app.page.evaluate(() => document.getElementById('main').textContent)), 'projects with no lead are called out');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }

    // ── 4c, the page: a real token link shows the card ──
    const [tok] = await t.sql(`select token from pi_portal_links where project_id::text=$1 limit 1`, [P1]);
    if (tok) {
      const portal = await t.open('client-portal.html', { portalToken: tok.token });
      try {
        await portal.page.waitForSelector('.pi-contact', { timeout: 15000 });
        const card = await portal.page.evaluate(() => document.querySelector('.pi-contact').textContent.replace(/\s+/g, ' '));
        t.ok(/Your PI contact/.test(card) && /Sam Lead/.test(card) && /801-555-0199/.test(card) && /sam@firm\.example/.test(card), 'the client\'s Overview shows the lead: ' + card.trim());
        t.ok(await portal.page.evaluate(() => !!document.querySelector('.pi-contact a[href^="mailto:"]') && !!document.querySelector('.pi-contact a[href^="tel:"]')), 'phone and email are tappable');
        t.eq(portal.errors, [], 'no portal errors');
      } finally { await portal.close(); }
    } else {
      t.ok(false, 'seed project has a portal link to test the card with');
    }
  }
};
