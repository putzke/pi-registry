// ROW outreach (sql/2026-10-04_row_outreach.sql) and close-out step 3.
//
// What PI staff learn before the ROW agents negotiate — who can sign for a
// parcel, how the owner received the early conversation, what they are worried
// about, when the legal description and design exhibit were shared — and how
// that reaches two very different readers:
//   - the ROW agent, through the Parcels view's Agent briefing (names and all);
//   - the client, through the close-out report (counts only, never names).
// Plus the close-out's other step-3 sections: Program at a Glance, Commitments
// to the Public and Delivery Against Scope, all rendered as real tables in the
// preview and the .docx from the same block list.
module.exports = {
  name: 'ROW outreach — agent briefing, staff-only notes, and close-out step 3 tables',
  async run({ t, db }) {
    t.seed();
    const proj = (await t.sql(`select id from pi_projects where pid='25-3W-DESIGN'`))[0];
    const projId = String(proj.id);
    // A parcel with at least two attached contacts, so "who can sign" means something.
    const multi = (await t.sql(`
      select p.id, p.parcel_number, count(o.id)::int n from pi_parcels p join pi_parcel_owners o on o.parcel_id = p.id::text
       where p.project_id='${projId}' group by p.id, p.parcel_number having count(o.id) >= 2 order by p.parcel_number limit 1`))[0];
    t.ok(multi, 'fixture: a parcel with co-owners exists');
    const parcelId = String(multi.id);
    const owners = await t.sql(`select o.stakeholder_id sid, s.last_name from pi_parcel_owners o join pi_stakeholders s on s.id::text = o.stakeholder_id
                                 where o.parcel_id='${parcelId}' order by o.id`);
    const [a, b] = owners;
    // The design-phase demo project carries no deliverables or commitments; give
    // it one deliverable and two commitments so every step-3 table has rows.
    await t.sql(`insert into pi_deliverables (project_id, title, deliverable_type, status, contracted_qty, delivered_count)
                 values ('${projId}', 'Owner outreach letters', 'Letter', 'Complete', 7, 7)`);
    await t.sql(`insert into pi_commitments (project_id, commitment, made_to, status, fulfilled_date, due_date)
                 values (${projId}, 'Route haul access off the south approach', 'Weber County', 'Fulfilled', '2026-04-03', null),
                        (${projId}, 'Send the revised exhibit to the HOA', 'Weber County', 'Open', null, '2026-11-01')`);
    const parcelTotal = (await t.sql(`select count(*)::int n from pi_parcels where project_id='${projId}'`))[0].n;
    const unowned = (await t.sql(`select count(*)::int n from pi_parcels p where p.project_id='${projId}'
                                  and not exists (select 1 from pi_parcel_owners o where o.parcel_id = p.id::text)`))[0].n;

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const page = app.page;
      await page.evaluate(pid => { S.projectFilter = pid; setView('parcels'); }, projId);
      await page.evaluate(id => openParcelModal(id), parcelId);

      // ── the modal ───────────────────────────────────────────────────────
      let m = await page.evaluate(() => ({
        rows: document.querySelectorAll('#f-pc-owners .po-row').length,
        trail: document.getElementById('f-pc-trail').textContent,
        roles: Array.from(document.querySelector('#f-pc-owners .po-row select').options).map(o => o.value),
        sent: Array.from(document.querySelector('[data-po-sent]').options).map(o => o.textContent),
        dates: !!document.getElementById('f-pcld') && !!document.getElementById('f-pcex'),
      }));
      t.eq(m.rows, owners.length, 'one outreach row per attached contact');
      t.ok(/⚠ Nobody marked as able to sign yet/.test(m.trail), 'the trail line flags that nobody can sign yet');
      t.ok(/logged contact/.test(m.trail), 'and counts the contacts logged with people on the parcel');
      t.ok(m.roles.includes('Property manager'), 'Property manager is an attachable role');
      t.eq(m.sent, ['— Not graded —', 'Willing', 'Has questions', 'Resistant', "Won't engage"], 'the ROW sentiment scale');
      t.ok(m.dates, 'legal description and design exhibit dates are on the parcel form');

      // Three quick edits on the same contact: the chain must produce ONE row, not three.
      await page.evaluate(([sa, sb]) => {
        const fire = (el, ev) => el.dispatchEvent(new Event(ev, { bubbles: true }));
        const sel = document.querySelector(`[data-po-sent="${sa}"]`); sel.value = "Won't engage"; fire(sel, 'change');
        const conc = document.querySelector(`[data-po-conc="${sa}"]`); conc.value = 'Worried about losing frontage parking'; fire(conc, 'change');
        const sign = document.querySelector(`[data-po-sign="${sa}"]`); sign.checked = true; fire(sign, 'change');
        const selB = document.querySelector(`[data-po-sent="${sb}"]`); selB.value = 'Has questions'; fire(selB, 'change');
      }, [a.sid, b.sid]);
      await page.evaluate(() => _poChain);
      await page.waitForTimeout(400);
      let rows = await t.sql(`select stakeholder_id, authorized_signer, sentiment, concerns, updated_by from pi_parcel_outreach where parcel_id='${parcelId}' order by stakeholder_id`);
      const ra = rows.find(r => r.stakeholder_id === String(a.sid)), rb = rows.find(r => r.stakeholder_id === String(b.sid));
      t.eq(rows.length, 2, 'two contacts graded → two rows, quick successive edits never duplicate one');
      t.ok(ra && ra.authorized_signer === true && ra.sentiment === "Won't engage" && ra.concerns === 'Worried about losing frontage parking',
        'can-sign, sentiment and concerns all saved on one row');
      t.eq(ra && ra.updated_by, 'putzke@demo.test', 'attributed');
      t.ok(rb && rb.sentiment === 'Has questions' && rb.authorized_signer === false, 'the co-owner graded separately');
      t.ok(/Can sign:/.test(await page.evaluate(() => document.getElementById('f-pc-trail').textContent)),
        'the trail line now names who can sign');

      // Document dates save with the parcel.
      await page.evaluate(() => {
        document.getElementById('f-pcld').value = '2026-09-02';
        document.getElementById('f-pcex').value = '2026-09-09';
        return saveParcel();
      });
      await page.waitForTimeout(400);
      const pd = (await t.sql(`select legal_desc_shared::text l, exhibit_shared::text e from pi_parcels where id=${parcelId}`))[0];
      t.eq([pd.l, pd.e], ['2026-09-02', '2026-09-09'], 'legal description and exhibit dates saved');

      // Detach and re-attach: what was learned stays (keyed by parcel + contact).
      await page.evaluate(id => openParcelModal(id), parcelId);
      const linkB = (await t.sql(`select id from pi_parcel_owners where parcel_id='${parcelId}' and stakeholder_id='${b.sid}'`))[0].id;
      await page.evaluate(([l, p]) => detachOwner(String(l), p), [linkB, parcelId]);
      await page.evaluate(([p, sid]) => { const s = document.getElementById('f-pc-addowner'); s.value = sid; return attachOwner(p); }, [parcelId, b.sid]);
      await page.waitForTimeout(300);
      t.eq(await page.evaluate(sid => document.querySelector(`[data-po-sent="${sid}"]`).value, b.sid), 'Has questions',
        're-attaching a contact brings back their grade');

      // ── the agent briefing ──────────────────────────────────────────────
      const brief = await page.evaluate(() => ({ cols: _rowBriefCols(false).map(c => c.h), rows: _rowBriefRows(), print: _rowBriefRows(true) }));
      const col = h => brief.cols.indexOf(h);
      t.ok(brief.rows.every(r => r.length === brief.cols.length), 'every briefing row matches its headers');
      const ownerLinks = (await t.sql(`select count(*)::int n from pi_parcel_owners o join pi_parcels p on o.parcel_id = p.id::text where p.project_id='${projId}'`))[0].n;
      t.eq(brief.rows.length, ownerLinks + unowned, 'one row per parcel × contact, plus one per parcel with nobody attached');
      t.ok(brief.rows.some(r => r[col('Contact')] === '⚠ No contact identified'), 'a parcel with no contact is listed, flagged');
      const forParcel = brief.rows.filter(r => r[col('Parcel #')] === multi.parcel_number);
      const rowA = forParcel.find(r => r[col('Contact')].includes(a.last_name));
      t.eq(rowA[col('Can sign')], 'Yes', 'the authorised party reads Yes');
      t.eq(rowA[col('Sentiment')], "Won't engage", 'with their grade');
      t.eq(rowA[col('Concerns')], 'Worried about losing frontage parking', 'and their concerns');
      t.ok(forParcel.filter(r => r !== rowA).every(r => r[col('Can sign')] === ''), 'co-owners on a parcel that HAS a signer are left blank, not flagged');
      t.ok(brief.rows.some(r => r[col('Can sign')] === '⚠ No signer yet'), 'a parcel where nobody can sign yet is flagged');
      t.ok(brief.rows.some(r => r[col('Sentiment')] === 'Not graded'), 'an ungraded contact reads Not graded');
      t.eq(rowA[col('Legal desc. shared')], '2026-09-02', 'the file keeps ISO dates so they sort');
      t.eq(brief.print.find(r => r[col('Contact')].includes(a.last_name))[col('Legal desc. shared')], '09-02-2026', 'print reads mm-dd-yyyy');
      t.ok(Number(rowA[col('Contacts logged')]) >= 0, 'contacts logged is a count');

      const xl = await page.evaluate(async () => {
        const real = URL.createObjectURL.bind(URL); let blob = null;
        URL.createObjectURL = x => { blob = x; return real(x); };
        HTMLAnchorElement.prototype.click = function () {};
        exportRowRegisterXlsx();
        for (let i = 0; i < 50 && !blob; i++) await new Promise(r => setTimeout(r, 100));
        URL.createObjectURL = real;
        const zip = await JSZip.loadAsync(blob);
        return { book: await zip.file('xl/workbook.xml').async('string'), s3: !!zip.file('xl/worksheets/sheet3.xml') };
      });
      t.ok(/name="Agent briefing"/.test(xl.book) && xl.s3, 'the .xlsx carries an Agent briefing sheet');
      t.ok(/Agent briefing/.test(await page.evaluate(() => { let h = ''; const o = window.showInlineReport; window.showInlineReport = x => { h = x; }; printRowRegister(); window.showInlineReport = o; return h; })),
        'and the printed register has the briefing table');

      // ── never the portal ────────────────────────────────────────────────
      t.ok(!require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'client-portal.html'), 'utf8').includes('pi_parcel_outreach'),
        'client-portal.html never reads the outreach notes');

      // ── close-out step 3 ────────────────────────────────────────────────
      const coId = String((await t.sql(`insert into pi_closeouts (project_id, label, intake, created_by)
        values (${projId}, 'Final', '{"scmName":"Mitch Shaw","office":"1 Main St","sigName":"Jeff","customMetrics":[{"label":"Door hangers","value":"240"}],"draft":{"row":"We traced every parcel to the party who could sign."}}'::jsonb, 'putzke@demo.test') returning id`))[0].id);
      await page.evaluate(() => closeM());
      await page.evaluate(async ([pid, id]) => {
        cacheClear('closeouts'); _syncCache.closeouts = await sbGet('closeouts');
        S.projectFilter = pid; S.rptTab = 'closeout'; setView('reports'); openCloseoutReport(id);
      }, [projId, coId]);
      t.ok(await page.evaluate(() => !!document.getElementById('co-preview')), 'the close-out report opens');
      const pv = await page.evaluate(() => ({
        text: document.getElementById('co-preview').innerText,
        tables: document.querySelectorAll('#co-preview table.co-doc-tbl').length,
        heads: Array.from(document.querySelectorAll('#co-preview table.co-doc-tbl')).map(t => Array.from(t.querySelectorAll('th')).map(h => h.textContent).join('|')),
        rowPill: document.getElementById('co-rs-row').textContent,
      }));
      t.ok(pv.heads.includes('Metric|Result'), 'Program at a Glance is a table');
      t.ok(pv.text.includes('Right-of-way parcels') && pv.text.includes('Door hangers') && pv.text.includes('240 †'),
        'it includes parcels and a custom metric, the custom one marked † as not counted in Cirrus Cc');
      t.ok(pv.text.includes('† Figure from the PI team'), 'with the † footnote');
      t.ok(pv.text.includes('Right-of-Way & Property Owner Outreach:') && /In the report/.test(pv.rowPill), 'the ROW section is in the report');
      t.ok(pv.text.includes('We traced every parcel to the party who could sign.'), 'with its narrative');
      t.ok(new RegExp('Parcels in the acquisition / easement area\\s+' + parcelTotal).test(pv.text), 'total parcels counted');
      t.ok(new RegExp('Owner identified\\s+' + (parcelTotal - unowned) + ' of ' + parcelTotal).test(pv.text), 'owners identified counted');
      t.ok(new RegExp('Party with authority to sign identified\\s+1 of ' + parcelTotal).test(pv.text), 'parcels with a signer counted');
      t.ok(/Owner sentiment \(2 graded\)\s+Has questions 1 · Won't engage 1 · not graded \d+/.test(pv.text), 'sentiment summarised as counts');
      t.ok(new RegExp('Legal description shared\\s+1 of ' + parcelTotal).test(pv.text), 'documents shared counted');
      t.ok(!owners.some(o => pv.text.includes(o.last_name)), 'no owner surname appears anywhere in the client report');
      t.ok(!pv.text.includes('frontage parking'), 'nor any owner concern');
      t.ok(pv.heads.includes('Committed Deliverable|Status|Evidence in this Package'), 'Delivery Against Scope is a table');
      const comms = (await t.sql(`select count(*)::int n from pi_commitments where project_id=${projId}`))[0].n;
      t.ok(pv.heads.includes('Commitment|Made to|Outcome') && comms === 2, 'Commitments to the Public is a table');
      t.ok(pv.text.includes('2 commitments were made to the public during the project; 1 was kept and 1 remains outstanding.'), 'with a counted intro sentence');
      t.ok(pv.text.includes('Kept 04/03/2026') && pv.text.includes('Outstanding — due 11/01/2026'), 'each outcome dated');
      t.ok(pv.text.includes('Owner outreach letters (7 delivered)'), 'a quantity deliverable states what was delivered, never over/under');
      t.ok(pv.text.includes('[evidence not named]'), 'a deliverable with no evidence named is highlighted');

      const holes = await page.evaluate(id => _coHoleCount(_coReportDoc(_syncCache.closeouts.find(c => c.id === id)).blocks), coId);
      const dels = (await t.sql(`select count(*)::int n from pi_deliverables where project_id='${projId}'`))[0].n;
      t.ok(holes >= dels, 'a deliverable with no evidence named counts as a placeholder at export (table cells included)');

      const d = await page.evaluate(async () => {
        window.confirm = () => true; HTMLAnchorElement.prototype.click = function () {};
        const blob = await exportCloseoutDocx(); const zip = await JSZip.loadAsync(blob);
        return zip.file('word/document.xml').async('string');
      });
      t.ok((d.match(/<w:tbl>/g) || []).length >= 3, 'the .docx carries real Word tables');
      t.ok(/<w:tblHeader\/>/.test(d), 'whose header row repeats across pages');
      t.ok(/w:fill="1F3955"/.test(d), 'in the navy header style');
      t.ok(!owners.some(o => d.includes(o.last_name)), 'and no owner surname reaches the .docx either');

      // A project with no parcels leaves the section out, and says so.
      const logan = String((await t.sql(`select id from pi_projects where pid='25-LC-400N'`))[0].id);
      const out = await page.evaluate(pid => _coReportDoc({ id: 'x', projectId: pid, intake: {} }).sections.find(s => s.id === 'row'), logan);
      t.eq([out.state, out.why], ['out', 'No parcels on this project.'], 'no parcels → ROW section left out, with the reason');
      t.eq(app.errors, [], 'no page errors');
    } finally {
      await app.close();
    }

    // ── staff-only, for real: anon and a portal client can't read the notes ──
    const c = await db.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into pi_client_access (email, project_id) values ('client@x.example', ${projId})`);
      await c.query('savepoint sp');
      await c.query('set role anon');
      let denied = false;
      try { await c.query('select * from pi_parcel_outreach'); } catch (e) { denied = /permission denied/.test(e.message); }
      await c.query('rollback to savepoint sp');
      t.ok(denied, 'anon: SELECT on pi_parcel_outreach is refused outright');
      await c.query('set role authenticated');
      await c.query(`set request.jwt.claims to '{"email":"client@x.example"}'`);
      const r1 = await c.query('select count(*)::int n from pi_parcel_outreach');
      t.eq(r1.rows[0].n, 0, 'a granted portal client on this very project sees no outreach rows');
      await c.query(`set request.jwt.claims to '{"email":"staff@sunrise.example"}'`);
      const r2 = await c.query('select count(*)::int n from pi_parcel_outreach');
      t.ok(r2.rows[0].n >= 2, 'staff see them');
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  },
};
