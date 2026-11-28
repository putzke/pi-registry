// Each PI team member can turn off the "new hotline voicemail" email
// (Jeff, Nov 2026). Default on. The box shows only where the hotline is on.
module.exports = {
  name: 'PI team — "Email me about new hotline voicemails" opt-out',
  async run({ t }) {
    t.seed();
    await t.sql(`insert into pi_team_members (name, initials, email, active) values ('Mail Person','MPX','mpx@demo.test',true)`);
    const app = await t.open('index.html');
    const p = app.page;
    p.on('dialog', d => d.accept());
    const id = String((await t.sql(`select id from pi_team_members where initials='MPX'`))[0].id);
    await p.evaluate(async (id) => { await _refreshData(['team_members']).catch(()=>{}); openTeamMemberModal(id); }, id);
    await p.waitForSelector('#f-tm-hotmail');
    t.ok(await p.$eval('#f-tm-hotmail', e => e.checked), 'the box starts ticked (default on)');
    await p.uncheck('#f-tm-hotmail');
    await p.evaluate(() => saveTeamMember());
    for (let i = 0; i < 40; i++) { if ((await t.sql(`select hotline_email from pi_team_members where initials='MPX'`))[0].hotline_email === false) break; await p.waitForTimeout(250); }
    t.eq((await t.sql(`select hotline_email from pi_team_members where initials='MPX'`))[0].hotline_email, false, 'unticking saves hotline_email = false');
    await p.evaluate(() => { setView('settings'); });
    await p.waitForTimeout(300);
    t.ok(/no voicemail email/.test(await p.evaluate(() => document.getElementById('main').innerText)), 'the team list says so');
    await p.evaluate((id) => openTeamMemberModal(id), id);
    await p.waitForSelector('#f-tm-hotmail');
    t.ok(!(await p.$eval('#f-tm-hotmail', e => e.checked)), 'reopening shows it unticked');
    await p.check('#f-tm-hotmail');
    await p.evaluate(() => saveTeamMember());
    for (let i = 0; i < 40; i++) { if ((await t.sql(`select hotline_email from pi_team_members where initials='MPX'`))[0].hotline_email === true) break; await p.waitForTimeout(250); }
    t.eq((await t.sql(`select hotline_email from pi_team_members where initials='MPX'`))[0].hotline_email, true, 'ticking it again turns it back on');
    await app.close();
  },
};
