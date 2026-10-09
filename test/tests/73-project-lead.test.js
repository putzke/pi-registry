// The PI team list and a PI Lead on every project (Oct 2026).
//
//  1. Settings → PI team: add / edit / deactivate people, initials unique.
//     A member needs no email (a new hire can lead projects before they have
//     one) and the list feeds the follow-up "Assign to" roster.
//  2. Edit project → PI Lead, with a {from,to,date,by} handoff history.
//     Changing a member's initials re-keys the projects they lead, and does
//     it with the WHOLE record (toSB nulls any date a partial object omits).
//  3. Dashboard + Projects: "My projects | All", remembered per browser.
module.exports = {
  name: 'PI team list, project lead with history, My projects filter',
  async run({ t }) {
    t.seed();
    // The seed's project numbers predate the 3–5 digit rule saveProj enforces.
    await t.sql(`update pi_projects set pid = (10000 + id)::text`);
    const projs = await t.sql(`select id, name from pi_projects where status in ('Active','On hold') order by id`);
    t.ok(projs.length >= 2, `seed has several active projects (${projs.length})`);
    const [A, B] = projs.map(p => String(p.id));

    const app = await t.open('index.html', { email: 'putzke@demo.test' });   // initials PUT
    try {
      await app.ready();
      await app.page.evaluate(() => { window.confirm = () => true; window._alerts = []; window.alert = m => window._alerts.push(m); try { localStorage.removeItem('cc_proj_scope'); } catch (e) {} });

      // ── 1. the team list ────────────────────────────────────────────────
      await app.page.evaluate(() => { S.view = 'settings'; render(); });
      t.ok(await app.page.evaluate(() => !!document.getElementById('team-card-body')), 'Settings has a PI team card');

      const addMember = (f) => app.page.evaluate(async f => {
        openTeamMemberModal(f.id || null);
        const set = (id, v) => { const el = document.getElementById(id); if (v !== undefined) el.value = v; };
        set('f-tm-name', f.name); set('f-tm-ini', f.initials); set('f-tm-title', f.title);
        set('f-tm-phone', f.phone); set('f-tm-email', f.email); set('f-tm-active', f.active);
        await saveTeamMember();
      }, f);

      await addMember({ name: 'Jeff Putzke', initials: 'PUT', title: 'PI Manager', email: 'putzke@demo.test' });
      await addMember({ name: 'New Hire', initials: 'NH', title: 'PI Coordinator', phone: '801-555-0100', email: '' });
      const rows = await t.sql(`select name, initials, email, active from pi_team_members order by name`);
      t.eq(rows.map(r => r.initials), ['PUT', 'NH'], 'both members were saved');
      t.ok(rows.find(r => r.initials === 'NH').active === true && !rows.find(r => r.initials === 'NH').email, 'a member can be saved with no email');

      await addMember({ name: 'Someone Else', initials: 'nh' });
      t.eq((await t.sql(`select count(*)::int n from pi_team_members`))[0].n, 2, 'duplicate initials are refused (case-insensitive)');
      t.ok(await app.page.evaluate(() => window._alerts.some(a => /already uses NH/.test(a))), '…and the user is told why');

      t.ok(await app.page.evaluate(() => _fuTeam().includes('NH')), 'a member with nothing logged is in the follow-up Assign-to roster');
      const card = await app.page.evaluate(() => document.getElementById('team-card-body').textContent);
      t.ok(/New Hire/.test(card) && /801-555-0100/.test(card), 'the card lists the team');

      // ── 2. PI Lead on a project, with history ───────────────────────────
      const saveLead = (pid, ini) => app.page.evaluate(async ([pid, ini]) => {
        openProjModal(pid);
        const sel = document.getElementById('f-plead');
        sel.value = ini;
        await saveProj();
      }, [pid, ini]);
      const opts = await app.page.evaluate(pid => { openProjModal(pid); const o = [...document.getElementById('f-plead').options].map(x => x.value); closeM(); return o; }, A);
      t.eq(opts, ['', 'PUT', 'NH'], 'the PI Lead select offers "no lead" plus the active team');

      await saveLead(A, 'NH');
      let [pa] = await t.sql(`select lead, lead_history, end_date from pi_projects where id=${A}`);
      t.eq(pa.lead, 'NH', 'the lead is saved on the project');
      t.eq(pa.lead_history.length, 1, 'setting the first lead on an existing project is recorded');
      t.eq([pa.lead_history[0].from, pa.lead_history[0].to, pa.lead_history[0].by], ['', 'NH', 'PUT'], '…from no lead, to NH, by the signed-in user');

      await saveLead(A, 'PUT');
      [pa] = await t.sql(`select lead, lead_history from pi_projects where id=${A}`);
      t.eq([pa.lead, pa.lead_history.length, pa.lead_history[1].from, pa.lead_history[1].to], ['PUT', 2, 'NH', 'PUT'], 'a handoff appends to the history');
      await saveLead(A, 'PUT');
      t.eq((await t.sql(`select jsonb_array_length(lead_history) n from pi_projects where id=${A}`))[0].n, 2, 're-saving without a change adds nothing');

      await saveLead(B, 'NH');
      const hist = await app.page.evaluate(pid => { openProjModal(pid); const h = document.getElementById('m-body').textContent; closeM(); return h; }, A);
      t.ok(/New Hire → Jeff Putzke/.test(hist), 'the modal shows the handoff history by name');

      // Re-keying initials moves the projects AND keeps their dates.
      const before = (await t.sql(`select start_date::text s, end_date::text e from pi_projects where id=${B}`))[0];
      const nhId = (await t.sql(`select id from pi_team_members where initials='NH'`))[0].id;
      await addMember({ id: String(nhId), name: 'New Hire', initials: 'NHX' });
      const [pb] = await t.sql(`select lead, lead_history, start_date::text s, end_date::text e from pi_projects where id=${B}`);
      t.eq(pb.lead, 'NHX', 'changing a member\'s initials re-keys the projects they lead');
      t.eq([pb.s, pb.e], [before.s, before.e], '…without nulling the project dates');
      t.ok((await t.sql(`select lead_history from pi_projects where id=${A}`))[0].lead_history[1].from === 'NHX', '…and the history entries that name them');

      // Deactivated lead stays selectable on their own project, labelled.
      await addMember({ id: String(nhId), name: 'New Hire', initials: 'NHX', active: '0' });
      const o2 = await app.page.evaluate(pid => { openProjModal(pid); const o = [...document.getElementById('f-plead').options].map(x => x.textContent); const v = document.getElementById('f-plead').value; closeM(); return { o, v }; }, B);
      t.ok(o2.v === 'NHX' && o2.o.some(x => /inactive/.test(x)), 'an inactive lead is kept (and labelled) rather than dropped on save');
      t.ok(await app.page.evaluate(() => !_fuTeam().includes('NHX') || DB.get('interactions').some(i => i.loggedBy === 'NHX' || i.followUpAssignedTo === 'NHX')), 'an inactive member leaves the Assign-to roster');

      // ── 3. My projects | All ────────────────────────────────────────────
      await app.page.evaluate(() => { S.view = 'dashboard'; render(); });
      const dashCards = () => app.page.evaluate(() => [...document.querySelectorAll('#dash-proj-cards > div[onclick]')].map(d => d.getAttribute('onclick').match(/filterByProject\('([^']+)'\)/)[1]));
      t.eq(await dashCards(), [A], 'the dashboard opens on "My projects" when I lead one');
      t.ok(await app.page.evaluate(() => /Lead · Jeff Putzke/.test(document.getElementById('dash-proj-cards').textContent)), 'the card names the lead');

      await app.page.evaluate(() => { S.view = 'projects'; S.projTab = 'active'; render(); });
      const projCards = () => app.page.evaluate(() => [...document.querySelectorAll('#main button')].filter(b => /^exportProject\(/.test(b.getAttribute('onclick') || '')).map(b => b.getAttribute('onclick').match(/'([^']+)'/)[1]));
      t.eq(await projCards(), [A], 'the Projects view is scoped the same way');
      await app.page.evaluate(() => setProjScope('all'));
      t.ok((await projCards()).length === projs.length, 'All shows every active project');
      await app.page.evaluate(() => { S.view = 'dashboard'; render(); });
      t.ok((await dashCards()).length > 1, 'the choice is shared with the dashboard');
      t.eq(await app.page.evaluate(() => localStorage.getItem('cc_proj_scope')), 'all', '…and remembered');

      // Someone who leads nothing is not dropped onto an empty screen.
      await app.page.evaluate(() => localStorage.removeItem('cc_proj_scope'));
      await t.sql(`update pi_projects set lead = null`);
      await app.page.evaluate(async () => { cacheClear('projects'); await loadAllData(); S.view = 'dashboard'; render(); });
      t.eq(await app.page.evaluate(() => _projScope()), 'all', 'with no projects led, it opens on All');
    } finally { await app.close(); }
  }
};
