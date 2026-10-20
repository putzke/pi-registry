// The Outreach log (Part B, step 2b, Oct 2026). A dated log of outreach
// actions with dated engagement readings. Pasting a link fills in what the
// link reader returns, never over what was typed; counts come from the link,
// a screenshot (read by Claude, then checked) or typing, and each reading
// says which. Staff-only tables; nothing here is an interaction.
module.exports = {
  name: 'outreach log — link fills the form, readings keep their source, screenshot read, campaigns, delete',
  async run({ t }) {
    t.seed();
    const [A, B] = (await t.sql(`select id from pi_projects where status='Active' order by id limit 2`)).map((r) => String(r.id));
    const [camp] = await t.sql(`insert into pi_outreach_campaigns (project_id, name) values ($1,'Fall closures') returning id`, [A]);
    const [act] = await t.sql(`insert into pi_outreach_actions (project_id, campaign_id, action_date, action_type, party, url, title, outlet)
      values ($1,$2,'2026-10-01','Press release','UDOT','https://connect.udot.utah.gov/x','PRMARK closures announced','connect.udot.utah.gov') returning id`, [A, camp.id]);
    await t.sql(`insert into pi_outreach_readings (action_id, read_on, reactions, comments, source) values ($1,'2026-10-02',10,1,'typed'),($1,'2026-10-05',40,6,'screenshot')`, [act.id]);
    await t.sql(`insert into pi_outreach_actions (project_id, action_date, action_type, title) values ($1,'2026-10-03','Newsletter','OTHERPROJ newsletter')`, [B]);

    const app = await t.open('index.html', { email: 'staff@sunrise.example' });
    try {
      await app.ready();
      const P = app.page;
      const linkCalls = [];
      let linkReply = {};
      await P.route('**/functions/v1/link-preview', async (route) => {
        const b = JSON.parse(route.request().postData() || '{}'); linkCalls.push({ url: b.url, headers: route.request().headers() });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(linkReply) });
      });
      const claude = [];
      await P.route('https://api.anthropic.com/**', async (route) => {
        claude.push(JSON.parse(route.request().postData() || '{}'));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ stop_reason: 'end_turn',
          content: [{ type: 'text', text: '{"reactions":120,"comments":4,"shares":null,"views":null}' }] }) });
      });
      await P.evaluate(() => { window._alerts = []; window.alert = (m) => window._alerts.push(m); window.confirm = () => true; });

      // ── the view, scoped to a project ──
      await P.evaluate((a) => { S.projectFilter = a; setView('outreach'); }, A);
      t.ok(await P.$('#nav-outreach'), 'Outreach is in the nav');
      let txt = await P.textContent('#main');
      t.ok(/PRMARK closures announced/.test(txt) && !/OTHERPROJ/.test(txt), 'the view lists this project’s actions only');
      t.ok(/40 reactions · 6 comments/.test(txt) && /as of Oct 5, 2026 · from a screenshot · 2 readings/.test(txt), 'the latest reading shows, with its date and source');
      t.ok(/Fall closures/.test(txt), 'the campaign is named');

      // ── a new action from a link ──
      await P.evaluate(() => openOutreachModal());
      await P.fill('#f-out-outlet', 'TYPED OUTLET');
      linkReply = { ok: true, platform: 'Instagram', url: 'https://www.instagram.com/p/abc/', unwrapped: 'https://urldefense.proofpoint.com/v2/url?u=x',
        fields: { title: 'Mornin’. Closures this weekend', site: 'Instagram', author: 'UDOT', description: 'Mornin’. Closures this weekend on I-15', published: 'October 3, 2026' },
        engagement: { reactions: 1863, comments: 29 }, engagementSource: 'page description', notes: [] };
      await P.fill('#f-out-url', 'https://urldefense.proofpoint.com/v2/url?u=x');
      await P.click('#f-out-read');
      await t.until(() => P.evaluate(() => /Filled in/.test(document.getElementById('f-out-readmsg').textContent)), 'the link was read');
      const f = await P.evaluate(() => { const v = (id) => document.getElementById(id).value; return { url: v('f-out-url'), title: v('f-out-title'), outlet: v('f-out-outlet'), date: v('f-out-date'), type: v('f-out-type'),
        r: v('f-out-r-reactions'), c: v('f-out-r-comments'), src: document.getElementById('f-out-rsrc').textContent }; });
      t.eq(f.url, 'https://www.instagram.com/p/abc/', 'an email-scanner wrapper is replaced by the real address');
      t.eq(f.title, 'Mornin’. Closures this weekend', 'title filled from the link');
      t.eq(f.outlet, 'TYPED OUTLET', 'what was typed is never overwritten');
      t.eq(f.date, '2026-10-03', 'the date follows the link');
      t.eq(f.type, 'Social post', 'a social link sets the type');
      t.ok(f.r === '1863' && f.c === '29' && /read from the link/.test(f.src), 'counts filled, marked as read from the link');
      t.ok(!linkCalls[0].headers.prefer, 'the request carries no header the function would refuse (Prefer)');

      await P.evaluate(() => saveOutreach());
      await t.until(async () => (await t.sql(`select count(*)::int n from pi_outreach_readings where source='automatic'`))[0].n === 1, 'saved');
      const [saved] = await t.sql(`select * from pi_outreach_actions where title like 'Mornin%'`);
      t.ok(saved && saved.action_type === 'Social post' && String(saved.project_id) === A && saved.url === 'https://www.instagram.com/p/abc/' && saved.outlet === 'TYPED OUTLET', 'the action is stored as checked');
      t.eq(String(saved.action_date).slice(0, 10) === '2026-10-03' || new Date(saved.action_date).getDate() === 3, true, 'with the post’s date');
      const [r1] = await t.sql(`select * from pi_outreach_readings where action_id=$1`, [saved.id]);
      t.ok(r1.reactions === 1863 && r1.comments === 29 && r1.shares === null, 'the first reading is stored; counts not shown stay empty, not 0');

      // ── edit: a typed reading is marked typed; a screenshot reading is marked screenshot ──
      await P.evaluate((id) => openOutreachModal(String(id)), saved.id);
      t.ok(/1,863 reactions · 29 comments/.test(await P.textContent('#f-out-readings')), 'the edit dialog lists the readings');
      await P.fill('#f-out-r-reactions', '2000');
      t.ok(/typed/.test(await P.textContent('#f-out-rsrc')), 'typing a count marks the reading as typed');
      await P.evaluate(() => saveOutreach());
      await t.until(async () => (await t.sql(`select count(*)::int n from pi_outreach_readings where action_id=$1`, [saved.id]))[0].n === 2, 'second reading saved');
      t.eq((await t.sql(`select source, reactions from pi_outreach_readings where action_id=$1 order by id desc limit 1`, [saved.id]))[0], { source: 'typed', reactions: 2000 }, 'stored as typed');

      // Screenshot without a key: says what to do, no call.
      await P.evaluate((id) => { openOutreachModal(String(id)); window._getClaudeKey = () => ''; }, saved.id);
      await P.evaluate(() => outScreenshot({ files: [new File(['x'], 'shot.png', { type: 'image/png' })], value: '' }));
      t.ok(/needs a Claude API key/.test(await P.textContent('#f-out-readmsg')) && claude.length === 0, 'no key → a clear message, no AI call');
      // With a key: Claude reads the numbers, staff check them.
      await P.evaluate(() => { window._getClaudeKey = () => 'sk-test'; window._downscaleImageToBase64 = async () => ({ media_type: 'image/jpeg', data: 'AAAA' }); });
      await P.evaluate(() => outScreenshot({ files: [new File(['x'], 'shot.png', { type: 'image/png' })], value: '' }));
      await t.until(() => P.evaluate(() => /screenshot/.test(document.getElementById('f-out-rsrc').textContent)), 'screenshot read');
      t.eq(await P.evaluate(() => [document.getElementById('f-out-r-reactions').value, document.getElementById('f-out-r-comments').value, document.getElementById('f-out-r-shares').value]),
        ['120', '4', ''], 'the counts Claude read are filled in; a number it could not see stays blank');
      const req = claude[0];
      t.ok(req && req.model === await P.evaluate(() => CLAUDE_TEXT_MODEL) && req.messages[0].content[0].type === 'image', 'the screenshot goes to the text model as an image');
      t.ok(/Never estimate/.test(req.system), 'the instruction forbids estimating');
      await P.evaluate(() => saveOutreach());
      await t.until(async () => (await t.sql(`select count(*)::int n from pi_outreach_readings where action_id=$1 and source='screenshot'`, [saved.id]))[0].n === 1, 'screenshot reading saved');

      // ── a link that can't be read, and validation ──
      await P.evaluate(() => openOutreachModal());
      linkReply = { ok: false, platform: 'Facebook', fields: {}, engagement: {}, notes: ['The site answered with a sign-in page, not the post.'] };
      await P.fill('#f-out-url', 'https://www.facebook.com/udot/posts/9');
      await P.click('#f-out-read');
      await t.until(() => P.evaluate(() => /sign-in page/.test(document.getElementById('f-out-readmsg').textContent)), 'refusal shown');
      t.eq(await P.inputValue('#f-out-title'), '', 'nothing invented when the link is not read');
      await P.evaluate(() => saveOutreach());
      t.ok((await P.evaluate(() => window._alerts)).some((m) => /title is required/.test(m)), 'a title is required');

      // ── a new campaign from the dialog ──
      await P.evaluate(() => { window.prompt = () => 'I-84 weekend work'; });
      await P.fill('#f-out-title', 'Weekend work post');
      await P.selectOption('#f-out-camp', '__new');
      await t.until(() => P.evaluate(() => { const o = document.getElementById('f-out-camp'); return o && o.selectedOptions[0] && o.selectedOptions[0].textContent === 'I-84 weekend work'; }), 'campaign created and selected');
      await P.evaluate(() => saveOutreach());
      await t.until(async () => (await t.sql(`select count(*)::int n from pi_outreach_actions a join pi_outreach_campaigns c on c.id=a.campaign_id where c.name='I-84 weekend work' and a.title='Weekend work post'`))[0].n === 1, 'action saved in the new campaign');
      t.eq((await t.sql(`select count(*)::int n from pi_interactions where summary like '%Weekend work%' or summary like 'Mornin%'`))[0].n, 0, 'nothing here becomes an interaction');

      // ── filter by campaign, then delete with readings ──
      await P.evaluate((c) => { S.outCampaign = String(c); render(); }, camp.id);
      txt = await P.textContent('#out-table');
      t.ok(/PRMARK/.test(txt) && !/Mornin/.test(txt), 'the campaign filter narrows the list');
      await P.evaluate((id) => { S.outCampaign = ''; openOutreachModal(String(id)); }, act.id);
      await P.evaluate((id) => delOutreach(String(id)), act.id);
      await t.until(async () => (await t.sql(`select count(*)::int n from pi_outreach_actions where id=$1`, [act.id]))[0].n === 0, 'deleted');
      t.eq((await t.sql(`select count(*)::int n from pi_outreach_readings where action_id=$1`, [act.id]))[0].n, 0, 'its readings went with it');
      t.eq(app.errors, [], 'no page errors');
    } finally { await app.close(); }

    // Staff-only: the migration gives anon nothing and keeps the restrictive staff rule.
    const sql = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'sql', '2026-10-20_outreach_log.sql'), 'utf8');
    t.ok(/revoke all on public\.%I from anon/.test(sql) && /pi_staff_or_client/.test(sql), 'the migration is staff-only');
  },
};
