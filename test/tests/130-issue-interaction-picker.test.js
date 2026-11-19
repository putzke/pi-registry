// Edit issue → Linked interactions (Jeff, Nov 2026). The Ctrl/Cmd multi-select
// is replaced by: a "Linked to this issue" list (✕ removes), a search box
// (name, organization, summary), a sort (newest / oldest / by name) and
// "+ Add" per row; a name narrows the list to that person. Removing every link
// now saves (the old save skipped an empty selection). Notes were folded into
// Description: old notes show there and the next save keeps them there.
module.exports = {
  name: 'issues — linked-interaction picker (search, sort, add/remove); notes folded into description',
  async run({ t }) {
    t.seed();
    const [A] = (await t.sql(`select id from pi_projects where status='Active' order by id limit 1`)).map(r => String(r.id));
    const st = await t.sql(`select s.id, s.first_name, s.last_name from pi_stakeholders s join pi_project_stakeholders l on l.stakeholder_id = s.id::text
                            where l.project_id=$1 and coalesce(s.is_archived,false)=false and coalesce(s.first_name,'')<>'' order by s.id limit 2`, [A]);
    const mk = async (sid, date, sum) => (await t.sql(`insert into pi_interactions (project_id, stakeholder_id, interaction_date, channel, direction, summary, logged_by)
                                                       values ($1,$2,$3,'Phone','Incoming',$4,'PUT') returning id`, [A, String(sid), date, sum]))[0].id;
    const i1 = await mk(st[0].id, '2026-11-05', 'ZQX grade concern first call');
    const i2 = await mk(st[0].id, '2026-11-06', 'ZQX grade concern voicemail');
    const i3 = await mk(st[1].id, '2026-11-07', 'ZQX neighbour drainage');
    const [iss] = await t.sql(`insert into pi_issues (project_id, title, status, priority, category, date_raised, description, notes)
                               values ($1,'ISSUE PICK','Open','Medium','Traffic & Access','2026-11-17','Drainage complaint','Resurfaced from an earlier talk') returning id`, [A]);
    await t.sql(`insert into pi_issue_interactions (issue_id, interaction_id) values ($1,$2)`, [String(iss.id), String(i1)]);
    const name0 = (st[0].first_name + ' ' + st[0].last_name).trim();

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(async ({ A, id, i1, i2, i3, name0 }) => {
        S.projectFilter = A;
        const out = {};
        await openIssueModal(id, A);
        out.noOldSelect = !document.getElementById('iss-int-links') && !document.getElementById('iss-notes') && !/Ctrl\/Cmd/.test(document.getElementById('modal-ov').textContent);
        out.desc = document.getElementById('iss-desc').value;
        const ids = sel => [...document.querySelectorAll(sel + ' .iss-pick-row')].map(e => e.dataset.id);
        out.linked0 = ids('#iss-pick-linked');
        _issPickSet('q', 'ZQX'); out.all = ids('#iss-pick-list');
        _issPickSet('sort', 'oldest'); out.oldest = ids('#iss-pick-list');
        // Click a name → only that person's interactions.
        _issPickSet('sort', 'newest');
        [...document.querySelectorAll('#iss-pick-list .iss-pick-name')].find(a => a.dataset.n === name0).click();
        out.byName = ids('#iss-pick-list').filter(x => [i1, i2, i3].map(String).includes(x));
        // Add i2 and i3 by their buttons, remove i1 from the linked list.
        _issPickSet('q', 'ZQX');
        for (const x of [i2, i3]) document.querySelector(`#iss-pick-list .iss-pick-row[data-id="${x}"] button`).click();
        out.addedMark = document.querySelector(`#iss-pick-list .iss-pick-row[data-id="${i2}"]`).textContent.includes('✓ Linked');
        document.querySelector(`#iss-pick-linked .iss-pick-row[data-id="${i1}"] button`).click();
        out.linked1 = ids('#iss-pick-linked').sort();
        await saveIssue(A);
        await new Promise(r => setTimeout(r, 300));
        out.savedLinks = (DB.get('issue_interactions') || []).filter(l => String(l.issueId) === String(id)).map(l => String(l.interactionId)).sort();
        // Then remove every link and save again.
        await openIssueModal(id, A);
        for (const b of [...document.querySelectorAll('#iss-pick-linked .iss-pick-row button')]) b.click();
        await saveIssue(A);
        await new Promise(r => setTimeout(r, 300));
        return out;
      }, { A, id: String(iss.id), i1: String(i1), i2: String(i2), i3: String(i3), name0 });
      t.ok(r.noOldSelect, 'no Ctrl/Cmd multi-select and no separate Notes box');
      t.ok(/^Drainage complaint\n\nNotes: Resurfaced from an earlier talk$/.test(r.desc), 'old notes show inside Description');
      t.eq(r.linked0.join(), String(i1), 'the linked list shows the issue’s current interaction');
      t.eq(r.all.join(), [i3, i2, i1].map(String).join(), 'search finds matches, newest first');
      t.eq(r.oldest.join(), [i1, i2, i3].map(String).join(), 'oldest first');
      t.eq(r.byName.sort().join(), [i1, i2].map(String).sort().join(), 'clicking a name narrows to that person');
      t.ok(r.addedMark, 'an added row reads ✓ Linked');
      t.eq(r.linked1.join(), [i2, i3].map(String).sort().join(), '+ Add and ✕ change the linked list');
      t.eq(r.savedLinks.join(), [i2, i3].map(String).sort().join(), 'save writes exactly the linked list');
      const [row] = await t.sql(`select description, notes from pi_issues where id=$1`, [iss.id]);
      t.ok(/Drainage complaint/.test(row.description) && /Notes: Resurfaced/.test(row.description) && !row.notes, 'saved: notes kept in the description, notes column cleared');
      const links = await t.sql(`select interaction_id from pi_issue_interactions where issue_id=$1`, [String(iss.id)]);
      t.eq(links.length, 0, 'removing every link saves (it used to keep the old ones)');
    } finally { await app.close(); }
  },
};
