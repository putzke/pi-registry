// The dashboard card's follow-up tag opens that project's follow-ups (Jeff,
// Nov 2026): "N overdue follow-ups" → Follow-ups, that project, Overdue only,
// everyone's (the card counts the whole team's, so "Assigned to me" would show
// nothing for a follow-up a colleague owns). Clicking it must not also fire
// the card's own click (Interactions).
module.exports = {
  name: 'dashboard — the overdue follow-up tag opens those follow-ups',
  async run({ t }) {
    t.seed();
    const [A] = (await t.sql(`select id::text id from pi_projects where status='Active' order by id limit 1`)).map(r => r.id);
    await t.sql(`update pi_interactions set follow_up=false where project_id::text=$1`, [A]);
    const [od] = await t.sql(`insert into pi_interactions (project_id, interaction_date, channel, direction, summary, logged_by, follow_up, follow_up_done, follow_up_due, follow_up_note)
                              values ($1,'2026-01-05','Phone','Incoming','x','ZZZ',true,false,'2026-01-07','OVERDUE ZQX ACTION') returning id`, [A]);
    await t.sql(`insert into pi_interactions (project_id, interaction_date, channel, direction, summary, logged_by, follow_up, follow_up_done, follow_up_due, follow_up_note)
                 values ($1,'2026-01-05','Phone','Incoming','x','ZZZ',true,false,'2099-01-07','NOT DUE ZQX ACTION')`, [A]);
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(async (A) => {
        localStorage.setItem('cc_proj_scope', 'all');
        S.view = 'dashboard'; render();
        await new Promise(r => setTimeout(r, 300));
        const tag = [...document.querySelectorAll('.dash-fu-tag')].find(a => (a.getAttribute('onclick') || '').includes("'" + A + "'"));
        const out = { text: tag && tag.textContent.trim() };
        tag.click();
        await new Promise(r => setTimeout(r, 300));
        out.view = S.view; out.st = S.fuStatus; out.user = S.fuUser; out.proj = String(S.fuProj); out.scope = String(S.projectFilter);
        out.main = document.getElementById('main').textContent;
        return out;
      }, A);
      t.eq(r.text, '1 overdue follow-up', 'the tag names what it counts');
      t.eq(r.view, 'followups', 'clicking it opens Follow-ups, not Interactions');
      t.ok(r.st === 'overdue' && r.user === 'all' && r.proj === A && r.scope === A, 'filtered to that project, Overdue only, everyone\'s');
      t.ok(r.main.includes('OVERDUE ZQX ACTION') && !r.main.includes('NOT DUE ZQX ACTION'), 'the overdue follow-up shows (a colleague\'s), the not-yet-due one does not');
    } finally { await app.close(); }
  },
};
