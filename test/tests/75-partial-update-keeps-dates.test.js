// A partial update must never erase a date it was not given (Oct 2026).
//
// toSB() turned every ABSENT date column into null, so a save that sends only
// a few fields wiped the record's other dates. Found live: attaching a final
// .docx to archived PI reports blanked their report period (3 reports on PIN
// 15905, 5 in all), and "Reconcile with UGRC" blanked five parcels' notice
// dates. The Share switch had the same shape.
module.exports = {
  name: 'partial updates keep the dates they were not given',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const [ar] = await t.sql(`insert into pi_report_archive (project_id, report_title, period_start, period_end)
        select id, 'Partial test', '2026-08-22', '2026-09-04' from pi_projects limit 1 returning id`);
      const [pc] = await t.sql(`select id from pi_parcels where notice_date is not null limit 1`);
      const before = (await t.sql(`select notice_date::text n from pi_parcels where id=${pc.id}`))[0].n;

      const body = await app.page.evaluate(() => toSB('report_archive', { docxPath: 'x/1.docx', docxUploadedAt: '2026-10-09T00:00:00Z' }));
      t.eq(Object.keys(body).sort(), ['docx_path', 'docx_uploaded_at'], 'a partial object writes only the columns it carries');

      await app.page.evaluate(async id => {
        await sbUpdate('report_archive', id, { docxPath: 'x/1.docx', docxUploadedAt: '2026-10-09T00:00:00Z' });
        await sbUpdate('report_archive', id, { clientVisible: true });
      }, String(ar.id));
      const [a] = await t.sql(`select period_start::text s, period_end::text e, docx_path from pi_report_archive where id=${ar.id}`);
      t.eq([a.s, a.e, a.docx_path], ['2026-08-22', '2026-09-04', 'x/1.docx'], 'attaching the .docx and sharing keep the report period');

      await app.page.evaluate(async id => { await sbUpdate('parcels', id, { ugrcMatched: true, ugrcCheckedAt: new Date().toISOString(), ugrcOwnType: 'Private', ugrcAddress: 'x' }); }, String(pc.id));
      t.eq((await t.sql(`select notice_date::text n from pi_parcels where id=${pc.id}`))[0].n, before, 'a UGRC reconcile keeps the parcel notice date');

      t.eq(await app.page.evaluate(() => toSB('parcels', { noticeDate: '' }).notice_date), null, 'a date sent as blank still clears (the edit dialogs rely on this)');
      t.eq(await app.page.evaluate(() => toSB('parcels', { noticeDate: null }).notice_date), null, '…and so does an explicit null');
    } finally { await app.close(); }
  }
};
