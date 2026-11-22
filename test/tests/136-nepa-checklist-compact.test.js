// NEPA checklist, compact (DEV, Nov 2026, Jeff — from the canvas mockup).
// Groups down the left, one line per item. Ticking fills today and flags the
// date as automatic until someone saves a date; dates are editable but never
// later than today. Longer items (NEPA_DURATION_KEYS) can be started — a start
// date and an owner, "In progress · N days", amber past NEPA_LONG_DAYS. Not
// applicable items leave every percentage. Stored inside nepa_checklist only.
const SHOT = process.env.SHOT_DIR;
module.exports = {
  name: 'NEPA checklist — compact panel, editable dates, in progress, not applicable',
  async run({ t }) {
    t.seed();
    const [proj] = await t.sql(`select id from pi_projects where pid='25-154-001'`);
    const P = String(proj.id);
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const r = await app.page.evaluate(async (P) => {
        const out = {};
        S.projectFilter = P; S.view = 'deliverables'; render();
        const panel = () => document.getElementById('nepa-panel-' + P);
        out.panel = !!panel();
        out.groups = panel().querySelectorAll('.nepa-grp').length; out.groupsWant = new Set((DB.get('projects').find(p => String(p.id) === P).nepaChecklist || []).map(x => x.group)).size;
        out.oldList = !!document.querySelector('[onclick^="toggleNepaCheck"]');
        const today = localToday();
        // Tick an open one-day item → done today, flagged, editor open.
        nepaGroup(P, 'FONSI & Decision');
        const item = k => (DB.get('projects').find(p => String(p.id) === P).nepaChecklist || []).find(x => x.key === k);
        out.noStartOnOneDay = !panel().querySelector('.nepa-row[data-key="EA-47"] .nepa-start');
        out.startOnLong = !!panel().querySelector('.nepa-row[data-key="EA-44"] .nepa-start');
        nepaTick(P, 'EA-47');
        out.ticked = { done: item('EA-47').checked, date: item('EA-47').checkedDate === today, auto: item('EA-47').dateAuto };
        out.editorOpen = !!panel().querySelector('.nepa-editor[data-kind="done"]');
        out.chipTicked = /ticked/.test(panel().querySelector('.nepa-row[data-key="EA-47"] .nepa-chip').textContent);
        // A later date is refused; a past date saves and clears the flag.
        document.getElementById('nepa-cd').value = _isoAddDays(today, 3); nepaSaveDone(P, 'EA-47');
        out.futureRefused = item('EA-47').dateAuto === true;
        document.getElementById('nepa-cd').value = '2025-12-01'; document.getElementById('nepa-cb').value = 'jp'; nepaSaveDone(P, 'EA-47');
        out.saved = { date: item('EA-47').checkedDate, by: item('EA-47').checkedBy, auto: item('EA-47').dateAuto };
        // Start a long item → In progress; 40 days old reads amber.
        nepaStart(P, 'EA-44');
        out.started = { s: item('EA-44').startedDate === today, own: !!item('EA-44').owner, state: _nepaState(item('EA-44')) };
        document.getElementById('nepa-sd').value = _isoAddDays(today, -40); nepaSaveStart(P, 'EA-44');
        const chip = panel().querySelector('.nepa-row[data-key="EA-44"] .nepa-chip');
        out.progChip = chip.textContent; out.progAmber = /232, ?160, ?32/.test(chip.getAttribute('style'));
        nepaFilter(P, 'progress');
        out.progFilter = [...panel().querySelectorAll('.nepa-row')].map(x => x.getAttribute('data-key'));
        nepaFilter(P, 'all');
        // Done after a start keeps how long it took.
        nepaTick(P, 'EA-44'); document.getElementById('nepa-cd').value = _isoAddDays(today, -10); nepaSaveDone(P, 'EA-44');
        out.took = /took 30 days/.test(panel().querySelector('.nepa-row[data-key="EA-44"]').textContent);
        // Not applicable leaves the percentage.
        const before = _nepaLive(DB.get('projects').find(p => String(p.id) === P).nepaChecklist).length;
        nepaNa(P, 'EA-46');
        const after = _nepaLive(DB.get('projects').find(p => String(p.id) === P).nepaChecklist).length;
        out.naDrop = before - after;
        out.summary = panel().querySelector('.nepa-summary').textContent;
        // Group not applicable, then back.
        nepaGroup(P, 'Comment Resolution'); nepaGroupNa(P);
        out.groupNa = (DB.get('projects').find(p => String(p.id) === P).nepaChecklist).filter(x => x.group === 'Comment Resolution').every(x => x.na);
        nepaGroupNa(P);
        out.groupBack = (DB.get('projects').find(p => String(p.id) === P).nepaChecklist).filter(x => x.group === 'Comment Resolution').every(x => !x.na);
        // Untick keeps the start (returns to In progress).
        nepaTick(P, 'EA-44'); out.untick = _nepaState(item('EA-44'));
        // The Reports card ignores N/A.
        S.view = 'reports'; S.rptTab = 'reports'; render();
        out.cardBig = document.querySelector('.rpt-card[data-rid="nepa-compliance"] .rpt-card-big').textContent;
        const cl = _nepaLive(DB.get('projects').find(p => String(p.id) === P).nepaChecklist);
        out.cardWant = Math.round(cl.filter(x => x.checked).length / cl.length * 100) + '%';
        // Mark all done on a chosen date.
        S.view = 'deliverables'; render(); nepaGroup(P, 'Comment Resolution'); nepaAllEdit(P, true);
        document.getElementById('nepa-all').value = '2026-01-15'; nepaMarkAll(P);
        out.markAll = (DB.get('projects').find(p => String(p.id) === P).nepaChecklist).filter(x => x.group === 'Comment Resolution').every(x => x.checked && x.checkedDate === '2026-01-15' && !x.dateAuto);
        await new Promise(res => setTimeout(res, 800));
        return out;
      }, P);
      t.ok(r.panel, 'compact panel renders');
      t.eq(r.groups, r.groupsWant, 'one rail entry per checklist group');
      t.ok(!r.oldList, 'old long list is gone');
      t.ok(r.noStartOnOneDay && r.startOnLong, 'Start only on the longer items');
      t.eq(r.ticked, { done: true, date: true, auto: true }, 'ticking fills today and flags it as automatic');
      t.ok(r.editorOpen && r.chipTicked, 'the date box opens and the chip says ticked');
      t.ok(r.futureRefused, 'a later date is refused');
      t.eq(r.saved, { date: '2025-12-01', by: 'JP', auto: false }, 'a past date saves with initials and clears the flag');
      t.eq(r.started, { s: true, own: true, state: 'progress' }, 'Start records a date and owner');
      t.ok(/In progress · 40 days/.test(r.progChip) && r.progAmber, 'long-running item reads amber: ' + r.progChip);
      t.eq(r.progFilter, ['EA-44'], 'In progress filter');
      t.ok(r.took, 'a finished item shows how long it took');
      t.eq(r.naDrop, 1, 'not applicable leaves the count');
      t.ok(/1 not applicable/.test(r.summary), 'summary counts not applicable: ' + r.summary);
      t.ok(r.groupNa && r.groupBack, 'a whole group can be not applicable and back');
      t.eq(r.untick, 'progress', 'unticking a started item returns it to In progress');
      t.eq(r.cardBig, r.cardWant, 'Reports card % ignores not applicable items');
      t.ok(r.markAll, 'Mark all done uses the chosen date');
      const [row] = await t.sql(`select nepa_checklist from pi_projects where id=${P}`);
      const saved = (row.nepa_checklist || []).find(x => x.key === 'EA-47');
      t.ok(saved && saved.checkedDate === '2025-12-01' && saved.dateAuto === false, 'stored in nepa_checklist (no new columns)');
      if (SHOT) {
        await app.page.evaluate((P) => { nepaGroup(P, 'FONSI & Decision'); document.getElementById('nepa-panel-' + P).scrollIntoView(); }, P);
        await app.page.screenshot({ path: SHOT + '/nepa.png' });
      }
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }
  },
};
