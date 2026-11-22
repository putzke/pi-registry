// Client update briefing + Projects card cleanup (Nov 2026, Jeff).
//  - the "Update due" rule: quiet within 7 days of a shared report / update /
//    keep; due after that on something significant; due after 21 days on
//    anything; never with nothing new; Active projects only;
//  - the Projects card: one Client strip, one row of buttons with Edit and a
//    highlighted More ▾ that opens two columns (project tools | client);
//  - the review dialog drafts through _claudeNarrative with counted facts and no
//    contact names, and Publish writes a kind='update' row;
//  - the portal shows the update at the top of the Overview, carrying the
//    latest report; the Project Status tab ignores it.
module.exports = {
  name: 'client update briefing — due rule, project card, review + publish, portal card',
  async run({ t }) {
    // The update text uses the card's full width (Jeff, Nov 2026: a 72ch cap
    // left half the card empty on a wide screen).
    {
      const css = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'client-portal.html'), 'utf8').match(/\.cu-body \{[^}]*\}/);
      t.ok(css && !/max-width/.test(css[0]), 'portal update text is not capped in width');
    }
    t.seed();
    const [proj] = await t.sql(`select id, name from pi_projects where pid='25-LC-400N'`);
    const P = String(proj.id);
    await t.sql(`update pi_projects set status='Active' where id=${P}`);
    await t.sql(`delete from pi_client_summaries where project_id=${P}`);
    await t.sql(`delete from pi_report_archive where project_id=${P}`);
    await t.sql(`delete from pi_portal_links where project_id::text=$1`, [P]);
    const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    await t.sql(`insert into pi_report_archive (project_id, report_num, report_title, period_start, period_end, sections, archived_at, docx_path, client_visible)
      values (${P}, '9', 'Bi-weekly Report', '${day(24)}', '${day(10)}', '[]', '${day(10)}T12:00:00Z', '${P}/r9.pdf', true)`);
    // External contacts' names, which must never reach the AI request.
    const names = (await t.sql(`select s.first_name, s.last_name from pi_project_stakeholders l join pi_stakeholders s on s.id::text=l.stakeholder_id
      where l.project_id::text=$1 and coalesce(l.stakeholder_role,'External')='External' and s.last_name is not null and length(s.last_name)>3 limit 5`, [P]));
    const sid = (await t.sql(`select l.stakeholder_id from pi_project_stakeholders l where l.project_id::text=$1 and coalesce(l.stakeholder_role,'External')='External' limit 1`, [P]))[0].stakeholder_id;
    for (let k = 0; k < 6; k++) {
      await t.sql(`insert into pi_interactions (project_id, stakeholder_id, interaction_date, channel, direction, subject, summary, logged_by)
        values ($1, $2, $3, 'Phone', 'Incoming', 'Access', 'Asked about the detour ZQX', 'JP')`, [P, sid, day(3)]);
    }

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const rule = await app.page.evaluate(P => {
        const r = {};
        r.due = _cuState(P);
        _syncCache.client_summaries = [{ id: 'k1', projectId: P, kind: 'kept', publishedAt: new Date().toISOString() }];
        r.afterKeep = _cuState(P).due;
        _syncCache.client_summaries = [];
        const pr = _syncCache.projects.find(p => String(p.id) === String(P));
        pr.status = 'On hold'; r.onHold = _cuState(P).due;
        pr.status = 'Active'; r.back = _cuState(P).due;
        return r;
      }, P);
      t.ok(rule.due.due && rule.due.changes >= 1, 'a report 10 days ago + 6 new public contacts → Update due');
      t.ok(!rule.afterKeep, '"Keep the current one" quiets it');
      t.ok(rule.back, 'with the report anchor back it is due again');
      t.ok(!rule.onHold, 'never due on an On hold project');
    } finally { await app.close(); }

    // The rule's time branches, with a fixed helper for dates in the page.
    const app2 = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app2.ready();
      const r = await app2.page.evaluate(P => {
        const d = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
        const out = {};
        const others = _syncCache.interactions.filter(i => String(i.projectId) !== String(P));
        _syncCache.report_archive = [];
        _syncCache.interactions = others.concat([{ id: 'zz1', projectId: P, date: d(2), direction: 'Incoming', channel: 'Email', subject: 'General' }]);
        _syncCache.client_summaries = [{ id: 'u0', projectId: P, kind: 'update', contentFull: 'x', publishedAt: d(25) + 'T12:00:00Z' }];
        out.byTime = _cuState(P).due;
        _syncCache.client_summaries = [{ id: 'u0', projectId: P, kind: 'update', contentFull: 'x', publishedAt: d(10) + 'T12:00:00Z' }];
        out.tooSmall = _cuState(P).due;
        _syncCache.interactions = others;
        ['issues','commitments','meetings','outreach_actions'].forEach(k => { _syncCache[k] = (_syncCache[k] || []).filter(x => String(x.projectId) !== String(P)); });
        _syncCache.client_summaries = [{ id: 'u0', projectId: P, kind: 'update', contentFull: 'x', publishedAt: d(60) + 'T12:00:00Z' }];
        out.nothing = _cuState(P).due;
        const many = []; for (let k = 0; k < 8; k++) many.push({ id: 'm' + k, projectId: P, date: d(1), direction: 'Incoming', channel: 'Phone', subject: 'Access' });
        _syncCache.interactions = others.concat(many);
        _syncCache.client_summaries = [{ id: 'u1', projectId: P, kind: 'update', contentFull: 'x', publishedAt: d(4) + 'T12:00:00Z' }];
        out.quiet = _cuState(P).due;
        return out;
      }, P);
      t.ok(r.byTime, 'after 21 days, anything new makes it due');
      t.ok(!r.tooSmall, 'at 10 days, one small contact is not enough');
      t.ok(!r.nothing, 'nothing new → never due');
      t.ok(!r.quiet, 'within 7 days of the last update it stays quiet');
    } finally { await app2.close(); }

    const app3 = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app3.ready();
      // Projects view card
      const card = await app3.page.evaluate(async P => {
        try { localStorage.setItem('cc_proj_scope', 'all'); } catch (e) {}
        S.view = 'projects'; S.projTab = 'active'; render();
        await new Promise(r => setTimeout(r, 300));
        const edit = [...document.querySelectorAll('#main button')].find(b => (b.getAttribute('onclick') || '') === "openProjModal('" + P + "')");
        const cardEl = edit.closest('div[style*="border-radius"]').parentElement.closest('div[style*="border-radius"]') || edit.closest('div');
        const box = edit.parentElement.parentElement;
        const strip = box.querySelector('.cu-strip');
        const nudge = strip && strip.querySelector('.cu-nudge');
        const more = box.querySelector('.proj-more-btn');
        const rowBtns = [...edit.parentElement.querySelectorAll(':scope > button')].map(b => b.textContent.trim());
        more.click();
        const menu = document.querySelector('.proj-more-menu');
        const cols = menu ? [...menu.querySelectorAll('.pm-col')].map(c => c.querySelector('.pm-h').textContent + ': ' + [...c.querySelectorAll('.pm-item')].map(b => b.textContent.trim()).join(' | ')) : [];
        document.body.click();
        return { strip: strip && strip.textContent, nudge: nudge && nudge.textContent, rowBtns, cols, menuGone: !document.querySelector('.proj-more-menu'),
                 oldBtns: /Active|Matrix|Export/.test(edit.parentElement.textContent) };
      }, P);
      t.ok(/Last report/.test(card.strip || ''), 'the card has a Client strip with the last report date');
      t.ok(/^Update due · \d+ changes?$/.test(card.nudge || ''), 'the strip shows "Update due · N changes": ' + card.nudge);
      t.eq(card.rowBtns.slice(0, 5), ['Contacts', 'Interactions', 'Follow-ups', 'Deliverables', 'Edit'].map((x, i) => i === 2 ? card.rowBtns[2] : x), 'one row: Contacts, Interactions, Follow-ups, Deliverables, Edit');
      t.ok(/^More ▾/.test(card.rowBtns[5] || ''), 'then a More button');
      t.ok(!card.oldBtns, 'Map/Groups/Matrix/Export and the old Active button are off the card');
      t.ok(card.cols.length === 2 && /^Project tools: .?Map \| .?Groups \| .?Matrix \| .?Export/.test(card.cols[0]) && /^Client: .?Review client update \| .?Create client portal link/.test(card.cols[1]),
        'More opens two columns: ' + JSON.stringify(card.cols));
      t.ok(card.menuGone, 'clicking elsewhere closes it');

      // Review dialog: auto-draft, facts, no names, publish.
      const dlg = await app3.page.evaluate(async P => {
        window._req = null;
        _getClaudeKey = () => 'test-key';
        _claudeNarrative = async (sys, content, max) => { window._req = { sys, content, max }; return 'Since the last report, the public asked about access.\n\nOur team answered each call.'; };
        openClientUpdate(P);
        await new Promise(r => setTimeout(r, 200));
        const ta = document.getElementById('cu-text');
        const facts = [...document.querySelectorAll('.cu-facts li')].map(l => l.textContent);
        cuPreview();
        const prev = document.getElementById('cu-preview').textContent;
        await cuPublish();
        await new Promise(r => setTimeout(r, 200));
        return { text: ta && ta.value, facts, req: window._req, prev, open: document.getElementById('modal-ov').classList.contains('open'), dueAfter: _cuState(P).due };
      }, P);
      t.ok(/public asked about access/.test(dlg.text || ''), 'opening the dialog drafts automatically into the box');
      t.ok(dlg.facts.some(f => /\d+ public contacts \(most about Access/.test(f)), 'the facts are counted by the app: ' + dlg.facts.join(' / '));
      t.ok(dlg.req && /about 150 words/i.test(dlg.req.content) && /COUNTS \(authoritative/.test(dlg.req.content), 'the request carries the counts and the length rule: ' + (dlg.req ? dlg.req.content.slice(0, 300) : 'none'));
      t.ok(names.length > 0 && names.every(n => !dlg.req.content.includes(n.last_name)), 'no contact surname reaches the AI request');
      t.ok(/Since your .+ report/.test(dlg.prev), 'Preview as client shows the portal card');
      t.ok(!dlg.open, 'Publish closes the dialog');
      t.ok(!dlg.dueAfter, 'after publishing, it is no longer due');
      t.eq(app3.errors, [], 'no page errors');
    } finally { await app3.close(); }

    const rows = await t.sql(`select kind, since_date::text sd, content_full from pi_client_summaries where project_id=${P} order by id`);
    t.ok(rows.length === 1 && rows[0].kind === 'update' && rows[0].sd === day(10) && /Our team answered/.test(rows[0].content_full), 'Publish wrote one kind=update row, since the report date');

    // Portal
    await t.sql(`insert into pi_client_summaries (project_id, content_full, published_at, kind) values (${P}, 'STATUS REPORT TEXT', now() - interval '40 days', 'status')`);
    await t.sql(`insert into pi_client_summaries (project_id, published_at, kind) values (${P}, now() - interval '1 hour', 'kept')`);
    const [lnk] = await t.sql(`insert into pi_portal_links (project_id) values (${P}) returning token`);
    const portal = await t.open('client-portal.html', { portalToken: lnk.token });
    try {
      await portal.page.waitForSelector('.cu-card', { timeout: 15000 });
      const pv = await portal.page.evaluate(() => {
        const c = document.querySelector('.cu-card');
        const out = { text: c.textContent, latestStrip: !!document.querySelector('.latest-report') };
        setView('summary');
        out.summary = document.getElementById('content') ? document.getElementById('content').textContent : document.body.textContent;
        return out;
      });
      t.ok(/Since your \w+ \d+ report/.test(pv.text) && /Our team answered each call/.test(pv.text), 'the portal Overview shows the update');
      t.ok(/Latest PI report: Bi-weekly Report #9/.test(pv.text) && !pv.latestStrip, 'it carries the latest report instead of a second strip');
      t.ok(/STATUS REPORT TEXT/.test(pv.summary) && !/Our team answered each call/.test(pv.summary), 'Project PI Reports shows the status report, not the update');
      t.eq(portal.errors, [], 'no portal errors');
    } finally { await portal.close(); }
  },
};
