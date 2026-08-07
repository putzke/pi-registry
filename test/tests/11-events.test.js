// Saving an event must not manufacture interactions.
//
// The "Action items / follow-ups" field used to create one pi_interactions row
// per line, each with no loggedBy (so _fuOwner() returned '' and it belonged to
// nobody), no due date, no stakeholder, and direction 'Inbound' — which is not
// one of the app's three direction values, so the interaction filter could not
// select them. Nothing excluded them, so they inflated the interaction count
// that flows into FHWA/NEPA reports.
//
// Worse, the edit path deleted every interaction carrying the meetingId before
// recreating from the textarea, so re-saving an event destroyed hand-logged
// interactions linked to it. That case is checked explicitly below.
module.exports = {
  name: 'events — saving one never creates or destroys interactions',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
      const projId = String(proj.id);
      const countInts = async () => Number((await t.sql(
        'select count(*) c from pi_interactions where project_id::text=$1', [projId]))[0].c);

      const before = await countInts();
      t.gt(before, 0, 'project has interactions to protect');

      // ── creating an event with action items ─────────────────────────────
      await app.page.evaluate(id => { S.projectFilter = id; setView('meetings'); }, projId);
      await app.page.waitForTimeout(150);

      await app.page.evaluate(async id => {
        openMeetingModal();
        const set = (f, v) => { document.getElementById(f).value = v; };
        set('f-mp', id);
        set('f-mt', 'Corridor open house — test');
        set('f-md', '2026-08-01');
        set('f-mai', 'Submit the hearing transcript to FHWA\nEnter comment forms into the matrix\nRespond to the noise wall request');
        await saveMeeting();
      }, projId);
      await app.page.waitForTimeout(1200);

      t.eq(await countInts(), before, 'three action items created zero interactions');

      const saved = (await t.sql(
        `select id, action_items from pi_meetings
          where title='Corridor open house — test'`))[0];
      t.ok(saved, 'the event itself saved');
      t.ok(/Submit the hearing transcript/.test(saved.action_items || ''),
           'action items are kept as text on the event record');
      t.ok(/noise wall/.test(saved.action_items || ''),
           'every line is kept, not just the first');

      // ── editing it must not disturb the interaction log ─────────────────
      // Link a hand-logged interaction to this event first: that is exactly what
      // the old edit path wiped out.
      await t.sql(
        `update pi_interactions set meeting_id=$1 where id in (
           select id from pi_interactions where project_id::text=$2 order by id limit 2)`,
        [saved.id, projId]);
      const linked = Number((await t.sql(
        'select count(*) c from pi_interactions where meeting_id::text=$1', [String(saved.id)]))[0].c);
      t.eq(linked, 2, 'two real interactions are linked to the event');

      await app.page.evaluate(async id => {
        await loadAllData();
        openMeetingModal(id);
        document.getElementById('f-mai').value = 'Reworded action item';
        await saveMeeting();
      }, String(saved.id));
      await app.page.waitForTimeout(1200);

      t.eq(await countInts(), before, 'editing created no interactions either');
      const still = Number((await t.sql(
        'select count(*) c from pi_interactions where meeting_id::text=$1', [String(saved.id)]))[0].c);
      t.eq(still, 2, 'the linked interactions survived the edit');

      const reworded = (await t.sql(
        'select action_items from pi_meetings where id::text=$1', [String(saved.id)]))[0];
      t.eq((reworded.action_items || '').trim(), 'Reworded action item', 'the edit saved');

      // No row anywhere should carry the old invalid direction.
      const bad = Number((await t.sql(
        `select count(*) c from pi_interactions where direction='Inbound'`))[0].c);
      t.eq(bad, 0, "nothing writes the invalid 'Inbound' direction");

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
