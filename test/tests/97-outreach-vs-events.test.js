// Outreach vs events (Jeff, 2026-10-22). An EVENT is a gathering (people
// together at a set time, in person or online); OUTREACH is something sent,
// posted or published. So:
//  - "Email distribution" left the event types; an older event keeping it still
//    shows it in its own dialog.
//  - Outreach gained Flyer / door hanger, Mailer / postcard, Email blast, and
//    "Shared with a partner to distribute" (was "Agency/partner coordination"),
//    plus How it went out + Reached / quantity, shown in the log, the reports
//    and the close-out facts.
//  - The bulk-email tool logs an Outreach "Email blast", not an event.
//  - sql/fixes/2026-10-22_move_flyer_events_to_outreach.sql moves LIVE's four
//    0-attendance flyer/notice events, once, and leaves a real event alone.
const fs = require('fs'), path = require('path');
module.exports = {
  name: 'outreach vs events — flyers and email blasts are outreach, with delivery and reach',
  async run({ t }) {
    t.seed();
    const [proj] = await t.sql(`select id from pi_projects where pid='25-LC-400N'`);
    const P = String(proj.id);
    const [co] = await t.sql(`insert into pi_closeouts (project_id, label, intake, created_by) values ($1,'Year 1',$2::jsonb,'staff@sunrise.example') returning id`,
      [P, JSON.stringify({ periodFrom: '2026-03-01', periodTo: '2026-03-31' })]);
    const [emailEvt] = await t.sql(`select id from pi_meetings where meeting_type='Email distribution' limit 1`);

    const app = await t.open('index.html', { email: 'staff@sunrise.example' });
    try {
      await app.ready();
      const page = app.page;
      await page.evaluate(() => { window._alerts = []; window.alert = (m) => window._alerts.push(m); window.confirm = () => true; });

      const lists = await page.evaluate(() => ({ ev: MEETING_TYPES, out: OUTREACH_TYPES, del: OUT_DELIVERY }));
      t.ok(!lists.ev.includes('Email distribution'), 'Email distribution is no longer an event type');
      t.ok(['Flyer / door hanger', 'Mailer / postcard', 'Email blast', 'Shared with a partner to distribute'].every((x) => lists.out.includes(x)) && !lists.out.includes('Agency/partner coordination'), 'the new outreach types, and the renamed partner type');
      t.eq(lists.del, ['Hand-delivered', 'Mailed', 'Emailed', 'Posted online', 'Posted on site'], 'how it went out');

      // An old Email-distribution event keeps its type in its own dialog.
      if (emailEvt) {
        const kept = await page.evaluate((id) => { S.projectFilter = ''; setView('meetings'); openMeetingModal(String(id)); return document.getElementById('f-mty').value; }, emailEvt.id);
        t.eq(kept, 'Email distribution', 'an older event keeps its type when opened');
        t.ok(/A flyer, mailer, email or post is/.test(await page.textContent('#modal-body, .modal, body')), 'the event dialog says what belongs in Outreach');
        await page.evaluate(() => closeM());
      }

      // ── the Email blast tip: shown for that type only; its link goes to Email contacts in this tab ──
      await page.evaluate((p) => { S.projectFilter = p; setView('outreach'); openOutreachModal(); }, P);
      t.ok(!(await page.isVisible('#f-out-emailtip')), 'the tip is hidden for other types');
      await page.selectOption('#f-out-type', 'Email blast');
      t.ok(await page.isVisible('#f-out-emailtip') && /^Send to project contacts\? Suggest Email contacts for simple outreach\.$/.test((await page.textContent('#f-out-emailtip')).trim()), 'Email blast shows the one-line tip');
      await page.fill('#f-out-title', 'half typed');
      await page.evaluate(() => { window.confirm = () => false; outGoEmail(); window.confirm = () => true; });
      t.ok(await page.isVisible('#f-out-title') && (await page.inputValue('#f-out-title')) === 'half typed', 'with something typed, it asks first; No keeps the entry');
      const went = await page.evaluate(() => { outGoEmail(); return { view: S.view, panel: !!S.showEmailPanel, proj: S.projectFilter, open: document.getElementById('modal-ov').classList.contains('open') }; });
      t.eq(went, { view: 'stakeholders', panel: true, proj: P, open: false }, 'Yes goes to Email contacts for the same project, in this tab');
      t.ok(/Email contacts/.test(await page.textContent('#main')), 'the Email contacts screen is showing');

      // ── a hand-delivered flyer ──
      await page.evaluate((p) => { S.projectFilter = p; setView('outreach'); openOutreachModal(); }, P);
      t.ok(/A gathering of people/.test(await page.textContent('body')), 'the outreach dialog says what belongs in Events');
      await page.selectOption('#f-out-type', 'Flyer / door hanger');
      await page.fill('#f-out-title', 'FLYERMARK lane closure flyer');
      await page.selectOption('#f-out-deliv', 'Hand-delivered');
      await page.fill('#f-out-reach', '-3');
      await page.evaluate(() => saveOutreach());
      t.ok((await page.evaluate(() => window._alerts)).some((m) => /Reached \/ quantity must be a whole number/.test(m)), 'a negative quantity is refused');
      await page.fill('#f-out-reach', '450');
      await page.fill('#f-out-date', '2026-03-12');
      await page.evaluate(() => saveOutreach());
      await t.until(async () => (await t.sql(`select count(*)::int n from pi_outreach_actions where title like 'FLYERMARK%'`))[0].n === 1, 'saved');
      const [row] = await t.sql(`select action_type, delivery, reach from pi_outreach_actions where title like 'FLYERMARK%'`);
      t.eq(row, { action_type: 'Flyer / door hanger', delivery: 'Hand-delivered', reach: 450 }, 'type, delivery and reach are stored');
      t.ok(/Hand-delivered · 450 reached/.test(await page.textContent('#main')), 'the log shows how it went out and how many it reached');

      // Clearing them clears the columns.
      const [{ id: flyerId }] = await t.sql(`select id from pi_outreach_actions where title like 'FLYERMARK%'`);
      await page.evaluate((id) => openOutreachModal(String(id)), flyerId);
      t.eq([await page.inputValue('#f-out-deliv'), await page.inputValue('#f-out-reach')], ['Hand-delivered', '450'], 'the edit dialog shows them');
      await page.selectOption('#f-out-deliv', '');
      await page.fill('#f-out-reach', '');
      await page.evaluate(() => saveOutreach());
      await t.until(async () => (await t.sql(`select delivery is null and reach is null ok from pi_outreach_actions where id=$1`, [flyerId]))[0].ok, 'cleared');
      await t.sql(`update pi_outreach_actions set delivery='Hand-delivered', reach=450 where id=$1`, [flyerId]);
      await page.evaluate(async () => { _syncCache.outreach_actions = (await sbGet('outreach_actions')); });

      // Reports and close-out facts carry it.
      const rep = await page.evaluate((p) => {
        S.view = 'reports'; S.rptTab = 'reports'; S.projectFilter = p; render(); generateReport('outreach-log');
        const f = document.getElementById('inline-rpt-frame'); const html = f ? f.srcdoc : '';
        const o = document.getElementById('inline-rpt-overlay'); if (o) o.remove();
        return { html, facts: _buildPackageFacts(p, ['outreach-log']).blocks[0].lines.join('\n'),
          tbl: _buildSectionPreviewTable('auto-outreach', p, '2026-03-01', '2026-03-31', false) };
      }, P);
      t.ok(/Hand-delivered · 450 reached/.test(rep.html), 'the quick report shows it');
      t.ok(/Reach recorded on 1 of \d+ actions .*: 450 in all/.test(rep.facts) && /FLYERMARK.*\[Hand-delivered · 450 reached\]/.test(rep.facts), 'AI facts carry the reach, computed');
      t.ok(/Hand-delivered · 450 reached/.test(rep.tbl), 'the PI report table shows it');
      const hl = await page.evaluate((id) => _coHighlightFacts(_syncCache.closeouts.find((c) => String(c.id) === String(id)), 'outreach').lines.join('\n'), co.id);
      t.ok(/Flyer or mailer — .*FLYERMARK.*Hand-delivered · 450 reached/.test(hl), 'the close-out outreach highlight lists the flyer');

      // ── the bulk-email tool logs an Email blast, not an event ──
      const evBefore = (await t.sql(`select count(*)::int n from pi_meetings`))[0].n;
      await page.evaluate((p) => {
        S.projectFilter = p; S._emailSubject = 'BLASTMARK construction update'; S._emailSelected = { a: 1, b: 1 }; S._emailIssue = '';
        window._emailGetAddresses = () => ['a@x.example', 'b@x.example', 'c@x.example'];
        window._emailGetContacts = () => [{ id: 'a', firstName: 'Ann', lastName: 'Able' }, { id: 'b', firstName: 'Bo', lastName: 'Bell' }];
        return logEmailAsOutreach();
      }, P);
      await t.until(async () => (await t.sql(`select count(*)::int n from pi_outreach_actions where title like 'BLASTMARK%'`))[0].n === 1, 'email logged');
      const [blast] = await t.sql(`select action_type, delivery, reach, note from pi_outreach_actions where title like 'BLASTMARK%'`);
      t.ok(blast.action_type === 'Email blast' && blast.delivery === 'Emailed' && blast.reach === 3, 'an Email blast, Emailed, reaching every address');
      t.ok(/Ann Able, Bo Bell/.test(blast.note), 'recipients go in the internal note');
      t.eq((await t.sql(`select count(*)::int n from pi_meetings`))[0].n, evBefore, 'no event is created');
      t.eq(await page.evaluate(() => { const el = document.getElementById('f-out-title'); return el ? el.value : null; }), 'BLASTMARK construction update', 'the new entry opens so the rest can be filled in');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }

    // ── the LIVE fix: moves the four 0-attendance distributions, once ──
    await t.sql(`insert into pi_meetings (id, project_id, title, meeting_date, meeting_type, location, attendance_count, handouts) overriding system value values
      (172,'16','Secondary Water Outage Notice','2026-08-11','Other','Project Website',0,'Notice with Map added to site'),
      (179,'16','Intersection Closure Flyers Delivered','2026-09-10','School or business outreach','On Site',0,'Flyer'),
      (206,'16','Access Restrictions Flyer','2026-09-21','Property owner / ROW discussion','Onsite',0,'Flyer'),
      (209,'16','Access Restrictions Flyer','2026-10-15','Property owner / ROW discussion','Onsite',12,'Flyer')`);
    const fix = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', 'fixes', '2026-10-22_move_flyer_events_to_outreach.sql'), 'utf8');
    await t.sql(fix);
    await t.sql(fix);
    const moved = await t.sql(`select action_type, delivery, title from pi_outreach_actions where note like 'Moved from Events%' order by action_date`);
    t.eq(moved.map((r) => r.action_type + '|' + r.delivery), ['Website update|Posted online', 'Flyer / door hanger|Hand-delivered', 'Flyer / door hanger|Hand-delivered'], 'moved once each (run twice), with the right type and delivery');
    t.eq((await t.sql(`select id from pi_meetings where id in (172,179,206,209) order by id`)).map((r) => Number(r.id)), [209], 'the moved events are gone; one with real attendance is left alone');
  },
};
