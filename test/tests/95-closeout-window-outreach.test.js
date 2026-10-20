// PI Close-Out step 3 (Oct 2026, Jeff): the close-out reads the Outreach log,
// and an INTERIM covers only its own dates.
//  - An interim has "Dates this interim covers" (required). Every count, chart,
//    AI fact and Outreach log entry in it is limited to those dates. A final
//    covers the whole project.
//  - Sections 3–6 (website, news, social, newsletters) fill themselves from the
//    Outreach log; the intake rows add only what the log doesn't have, and a
//    link in both prints once (a typed comment sample sits under the logged post).
//  - Editions sent = the logged newsletters in the window.
module.exports = {
  name: 'close-out — interim dates limit every count; sections 3–6 come from the Outreach log',
  async run({ t }) {
    t.seed();
    const [proj] = await t.sql(`select id from pi_projects where pid='25-LC-400N'`);
    const P = String(proj.id);
    const FROM = '2026-03-01', TO = '2026-03-31';
    // Known rows on both sides of the window, so the expected counts are exact.
    await t.sql(`insert into pi_interactions (project_id, interaction_date, channel, direction, summary) values
      ($1,'2026-03-10','Phone','Incoming','WINMARK in window'),($1,'2025-01-02','Email','Outgoing','WINMARK before window')`, [P]);
    await t.sql(`insert into pi_issues (project_id, title, status, date_raised) values ($1,'ISSUE IN WINDOW','Open','2026-03-12'),($1,'ISSUE OUTSIDE','Open','2025-01-05')`, [P]);
    const inWin = async (tbl, col) => (await t.sql(`select count(*)::int n from ${tbl} where project_id::text=$1 and ${col} between $2 and $3`, [P, FROM, TO]))[0].n;
    const all = async (tbl) => (await t.sql(`select count(*)::int n from ${tbl} where project_id::text=$1`, [P]))[0].n;
    const exp = { ints: await inWin('pi_interactions', 'interaction_date'), issues: await inWin('pi_issues', 'date_raised'),
      events: await inWin('pi_meetings', 'meeting_date'), allInts: await all('pi_interactions'), allIssues: await all('pi_issues') };

    // The Outreach log: one of each kind inside March, one news item outside.
    const act = async (date, type, title, url, outlet) => (await t.sql(`insert into pi_outreach_actions (project_id, action_date, action_type, party, title, url, outlet)
      values ($1,$2,$3,'PI team',$4,$5,$6) returning id`, [P, date, type, title, url, outlet]))[0].id;
    await act('2026-03-05', 'News coverage', 'NEWSIN closures start', 'https://www.ksl.com/a/1/', 'KSL.com');
    await act('2025-11-05', 'News coverage', 'NEWSOUT older story', 'https://www.ksl.com/a/0', 'KSL.com');
    const post = await act('2026-03-06', 'Social post', 'POSTIN weekend closures', 'https://www.instagram.com/p/abc/', 'UDOT Instagram');
    await t.sql(`insert into pi_outreach_readings (action_id, read_on, reactions, comments, source) values ($1,'2026-03-20',1863,29,'automatic'),($1,'2026-05-01',5000,90,'typed')`, [post]);
    await act('2026-03-07', 'Newsletter', 'EDITIONIN March update', 'https://mailchi.mp/x/march', null);
    await act('2026-03-08', 'Website update', 'WEBIN detour map posted', 'https://udotinput.utah.gov/x', null);
    await act('2026-03-09', '511 alert', 'ALERTIN overnight closure', null, 'UDOT Traffic');
    await act('2026-03-11', 'Press release', 'RELEASEIN work begins', 'https://news.udot.utah.gov/r', 'UDOT');

    const intake = { periodFrom: FROM, periodTo: TO, scmName: 'A Person, SCM', office: 'UDOT Region One\n1 Main', sigName: 'Me',
      news: [{ outlet: 'KSL.com', topic: 'dup of logged', url: 'http://ksl.com/a/1' }, { outlet: 'Herald Journal', topic: 'TYPEDNEWS only typed', url: 'https://hjnews.com/z' }],
      social: [{ account: 'dup', url: 'https://instagram.com/p/abc', comment: '@neighbor: COMMENTMARK thanks for the heads up' }] };
    const coI = String((await t.sql(`insert into pi_closeouts (project_id, label, intake, created_by) values ($1,'Year 1',$2::jsonb,'staff@sunrise.example') returning id`, [P, JSON.stringify(intake)]))[0].id);
    const coF = String((await t.sql(`insert into pi_closeouts (project_id, label, intake, created_by) values ($1,'Final',$2::jsonb,'staff@sunrise.example') returning id`, [P, JSON.stringify({ scmName: 'X', office: 'Y', sigName: 'Z' })]))[0].id);
    const coNoDates = String((await t.sql(`insert into pi_closeouts (project_id, label, intake, created_by) values ($1,'Year 2','{}'::jsonb,'staff@sunrise.example') returning id`, [P]))[0].id);

    const app = await t.open('index.html', { email: 'staff@sunrise.example' });
    try {
      await app.ready();
      const page = app.page;
      const facts = (cid) => page.evaluate((cid) => { const co = _syncCache.closeouts.find((c) => c.id === cid); const f = _coFactsFor(co);
        return { ints: f.interactions, issues: f.issues, events: f.events, editions: f.newsletterEditions, src: f.newsletterSource, duration: f.duration,
          news: f.outreach.news.map((x) => x.a.title), total: f.outreach.total }; }, cid);

      await t.until(() => page.evaluate(() => (DB.get('outreach_actions') || []).length >= 7), 'the Outreach log is loaded');
      // ── the window limits every count ──
      const fi = await facts(coI);
      t.eq([fi.ints, fi.issues, fi.events], [exp.ints, exp.issues, exp.events], 'interim: interactions, issues and events are counted inside the dates only');
      t.ok(exp.ints < exp.allInts && exp.issues < exp.allIssues, '(the project has more outside the window, so the limit is doing something)');
      t.eq(fi.news, ['NEWSIN closures start'], 'interim: only the outreach dated inside the window');
      t.eq([fi.editions, fi.src], [1, 'outreach'], 'editions sent = the newsletters logged in the window');
      const ff = await facts(coF);
      t.eq([ff.ints, ff.issues], [exp.allInts, exp.allIssues], 'final: the whole project');
      t.eq(ff.news.length, 2, 'final: all the outreach');

      // ── the report ──
      const doc = await page.evaluate((cid) => {
        const co = _syncCache.closeouts.find((c) => c.id === cid);
        S.projectFilter = String(co.projectId);
        const d = _coReportDoc(co);
        const text = d.blocks.map((b) => (b.text || '') + (b.runs || []).map((r) => (r.text || '') + (r.link ? ' <' + r.link + '>' : '')).join('')
          + (b.rows ? JSON.stringify(b.rows) : '')).join('\n');
        return text;
      }, coI);
      t.ok(/Covering /.test(doc), 'the interim title says which dates it covers');
      t.ok(/Period covered/.test(doc), 'Program at a Glance: "Period covered" instead of the whole programme');
      t.ok(/\(KSL\.com – NEWSIN closures start\) <https:\/\/www\.ksl\.com\/a\/1\/>/.test(doc), 'the logged news story prints as a link');
      t.ok(!/NEWSOUT/.test(doc), 'the story from before the window does not');
      t.eq((doc.match(/ksl\.com\/a\/1/g) || []).length, 1, 'the typed row with the same link prints once, not twice');
      t.ok(/TYPEDNEWS/.test(doc), 'a typed story the log doesn’t have still prints');
      t.ok(/\(UDOT Instagram – 1,863 reactions · 29 comments\)/.test(doc), 'the post prints with the counts read inside the window, not the later reading');
      t.ok(/comment sample:.*COMMENTMARK/.test(doc) && (doc.match(/instagram\.com\/p\/abc/g) || []).length === 1, 'the typed comment sample sits under the logged post; the post prints once');
      t.ok(/EDITIONIN March update/.test(doc), 'the logged newsletter edition is linked');
      t.ok(/Outreach logged \(releases, posts, coverage\)/.test(doc), 'Program at a Glance counts the outreach in the window');

      // ── AI facts follow the window and the log ──
      const ai = await page.evaluate((cid) => {
        const co = _syncCache.closeouts.find((c) => c.id === cid);
        return { social: _coHighlightFacts(co, 'social').lines, traffic: _coHighlightFacts(co, 'traffic').lines, outreach: _coHighlightFacts(co, 'outreach').lines,
          website: _coHighlightFacts(co, 'website').lines, req: (_coHighlightRequest(co, 'social') || {}).user || '', commlog: _coCommlogFacts(co).counts };
      }, coI);
      t.ok(ai.social.some((l) => /POSTIN.*1,863 reactions/.test(l)), 'social facts: the logged post with its counts');
      t.ok(ai.traffic.some((l) => /ALERTIN/.test(l)), 'traffic facts: 511 alerts from the log');
      t.ok(ai.outreach.some((l) => /RELEASEIN/.test(l)) && ai.outreach.some((l) => /NEWSIN/.test(l)) && !ai.outreach.some((l) => /NEWSOUT/.test(l)), 'outreach facts: releases and coverage in the window only');
      t.ok(ai.website.some((l) => /Website updates posted: 1/.test(l)), 'website facts: how often the site was updated');
      t.ok(/interim close-out covering/.test(ai.req), 'the AI is told which period it is writing about');
      t.ok(ai.commlog.some((l) => l === 'Total logged contacts: ' + exp.ints + '.'), 'the log summary counts the window only');

      // ── the intake ──
      await page.evaluate((cid) => { S.rptTab = 'closeout'; setView('reports'); openCloseoutIntake(cid); }, coI);
      t.ok(/From the Outreach log \(1\) \+ your entries/.test(await page.textContent('#co-st-news')), 'the News pill says it comes from the log plus typed entries');
      t.ok(/From the Outreach log \(1\)/.test(await page.textContent('#co-st-newsletters')), 'the Newsletters section is filled from the log');
      t.ok(/NEWSIN closures start/.test(await page.textContent('#co-sec-news')), 'the logged item is shown in the intake, read-only');
      // Changing the dates recounts everything.
      await page.fill('#co-f-periodFrom', '2025-01-01');
      await page.dispatchEvent('#co-f-periodFrom', 'change');
      await t.until(() => page.evaluate(() => /\(2\)/.test(document.getElementById('co-st-news').textContent)), 'widening the dates brings the older story in');
      await t.until(async () => (await t.sql(`select intake->>'periodFrom' f from pi_closeouts where id=$1`, [coI]))[0].f === '2025-01-01', 'the new date is saved');

      // An interim with no dates says so, and the report flags it.
      await page.evaluate((cid) => openCloseoutIntake(cid), coNoDates);
      t.ok(/Needs Dates covered/.test(await page.textContent('#co-st-recipient')), 'an interim without dates is missing a required field');
      const hole = await page.evaluate((cid) => _coReportDoc(_syncCache.closeouts.find((c) => c.id === cid)).blocks.some((b) => (b.runs || []).some((r) => r.hl && /Dates this interim covers/.test(r.text))), coNoDates);
      t.ok(hole, 'and its report carries a highlighted placeholder for the dates');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
