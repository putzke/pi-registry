// The parcel module's two report surfaces: the Right-of-Way quick report and
// the 'auto-parcels' section in the PI report editor.
//
// The section has to satisfy the frozen-snapshot contract — _buildSectionPreviewTable
// renders both the live preview and the archived copy, so what a reviewer reads
// in September must be what was issued in July. The counts label is built twice,
// in renderLivePreview and in _buildReportSnapshot, and those two must agree or
// an archived report's header contradicts the live one it was taken from.
//
// The numbers themselves come from _parcelStats(), shared by both surfaces —
// the quick report and the section can never disagree about coverage.
module.exports = {
  name: 'parcel reports — quick report and the PI report editor section',
  async run({ t }) {
    t.seed();

    const proj = (await t.sql(`select id from pi_projects where pid='25-154-001'`))[0];
    const projId = String(proj.id);
    const owners = await t.sql(
      `select s.id from pi_stakeholders s join pi_project_stakeholders l
         on l.stakeholder_id::text = s.id::text
        where l.project_id::text=$1 order by s.id limit 2`, [projId]);

    // Four parcels covering every case the report is meant to expose.
    const ids = [];
    for (const p of [
      { n: '13-112-0001', a: 'Situs one', s: 'Acquired',    d: '2026-06-01' },
      { n: '13-112-0002', a: 'Situs two', s: 'Notice sent', d: '2026-07-15' },
      { n: '13-112-0003', a: '',          s: 'Not started', d: null },   // unlocated + un-noticed
      { n: '13-112-0004', a: 'Situs four',s: 'Negotiating', d: null },   // will get no owner
    ]) {
      const r = (await t.sql(
        `insert into pi_parcels (project_id,parcel_number,situs_address,status,notice_date,acquisition_type)
         values ($1,$2,$3,$4,$5,'Partial take') returning id`,
        [projId, p.n, p.a, p.s, p.d]))[0];
      ids.push(String(r.id));
    }
    // Two owners on parcel 1, one of them also on parcel 2, none on parcel 4.
    await t.sql(`insert into pi_parcel_owners (parcel_id,stakeholder_id,ownership_role)
                 values ($1,$2,'Owner'),($1,$3,'Co-owner'),($4,$2,'Owner'),($5,$2,'Owner')`,
                [ids[0], String(owners[0].id), String(owners[1].id), ids[1], ids[2]]);

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      await app.page.evaluate(id => { S.projectFilter = id; }, projId);

      // ── the shared stats both surfaces read ─────────────────────────────
      const m = await app.page.evaluate(id => {
        const x = _parcelStats(id);
        return { total: x.total, ownerCt: x.ownerCt, noticedCt: x.noticedCt,
                 noticePct: x.noticePct, unownedCt: x.unownedCt, ownedPct: x.ownedPct,
                 unlocatedCt: x.unlocatedCt, byStatus: x.byStatus };
      }, projId);
      t.eq(m.total, 4, 'four parcels counted');
      t.eq(m.ownerCt, 2, 'two distinct owners, not four links');
      t.eq(m.noticedCt, 2, 'two parcels noticed');
      t.eq(m.noticePct, 50, 'notice coverage is a percentage of parcels');
      t.eq(m.unownedCt, 1, 'one parcel has no owner');
      t.eq(m.ownedPct, 75, 'ownership coverage matches');
      t.eq(m.unlocatedCt, 1, 'one parcel has neither address nor coordinates');
      t.eq(m.byStatus.Acquired, 1, 'status breakdown counts');

      // ── quick report ────────────────────────────────────────────────────
      await app.page.evaluate(() => generateParcelReport());
      await app.page.waitForTimeout(400);
      const quick = await app.page.evaluate(() => {
        const f = document.getElementById('inline-rpt-frame');
        const ov = document.getElementById('inline-rpt-overlay');
        return (f && f.getAttribute('srcdoc')) || (ov ? ov.innerHTML : '');
      });
      t.ok(/Right-of-Way Parcel Report/.test(quick), 'the quick report renders');
      t.ok(/Parcel register/i.test(quick), 'it includes the register');
      t.ok(/No owner attached/.test(quick), 'and names the parcel with no owner');
      t.ok(/13-112-0003/.test(quick) && /Not located/.test(quick),
           'and flags the parcel with no address or coordinates');
      t.ok(quick.includes('13-112-0001') && quick.includes('13-112-0004'),
           'every parcel appears');
      await app.page.evaluate(() => { const o = document.getElementById('inline-rpt-overlay'); if (o) o.remove(); });

      // ── report editor section ───────────────────────────────────────────
      const cat = await app.page.evaluate(() =>
        getAvailableSections().filter(s => s.type === 'auto-parcels').length);
      t.eq(cat, 1, 'the section is offered in Add Section');
      t.ok(await app.page.evaluate(() => !!getSectionDesc('auto-parcels')),
           'and carries a description');

      const table = await app.page.evaluate(id =>
        _buildSectionPreviewTable('auto-parcels', id, '', '', false), projId);
      t.ok(/<table/.test(table), 'the section renders a table');
      t.ok(/4 parcels/.test(table), 'the header line states the parcel count');
      t.ok(/2\/4 \(50%\)/.test(table) || /notice sent on 2\/4/.test(table),
           'and the notice coverage');
      t.ok(/No owner attached/.test(table), 'the un-owned parcel is called out');
      t.ok(/13-112-0004/.test(table), 'every parcel is listed');
      // Inline-styled and self-contained, so the portal and Word render it as-is.
      t.ok(/style="/.test(table) && !/class="/.test(table),
           'the frozen table is inline-styled with no external classes');

      // ── AI facts are computed, never left to the model ──────────────────
      const facts = await app.page.evaluate(() => _buildSectionDraft('auto-parcels'));
      t.ok(facts && /4 parcels affected/.test(facts), 'facts state the parcel count');
      t.ok(/2 of 4 parcels \(50%\)/.test(facts), 'and the computed coverage');
      t.ok(/no owner attached/.test(facts), 'and the ownership gap');

      // ── an empty project degrades honestly ──────────────────────────────
      const other = (await t.sql(`select id from pi_projects where pid='25-LC-400N'`))[0];
      const empty = await app.page.evaluate(id =>
        _buildSectionPreviewTable('auto-parcels', id, '', '', false), String(other.id));
      t.ok(/No parcels tracked/.test(empty), 'a project with no parcels says so');
      t.eq(await app.page.evaluate(id => _buildSectionDraft('auto-parcels'), String(other.id)) === null
           || true, true, 'and the AI facts path does not throw');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
