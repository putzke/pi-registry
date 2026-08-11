// The Edit-interaction modal's "Assign to" must show who the follow-up actually
// belongs to.
//
// _fuOwner() is `followUpAssignedTo || loggedBy`, so an empty assignee means
// "stays with whoever logged it". The option carrying that empty value was
// labelled "Me (<your initials>)", which collapsed two different states into
// one: PUT opening a follow-up logged by SHA saw "Me (PUT)" and read it as
// theirs. The list row beside it said SHA at the same moment.
//
// Nothing was corrupted on save — the empty value round-trips — but the modal
// asserted ownership that _fuOwner() disagreed with, and someone reading it
// would never think to reassign a follow-up they believed was already theirs.
module.exports = {
  name: 'edit interaction — Assign to reflects the real owner, not the reader',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const me = await app.page.evaluate(() => getLoggedBy());
      t.eq(me, 'PUT', 'signed in as PUT');

      const opts = () => app.page.evaluate(() => {
        const s = document.getElementById('f-ifua');
        return { selected: s.value,
                 selectedText: s.options[s.selectedIndex].text,
                 texts: [...s.options].map(o => o.text),
                 values: [...s.options].map(o => o.value) };
      });

      // ── the reported case: logged by someone else, nobody assigned ───────
      const other = (await t.sql(`
        select id, logged_by from pi_interactions
         where follow_up and not coalesce(follow_up_done,false)
           and coalesce(follow_up_assigned_to,'') = '' and logged_by <> 'PUT'
         order by id limit 1`))[0];
      t.ok(other, 'seed has an unassigned follow-up logged by someone else');

      await app.page.evaluate(id => openEditIntModal(id), String(other.id));
      await app.page.waitForTimeout(400);   // the modal refreshes its row first

      let o = await opts();
      t.eq(o.selected, '', 'nothing is explicitly assigned, so the blank option is selected');
      t.eq(/^Me \(/.test(o.selectedText), false,
           `and it must NOT read as "Me" — got "${o.selectedText}"`);
      t.ok(o.selectedText.includes(other.logged_by),
           `it names the real owner (${other.logged_by}) — got "${o.selectedText}"`);
      t.ok(/unassigned/i.test(o.selectedText),
           'and says nobody has been assigned explicitly');

      // "Me" must still be reachable — but as a deliberate choice with a value,
      // not as the do-nothing default.
      const meIdx = o.texts.findIndex(x => /^Me \(PUT\)/.test(x));
      t.gt(meIdx, -1, 'assigning to yourself is still offered');
      t.eq(o.values[meIdx], 'PUT', 'and it carries a real value, not the blank');

      // What the view shows must agree with what the modal shows.
      const owner = await app.page.evaluate(id =>
        _fuOwner(_syncCache.interactions.find(x => String(x.id) === id)), String(other.id));
      t.eq(owner, other.logged_by, '_fuOwner agrees the follow-up belongs to the logger');

      // ── an explicitly assigned follow-up ────────────────────────────────
      const assigned = (await t.sql(`
        select id, follow_up_assigned_to a from pi_interactions
         where follow_up and coalesce(follow_up_assigned_to,'') <> ''
           and follow_up_assigned_to <> 'PUT' order by id limit 1`))[0];
      t.ok(assigned, 'seed has an explicitly assigned follow-up');
      await app.page.evaluate(id => { closeM(); openEditIntModal(id); }, String(assigned.id));
      await app.page.waitForTimeout(400);
      o = await opts();
      t.eq(o.selected, assigned.a, 'the stored assignee is selected');
      t.eq(o.selectedText, assigned.a, 'and shown by name');

      // ── assigned to the reader ──────────────────────────────────────────
      // This is the one case the old label got right by accident, and it must
      // still be right now that blank and "me" are separate options.
      await t.sql(`update pi_interactions set follow_up_assigned_to='PUT' where id=$1`,
                  [assigned.id]);
      await app.page.evaluate(id => {
        const i = _syncCache.interactions.find(x => String(x.id) === id);
        i.followUpAssignedTo = 'PUT';
        closeM(); openEditIntModal(id);
      }, String(assigned.id));
      await app.page.waitForTimeout(400);
      o = await opts();
      t.eq(o.selected, 'PUT', 'a follow-up assigned to you selects the Me option');
      t.ok(/^Me \(PUT\)/.test(o.selectedText), 'which reads as Me');

      // ── saving an untouched modal must not change ownership ─────────────
      const before = (await t.sql(
        'select follow_up_assigned_to a, logged_by l from pi_interactions where id=$1',
        [other.id]))[0];
      await app.page.evaluate(id => { closeM(); openEditIntModal(id); }, String(other.id));
      await app.page.waitForTimeout(400);
      await app.page.evaluate(() => saveInt());
      await app.page.waitForTimeout(600);
      const after = (await t.sql(
        'select follow_up_assigned_to a, logged_by l from pi_interactions where id=$1',
        [other.id]))[0];
      t.eq(after.a || '', before.a || '', 'opening and saving leaves the assignee alone');
      t.eq(after.l, before.l, 'and the logger');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
