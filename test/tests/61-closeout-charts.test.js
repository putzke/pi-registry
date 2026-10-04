// PI Close-Out, step 6: Stakeholder Engagement in Figures.
//
// Charts are drawn once as SVG; the preview shows that SVG and the .docx gets
// the same SVG rasterized to PNG. This checks:
//   - every number a chart or table shows is the database's count
//     (monthly outbound/inbound, channel totals, inbound-only subjects, issues);
//   - the subject and type charts name no person (types and organizations only);
//   - a chart without enough data is left out and the report screen says why;
//   - the .docx carries one PNG per figure, wired through relationships and a
//     png content type (the Sunrise template had none), with the inline extent
//     and the picture's own extent in agreement so Word doesn't stretch it.
module.exports = {
  name: 'close-out charts — computed figures, privacy, omission, .docx images',
  async run({ t }) {
    t.seed();
    const proj = (await t.sql(`select id from pi_projects where pid='25-LC-400N'`))[0];
    const projId = String(proj.id);
    const n = async q => (await t.sql(q))[0].n;
    const total = await n(`select count(*)::int n from pi_interactions where project_id='${projId}'`);
    const out = await n(`select count(*)::int n from pi_interactions where project_id='${projId}' and direction='Outgoing'`);
    const dated = await n(`select count(*)::int n from pi_interactions where project_id='${projId}' and interaction_date is not null`);
    const issues = await n(`select count(*)::int n from pi_issues where project_id='${projId}'`);
    const names = (await t.sql(`select s.first_name, s.last_name from pi_stakeholders s join pi_project_stakeholders ps on ps.stakeholder_id = s.id::text
      where ps.project_id='${projId}' and coalesce(s.first_name,'') <> '' and coalesce(s.last_name,'') <> ''`)).map(r => r.first_name + ' ' + r.last_name);
    const intake = { route: 'SR-30', visits: [{ when: 'Jun 2025', visits: '400' }] };
    const id = String((await t.sql(`insert into pi_closeouts (project_id, label, intake, created_by)
      values (${projId}, 'Final', $1::jsonb, 'putzke@demo.test') returning id`, [JSON.stringify(intake)]))[0].id);

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const page = app.page;
      await page.evaluate(([pid, cid]) => { S.projectFilter = pid; S.rptTab = 'closeout'; setView('reports'); openCloseoutReport(cid); }, [projId, id]);
      const co = () => 'co = _syncCache.closeouts.find(c => c.id === _coWork.id)';

      // ── the numbers are the database's ──────────────────────────────────
      const mo = await page.evaluate(pid => _coMonthly(DB.get('interactions').filter(i => String(i.projectId) === pid)), projId);
      const sum = a => a.reduce((x, y) => x + y, 0);
      t.eq(sum(mo.a) + sum(mo.b), dated, 'monthly chart counts every dated interaction once');
      t.eq(sum(mo.a), out, 'outbound series = Outgoing interactions');
      t.eq(mo.undated, total - dated, 'undated interactions are counted for the note');
      t.ok(mo.labels.length >= 2 && /^[A-Z][a-z]{2} ’\d\d$/.test(mo.labels[0]), 'months labelled like "Jun ’25": ' + mo.labels[0]);

      const F = await page.evaluate(() => { const co = _syncCache.closeouts.find(c => c.id === _coWork.id); return _coFigures(co, _coWork.intake); });
      const tables = F.blocks.filter(b => b.t === 'table');
      const charts = F.blocks.filter(b => b.t === 'chart');
      const chTbl = tables.find(b => b.cols[0].h === 'Channel');
      const totalRow = chTbl.rows[chTbl.rows.length - 1].map(c => c[0].text.replace(/,/g, ''));
      t.eq(totalRow, ['Total', String(out), String(total - out), String(total)], 'channel table total row matches the database');
      const issTbl = tables.find(b => b.cols[0].h === 'Issue');
      t.eq(issTbl ? issTbl.rows.length : 0, issues, 'one issues-table row per issue');
      t.eq(charts.length, 3, 'three charts with one website reading (monthly, subjects, types)');
      t.ok(F.out.some(w => /website chart needs two or more/.test(w)), 'the missing website chart is explained');

      // Subject bars are inbound only: bars + the "plus N" note = inbound total.
      const subj = await page.evaluate(() => {
        const co = _syncCache.closeouts.find(c => c.id === _coWork.id);
        const inn = DB.get('interactions').filter(i => String(i.projectId) === String(co.projectId) && i.direction !== 'Outgoing');
        return { inbound: inn.length };
      });
      const sBars = [...charts[1].svg.matchAll(/<text[^>]*fill="#0b0b0b"[^>]*>([\d,]+)<\/text>/g)].map(m => +m[1].replace(/,/g, ''));
      const noteIdx = F.blocks.indexOf(charts[1]) + 1;
      const plus = F.blocks[noteIdx] && F.blocks[noteIdx].t === 'p' ? +((F.blocks[noteIdx].runs[0].text.match(/^Plus ([\d,]+)/) || [0, '0'])[1].replace(/,/g, '')) : 0;
      t.eq(sum(sBars) + plus, subj.inbound, 'subject bars plus the tail note account for every inbound contact');

      // ── privacy: no person named in any chart ───────────────────────────
      t.ok(names.length > 0, 'fixture: the project has named stakeholders');
      const allSvg = charts.map(c => c.svg).join('');
      t.eq(names.filter(nm => allSvg.includes(nm)), [], 'no stakeholder’s name appears in any chart');

      // ── preview ─────────────────────────────────────────────────────────
      await page.waitForTimeout(350);
      const pv = await page.evaluate(() => ({
        figs: document.querySelectorAll('#co-preview .co-fig svg').length,
        text: document.getElementById('co-preview').innerText,
        pill: document.getElementById('co-rs-figures').textContent,
      }));
      t.eq(pv.figs, 3, 'the preview shows the three charts');
      t.ok(/Stakeholder Engagement in Figures:/.test(pv.text) && /Figure 1\. Logged stakeholder contacts per month/.test(pv.text), 'section heading and numbered captions');
      t.ok(/In the report/.test(pv.pill) && /website chart needs/.test(pv.pill), 'the pill says it is in, and why the website chart is not');

      // ── a second reading adds the website chart ─────────────────────────
      await page.evaluate(() => { _coWork.intake.visits = [{ when: 'Jun 2025', visits: '400' }, { when: 'Oct 2026', visits: '1,240' }]; _coRenderPreview(); });
      t.eq(await page.evaluate(() => document.querySelectorAll('#co-preview .co-fig svg').length), 4, 'two readings draw the website chart');
      const vp = await page.evaluate(() => _coVisitPoints([{ when: '2026-03', visits: '9' }, { when: 'Jun 2025', visits: '1,000' }, { when: '10/2025', visits: '5' }]));
      t.ok(vp.timed && vp.pts.map(p => p.v).join() === '1000,5,9', 'readings are placed in time, whatever order they were typed in');
      const vu = await page.evaluate(() => _coVisitPoints([{ when: 'Week 3', visits: '10' }, { when: 'Week 9', visits: '30' }]));
      t.ok(!vu.timed && vu.pts.map(p => p.x).join() === '0,1', 'undatable readings fall back to the order entered');

      // ── a project with nothing logged ───────────────────────────────────
      const empty = await page.evaluate(() => _coFigures({ projectId: '99999999' }, {}));
      t.eq(empty.blocks.length, 0, 'no data, no section');
      t.ok(empty.out.some(w => /No interactions logged/.test(w)), 'and it says why');

      // ── the .docx ───────────────────────────────────────────────────────
      const d = await page.evaluate(async () => {
        window.confirm = () => true;
        const sel = document.querySelector('select[data-k="letterhead"]');
        sel.value = 'sunrise'; sel.dispatchEvent(new Event('change', { bubbles: true }));
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {};
        const blob = await exportCloseoutDocx();
        HTMLAnchorElement.prototype.click = click;
        const zip = await JSZip.loadAsync(blob);
        const pngs = Object.keys(zip.files).filter(f => /^word\/media\/coChart\d+\.png$/.test(f)).sort();
        const sig = await Promise.all(pngs.map(async f => Array.from((await zip.file(f).async('uint8array')).slice(0, 8)).join(',')));
        return {
          pngs, sig,
          doc: await zip.file('word/document.xml').async('string'),
          rels: await zip.file('word/_rels/document.xml.rels').async('string'),
          ct: await zip.file('[Content_Types].xml').async('string'),
        };
      });
      t.eq(d.pngs.length, 4, 'one PNG per figure');
      t.ok(d.sig.every(s => s === '137,80,78,71,13,10,26,10'), 'each is a real PNG');
      t.ok(/<Default Extension="png" ContentType="image\/png"\/>/.test(d.ct), 'png content type registered');
      t.ok([1, 2, 3, 4].every(i => d.rels.includes('Id="rIdCoImg' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/coChart' + i + '.png"')),
        'each image has its relationship');
      const drawings = d.doc.match(/<w:drawing>[\s\S]*?<\/w:drawing>/g).filter(x => /rIdCoImg/.test(x));
      t.eq(drawings.length, 4, 'four inline pictures in the body');
      t.ok(drawings.every(x => { const a = x.match(/<wp:extent cx="(\d+)" cy="(\d+)"/), b = x.match(/<a:ext cx="(\d+)" cy="(\d+)"/); return a && b && a[1] === b[1] && a[2] === b[2]; }),
        'inline extent and picture extent agree (no stretching)');
      t.ok(drawings.every(x => /<wp:extent cx="5943600"/.test(x)), '6.5 inches wide');
      const ids = [...d.doc.matchAll(/<wp:docPr id="(\d+)"/g)].map(m => m[1]);
      t.eq(new Set(ids).size, ids.length, 'drawing ids are unique');
      t.ok(/<w:keepNext\/>[\s\S]{0,400}Figure 1\. /.test(d.doc), 'captions keep with their figure');
      t.eq(app.errors, [], 'no page errors');
    } finally {
      await app.close();
    }
  },
};
