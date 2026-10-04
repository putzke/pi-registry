// PI Close-Out, step 2: the report document.
//
// The preview and the .docx are rendered from ONE block list (_coReportDoc),
// so the assertions below check both against the same expectations. What has
// to hold:
//   - the cover letter is assembled from the intake (address block, Re: line,
//     salutation, signature) plus the letter body the consultant writes;
//   - a highlight heading prints only when it has text or links, and links
//     print as labelled, clickable text, never a bare URL;
//   - a link the intake has no usable URL for (blank, or not http/mailto)
//     prints flagged, never silently dropped and never as a live javascript:;
//   - anything unfinished is a yellow placeholder in BOTH renderings, and the
//     export says how many before writing the file;
//   - sections a later step builds show in the preview but never reach the
//     .docx;
//   - every hyperlink in document.xml resolves to an External relationship;
//   - the letterhead choice reaches the file, including "off".
module.exports = {
  name: 'close-out report — one document model, previewed and exported as .docx',
  async run({ t }) {
    t.seed();
    const proj = (await t.sql(`select id, pid from pi_projects where pid='25-LC-400N'`))[0];
    const projId = String(proj.id);
    const intake = {
      region: 'Region One', scmName: 'Mitch Shaw, Senior Communication Manager',
      office: 'Region One\n169 N Wall Ave\nOgden, UT 84404', reportDate: '2026-10-02',
      route: 'SR-30', startMp: '1.2', endMp: '3.4',
      sigName: 'Jeff Putzke', sigTitle: 'PI Manager', sigEmail: 'jeff@demo.test', sigCell: '801-555-0100',
      websiteUrl: 'https://publicinput.com/logan400n', projectEmail: 'logan400n@demo.test',
      news: [{ outlet: 'Herald Journal', topic: 'closures announced', url: 'https://example.test/hj' },
             { outlet: 'Cache Valley Daily', topic: 'detour', url: '' },
             { outlet: 'Bad Link', url: 'javascript:alert(1)' }],
      editions: [{ sent: 'Dec 19, 2025', title: 'Winter Suspension', url: 'https://example.test/nl1' },
                 { sent: 'Jan 5, 2026', title: 'No link edition', url: '' }],
      social: [{ account: 'Logan City – Facebook', url: 'https://example.test/fb', engagement: '412 likes',
                 comment: '@mtngirl13: Amazing work, thank you!' }],
      lessons: 'Business access needed earlier planning.',
      draft: {
        letter: 'Thank you for the opportunity to support this project.\nThe public response was positive throughout.',
        'hl-outreach': 'Outreach began two months before construction.',
        lessons: 'Pre-plan business access: start the conversation at design.\nA plain closing thought.',
      },
    };
    const id = String((await t.sql(
      `insert into pi_closeouts (project_id, label, intake, created_by)
       values (${projId}, 'Final', $1::jsonb, 'putzke@demo.test') returning id`, [JSON.stringify(intake)]))[0].id);

    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const page = app.page;
      await page.evaluate(([pid, cid]) => { S.projectFilter = pid; S.rptTab = 'closeout'; setView('reports'); openCloseoutReport(cid); }, [projId, id]);

      // ── the preview ─────────────────────────────────────────────────────
      const pv = await page.evaluate(() => {
        const el = document.getElementById('co-preview');
        return {
          text: el.innerText,
          links: Array.from(el.querySelectorAll('a')).map(a => ({ href: a.getAttribute('href'), text: a.textContent })),
          marks: Array.from(el.querySelectorAll('mark')).map(m => m.textContent),
          todos: el.querySelectorAll('.co-todo').length,
          bold: Array.from(el.querySelectorAll('strong')).map(b => b.textContent),
          pill: id => (document.getElementById('co-rs-' + id) || {}).textContent || '',
        };
      });
      const pills = await page.evaluate(() => ['letter', 'glance', 'highlights', 'commlog', 'commitments', 'lessons', 'scope']
        .reduce((o, k) => (o[k] = (document.getElementById('co-rs-' + k) || {}).textContent || '', o), {}));
      t.ok(/Close-out report · Final/.test(await page.evaluate(() => document.querySelector('.topbar-title').textContent)),
        'the report screen opens');
      t.ok(pv.text.includes('Attn:  Mitch Shaw, Senior Communication Manager'), 'Attn line from the intake');
      t.eq((pv.text.match(/Region One/g) || []).length, 1, 'the region prints once even when the office address repeats it');
      t.ok(pv.text.includes('UDOT Region One'), 'as the agency line, "UDOT Region One"');
      t.eq(await page.evaluate(() => _coReportDoc({ id: 'x', projectId: '0', intake: { region: 'Region One', office: 'UDOT Region One\n1 Main St' } })
        .blocks.slice(0, 4).map(b => (b.runs || []).map(r => r.text).join('')).filter(x => /Region/.test(x)).length), 1,
        'a "UDOT Region One" office line is recognised as the same region too');
      t.ok(pv.text.includes('169 N Wall Ave') && pv.text.includes('Ogden, UT 84404'), 'office address lines');
      t.ok(pv.text.includes('10/02/2026'), 'letter date as mm/dd/yyyy');
      t.ok(pv.text.includes('Re:  PIN # 25-LC-400N | Start MP: 1.2 - End MP: 3.4 | SR-30; Logan City 400 North Reconstruction'), 'Re: line');
      t.ok(pv.text.includes('Dear Mitch Shaw,'), 'salutation derived from the recipient when none is typed');
      t.ok(pv.text.includes('The public response was positive throughout.'), 'letter body, one paragraph per line');
      t.ok(pv.text.includes('Email:  jeff@demo.test') && pv.text.includes('Cell:  801-555-0100'), 'signature block');
      t.ok(!pv.text.includes('Phone:'), 'an empty signature line is left out, not printed blank');
      t.ok(pv.text.includes('PIN #25-LC-400N Public Involvement Close-Out Report'), 'report title');

      t.ok(pv.bold.includes('Early public outreach & project advertising summary: '), 'a highlight with text prints as a bold run-in heading');
      t.ok(pv.text.includes('Project Dedicated Website'), 'a highlight with only links still prints');
      t.ok(pv.marks.includes('[narrative not written yet]'), '…with its missing narrative flagged');
      t.ok(!pv.text.includes('Inbound public complaints/concerns'), 'a highlight with neither text nor links is left out');
      t.ok(!pv.text.includes('Traffic control notifications'), 'and so is the next empty one');

      const hrefs = pv.links.map(l => l.href);
      t.ok(pv.links.some(l => l.text === '(Herald Journal – closures announced)' && l.href === 'https://example.test/hj'),
        'a news link prints as its label, linked');
      t.ok(!pv.text.includes('https://example.test/hj'), 'the raw URL is never printed');
      t.ok(pv.text.includes('(Cache Valley Daily – detour)') && pv.marks.filter(m => m === '[link missing]').length === 2,
        'rows without a usable link print flagged (blank URL and javascript: URL both)');
      t.ok(!hrefs.some(h => /^javascript:/i.test(h)), 'a javascript: URL is never made a live link');
      t.ok(pv.links.some(l => l.href === 'mailto:logan400n@demo.test'), 'the project email becomes a mailto link');
      t.ok(pv.links.some(l => l.text === '(Dec 19, 2025 – Winter Suspension)'), 'a newsletter edition with a link is listed');
      t.ok(!pv.text.includes('No link edition'), 'an edition with no link is not listed');
      t.ok(pv.links.some(l => l.text === '(Logan City – Facebook – 412 likes)'), 'a social post with its engagement');
      t.ok(pv.text.includes('comment sample:  mtngirl13  Amazing work, thank you!') && pv.bold.includes('mtngirl13'),
        'its comment sample, with the user in bold');
      t.ok(pv.bold.includes('Pre-plan business access: '), 'a lesson written "Heading: text" prints as a run-in heading');
      t.ok(pv.text.includes('A plain closing thought.'), 'a lesson without a heading prints as a plain paragraph');
      t.eq(pv.todos, 0, 'no "next step" placeholders are left now that step 3 is built');
      t.ok(/In the report/.test(pills.letter) && /In the report/.test(pills.glance) && /Left out/.test(pills.commlog),
        'each section says whether it is in the report');

      // ── typing a draft autosaves and updates the preview ────────────────
      await page.evaluate(() => {
        const el = document.getElementById('co-dr-commlog');
        el.value = 'The team logged every contact.\nNothing required escalation.';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(1200);
      const draft = (await t.sql(`select intake->'draft'->>'commlog' c from pi_closeouts where id=${id}`))[0].c;
      t.eq(draft, 'The team logged every contact.\nNothing required escalation.', 'the draft slot autosaves into intake.draft');
      t.ok(await page.evaluate(() => document.getElementById('co-preview').innerText.includes('Stakeholder Communications Log Summary:')),
        'and the section appears in the preview once it has text');
      t.ok(/In the report/.test(await page.evaluate(() => document.getElementById('co-rs-commlog').textContent)), 'its pill flips to In the report');

      // ── export ──────────────────────────────────────────────────────────
      const exportAs = (brand, answer) => page.evaluate(async ([b, ans]) => {
        const sel = document.querySelector('select[data-k="letterhead"]');
        sel.value = b; sel.dispatchEvent(new Event('change', { bubbles: true }));
        let asked = null;
        window.confirm = m => { asked = m; return ans; };
        let name = null;
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () { name = this.download; };
        const blob = await exportCloseoutDocx();
        HTMLAnchorElement.prototype.click = click;
        if (!blob) return { asked, blob: false };
        const zip = await JSZip.loadAsync(blob);
        return {
          asked, name, blob: true,
          doc: await zip.file('word/document.xml').async('string'),
          rels: await zip.file('word/_rels/document.xml.rels').async('string'),
          header: !!zip.file('word/header1.xml'),
        };
      }, [brand, answer]);

      const no = await exportAs('sunrise', false);
      t.ok(/placeholders? (is|are) still in the report/.test(no.asked || ''), 'export says placeholders remain: ' + no.asked);
      t.eq(no.blob, false, 'declining writes no file');

      const d = await exportAs('sunrise', true);
      t.ok(d.blob, 'accepting exports a file');
      t.eq(d.name, '25-LC-400N SR-30 PI Close-Out Report.docx', 'named <PIN> <Route> PI Close-Out Report.docx');
      t.ok(d.doc.includes('Thank you for the opportunity to support this project.'), 'the letter body is in the .docx');
      t.ok(d.doc.includes('Nothing required escalation.'), 'the communications log summary is in the .docx');
      t.ok(!/Built in the next step/.test(d.doc), 'later-step placeholders never reach the .docx');
      t.ok(d.doc.includes('&lt;REPORT END&gt;'), 'the report ends with <REPORT END>');
      t.eq((d.doc.match(/<w:br w:type="page"\/>/g) || []).length, 2, 'two page breaks: after the letter, before the photos');
      t.ok(/<w:highlight w:val="yellow"\/>[\s\S]*?\[narrative not written yet\]/.test(d.doc), 'placeholders are highlighted yellow in Word');
      const ids = [...d.doc.matchAll(/<w:hyperlink r:id="([^"]+)"/g)].map(m => m[1]);
      t.eq(ids.length, 5, 'five hyperlinks: news, website, email, edition, social');
      t.ok(ids.every(rid => new RegExp('Id="' + rid + '"[^>]*TargetMode="External"').test(d.rels)),
        'every hyperlink resolves to an External relationship');
      t.ok(d.rels.includes('Target="https://example.test/hj"') && d.rels.includes('Target="mailto:logan400n@demo.test"'),
        'relationships carry the real targets');
      t.ok(!/javascript:/i.test(d.rels), 'no javascript: target is ever written');
      t.ok(/<w:headerReference[^>]*w:type="first"/.test(d.doc) && /<w:titlePg\/>/.test(d.doc), 'Sunrise letterhead, first page only');

      const off = await exportAs('off', true);
      t.ok(off.blob && !/<w:headerReference/.test(off.doc) && !off.header, 'letterhead off removes the header entirely');
      t.ok(!/relationships\/header"/.test(off.rels) && (off.rels.match(/TargetMode="External"/g) || []).length === 5,
        'and its relationships drop the header but keep every hyperlink');
      const udot = await exportAs('udot', true);
      t.ok(udot.blob && /<w:headerReference[^>]*w:type="first"/.test(udot.doc), 'UDOT letterhead exports with its header');
      t.eq((await t.sql(`select intake->>'letterhead' l from pi_closeouts where id=${id}`))[0].l, 'udot',
        'the letterhead choice is saved with the close-out');

      // ── an interim close-out names itself ───────────────────────────────
      t.eq(await page.evaluate(() => _coFileName({ label: 'Year 1' }, { pid: '19739' }, { route: 'US-89' })),
        '19739 Year 1 PI Close-Out Report.docx', 'an interim close-out is named by its label');
      t.eq(app.errors, [], 'no page errors');
    } finally {
      await app.close();
    }
  },
};
