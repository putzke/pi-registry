// An anonymous interaction is EXTERNAL.
//
// Report sections that show "External only" filtered by membership of the
// project's external contact list. An anonymous caller has no stakeholder id, so
// indexOf() never matched and every one of them was dropped — the public was
// excluded from the public-concerns section precisely because nobody took their
// name. The only way to see them was to tick "include internal stakeholders",
// which then pulled the project team into a report about public concern.
//
// The count is a compliance figure: it flows into the PI report and the .docx a
// client receives, so under-counting public contact is a reporting error, not a
// display quirk.
module.exports = {
  name: 'anonymous interactions count as external, not internal',
  async run({ t }) {
    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();

      // A project that has both an anonymous interaction and an internal one.
      const proj = (await t.sql(`
        select p.id, p.pid,
               count(*) filter (where i.stakeholder_id is null)::int anon,
               count(*)::int total
          from pi_projects p join pi_interactions i on i.project_id::text = p.id::text
         group by p.id, p.pid having count(*) filter (where i.stakeholder_id is null) > 0
         order by 3 desc limit 1`))[0];
      t.ok(proj, 'seed has a project with anonymous interactions');
      t.gt(proj.anon, 0, `${proj.anon} of them`);

      const internal = (await t.sql(`
        select count(*)::int n from pi_interactions i
          join pi_project_stakeholders ps
            on ps.stakeholder_id::text = i.stakeholder_id::text
           and ps.project_id::text = i.project_id::text
         where i.project_id::text = $1 and ps.stakeholder_role = 'Internal'`,
        [String(proj.id)]))[0];

      const rows = await app.page.evaluate(([pid]) => {
        const wide = '2000-01-01', far = '2100-01-01';
        const ext = _buildSectionPreviewTable('auto-concerns', pid, wide, far, false);
        const all = _buildSectionPreviewTable('auto-concerns', pid, wide, far, true);
        const count = h => (h.match(/<tr><td style="[^"]*white-space:nowrap"/g) || []).length;
        return {
          extRows: count(ext), allRows: count(all),
          extAnon: (ext.match(/>Anonymous/g) || []).length,
          allAnon: (all.match(/>Anonymous/g) || []).length,
        };
      }, [String(proj.id)]);

      // ── the bug ──────────────────────────────────────────────────────────
      t.gt(rows.extAnon, 0, 'anonymous interactions appear in the External-only table');
      t.eq(rows.extAnon, rows.allAnon,
           'and the same number appear either way — including internals adds team '
           + 'members, it does not reveal more of the public');

      // Ticking "include internal" must still ADD internal contacts, or the
      // toggle has quietly become a no-op.
      if (internal.n > 0) {
        t.gt(rows.allRows, rows.extRows,
             `including internal stakeholders still adds rows (${internal.n} internal interactions)`);
      }
      t.gt(rows.extRows, 0, 'the External-only table is not empty');

      // ── the rule itself ──────────────────────────────────────────────────
      const rule = await app.page.evaluate(() => ({
        noId:    _intIsExternal({ stakeholderId: null }, ['5']),
        blank:   _intIsExternal({ stakeholderId: '' }, ['5']),
        listed:  _intIsExternal({ stakeholderId: '5' }, ['5']),
        notList: _intIsExternal({ stakeholderId: '9' }, ['5']),
        numeric: _intIsExternal({ stakeholderId: 5 }, ['5']),
      }));
      t.eq(rule.noId, true, 'no stakeholder id means external');
      t.eq(rule.blank, true, 'so does an empty one');
      t.eq(rule.listed, true, 'a listed external contact is external');
      t.eq(rule.notList, false, 'someone not on the external list is not');
      t.eq(rule.numeric, true,
           'and a numeric id still matches its string — the mixed types are real');

      // ── every surface agrees ─────────────────────────────────────────────
      // The section table, the AI facts and the .docx each had their own copy of
      // this filter. A fix in one and not the others would leave the report and
      // the file a client receives disagreeing about how much public contact
      // there was.
      const src = await app.page.evaluate(() => {
        const fns = ['_buildSectionPreviewTable', '_buildSectionDraft', 'exportPIDocx',
                     '_buildReportSnapshot'];
        return fns.map(n => ({
          name: n,
          exists: typeof window[n] === 'function',
          usesRule: typeof window[n] === 'function'
            && /_intIsExternal/.test(String(window[n])),
          rawFilter: typeof window[n] === 'function'
            && /(externalIds|extIds\d?)\.indexOf\(\s*(String\()?i\.stakeholderId/.test(String(window[n])),
        }));
      });
      src.forEach(f => {
        t.ok(f.exists, `${f.name} exists`);
        t.eq(f.rawFilter, false, `${f.name} has no hand-rolled external filter left`);
      });
      t.ok(src.find(f => f.name === '_buildSectionPreviewTable').usesRule,
           'the section table goes through the shared rule');

      t.eq(app.errors, [], 'no page errors during the run');
    } finally {
      await app.close();
    }
  },
};
