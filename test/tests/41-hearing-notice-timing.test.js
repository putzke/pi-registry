// Newspaper notices for a project public hearing are measured against the
// HEARING DATE.
//
// Utah Admin Code R930-2-5: at least two notices in a daily newspaper with
// statewide circulation — the first at least two weeks before the public
// hearing, the second five to ten days before it.
//
// The form used to label both fields "(≥15 days before deadline)" / "(≥7 days
// before deadline)" without saying WHICH deadline, and nothing validated them.
// The phrase came from the app's own NEPA checklist, which cites UDOT MOI
// Ch. 4.5(A)(4)(a) and says "request-for-hearing deadline" — a DIFFERENT NEPA
// step (23 CFR 771.111(h): offering the OPPORTUNITY of a hearing, which applies
// when no hearing is held). That deadline is not a field on pi_comment_periods
// at all, so the label pointed at a date the app does not store.
//
// The seeded SR-154 period showed the cost: a hearing on 10/22/2025 advertised
// once on 10/15 — seven days of notice where the rule wants at least fourteen.
module.exports = {
  name: 'hearing notices — timed against the hearing date, per R930-2-5',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      // ── the seeded period now complies ───────────────────────────────────
      const row = (await t.sql(
        `select start_date, end_date, hearing_date, first_ad_date, second_ad_date
           from pi_comment_periods where id='cp-sr154-deis-2025'`))[0];
      t.ok(row, 'the seeded DEIS comment period exists');
      const days = (from, to) =>
        Math.round((new Date(to + 'T12:00:00') - new Date(from + 'T12:00:00')) / 86400000);
      const iso = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

      const hd = iso(row.hearing_date), a1 = iso(row.first_ad_date), a2 = iso(row.second_ad_date);
      t.ok(hd && a1 && a2, `hearing ${hd}, ads ${a1} and ${a2}`);
      t.ok(days(a1, hd) >= 14,
           `1st notice is ${days(a1, hd)} days before the hearing (R930-2-5 wants ≥14)`);
      const d2 = days(a2, hd);
      t.ok(d2 >= 5 && d2 <= 10,
           `2nd notice is ${d2} days before the hearing (R930-2-5 wants 5–10)`);

      // The hearing has to sit inside the comment period, or the schedule is
      // incoherent regardless of the notice timing.
      const st = iso(row.start_date), en = iso(row.end_date);
      t.ok(hd >= st && hd <= en, `and the hearing falls inside ${st}–${en}`);
      // An EA NOA opens the period on the day of first advertisement — the
      // app's own guidance text for this period type.
      t.eq(a1, st, 'the first advertisement is the day the comment period opens');

      // ── the check itself ─────────────────────────────────────────────────
      const verdicts = await app.page.evaluate(() => {
        const out = {};
        const run = (hearing, ad1, ad2) => {
          document.body.insertAdjacentHTML('beforeend',
            '<div id="tmp-cp"><input id="f-phearing"><input id="f-pad1">'
            + '<input id="f-pad2"><div id="f-pad-check"></div></div>');
          document.getElementById('f-phearing').value = hearing;
          document.getElementById('f-pad1').value = ad1;
          document.getElementById('f-pad2').value = ad2;
          _cpAdCheck();
          const html = document.getElementById('f-pad-check').innerHTML;
          document.getElementById('tmp-cp').remove();
          return html;
        };
        out.compliant = run('2025-11-05', '2025-10-15', '2025-10-28');
        out.tooLate1  = run('2025-10-22', '2025-10-15', '');
        out.tooEarly2 = run('2025-11-05', '2025-10-15', '2025-10-01');
        out.tooLate2  = run('2025-11-05', '2025-10-15', '2025-11-03');
        out.noHearing = run('', '2025-10-15', '');
        out.empty     = run('', '', '');
        return out;
      });

      t.eq(/⚠/.test(verdicts.compliant), false,
           'a compliant pair raises no warning');
      t.ok(/21 days/.test(verdicts.compliant) && /8 days/.test(verdicts.compliant),
           'and reports both intervals');

      t.ok(/⚠/.test(verdicts.tooLate1) && /at least 14/.test(verdicts.tooLate1),
           'the old seeded case — 7 days before the hearing — is flagged');
      t.ok(/⚠/.test(verdicts.tooEarly2), 'a 2nd notice published too early is flagged');
      t.ok(/⚠/.test(verdicts.tooLate2), 'and one published too late');

      // With no hearing, these notices advertise the OPPORTUNITY to request one
      // — a different rule — so the check must not silently apply R930-2-5.
      t.eq(/⚠/.test(verdicts.noHearing), false,
           'no hearing date means no R930-2-5 verdict');
      t.ok(/opportunity to request/i.test(verdicts.noHearing),
           'it says why instead of judging against the wrong rule');
      t.eq(verdicts.empty, '', 'and an untouched form stays quiet');

      // ── the labels name the reference date ───────────────────────────────
      const labels = await app.page.evaluate(() => {
        S.view = 'comments';
        openPeriodModal();
        const wrap = document.getElementById('modal-ov');
        const txt = wrap ? wrap.textContent : '';
        const has = document.getElementById('f-pad-check') !== null;
        closeM && closeM();
        return { txt, has };
      });
      t.ok(labels.has, 'the modal renders the timing line');
      t.ok(/14 days before the hearing/.test(labels.txt),
           'the 1st ad label names the hearing as the reference');
      t.ok(/5[–-]10 days before the hearing/.test(labels.txt),
           'so does the 2nd');
      t.eq(/before deadline/.test(labels.txt), false,
           'and neither says "deadline" without saying which one');
      t.ok(/R930-2-5/.test(labels.txt),
           'the section cites the rule that actually governs the timing');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
