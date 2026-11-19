// Issue "Assigned to" (Jeff, Nov 2026): stays open text, but the box suggests
// "PI contact or Project team member" and is capped at ISS_ASSIGNED_MAX (30)
// characters, because it prints in a report column. A stored value is escaped
// in the box (a quote used to end the attribute).
module.exports = {
  name: 'issues — Assigned to: open text, suggested wording, 30-character cap',
  async run({ t }) {
    t.seed();
    const [A] = (await t.sql(`select id from pi_projects where status='Active' order by id limit 1`)).map(r => String(r.id));
    const [iss] = await t.sql(`insert into pi_issues (project_id, title, status, priority, category, date_raised, assigned_to)
                               values ($1,'ISSUE ASSIGN','Open','Medium','Traffic & Access','2026-11-17','Joe "JJ" Smith') returning id`, [A]);
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(async ({ A, id }) => {
        S.projectFilter = A;
        await openIssueModal(id, A);
        const el = document.getElementById('iss-assigned');
        const out = { ph: el.placeholder, max: el.maxLength, val: el.value, cap: ISS_ASSIGNED_MAX };
        el.value = '  ' + 'X'.repeat(45) + '  ';   // pasted or set past the cap
        await saveIssue(A);
        await new Promise(r => setTimeout(r, 400));
        out.saved = (DB.get('issues').find(i => String(i.id) === String(id)) || {}).assignedTo;
        return out;
      }, { A, id: String(iss.id) });
      t.eq(r.ph, 'PI contact or Project team member', 'the box suggests a PI contact or project team member');
      t.eq(r.cap, 30, 'cap is 30 characters');
      t.eq(r.max, 30, 'the box stops typing at 30 characters');
      t.eq(r.val, 'Joe "JJ" Smith', 'a stored value with quotes shows whole (escaped)');
      t.eq(r.saved, 'X'.repeat(30), 'save trims spaces and keeps at most 30 characters');
      const [row] = await t.sql(`select assigned_to from pi_issues where id=$1`, [iss.id]);
      t.eq(row.assigned_to, 'X'.repeat(30), 'and that is what reaches the database');
    } finally { await app.close(); }
  },
};
