// Every Claude call goes through _claudeRequest (Oct 2026, Sonnet 5 → 5.5).
//
// The Messages API is intercepted at the network layer, so this checks the
// REAL request the browser sends and what the app does with each kind of reply:
//   - narratives use CLAUDE_TEXT_MODEL at low effort, with thinking headroom
//     added to the caller's length, and opt into server-side fallback;
//   - a reply that starts with a thinking block still yields its text;
//   - a refusal (HTTP 200, stop_reason "refusal") is reported as a decline,
//     not as a vague failure, and writes nothing;
//   - if the API rejects the fallback option itself, the call is retried once
//     without it, and later calls stop sending it;
//   - an ordinary server error is not retried;
//   - the fast (Haiku) path gets no effort or fallback, which Haiku would reject;
//   - no model id or API URL is hard-coded anywhere else.
module.exports = {
  name: 'Claude requests — Sonnet 5.5, effort, headroom, refusal and fallback handling',
  async run({ t }) {
    const fs = require('fs'), path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
    t.eq((html.match(/api\.anthropic\.com\/v1\/messages/g) || []).length, 1, 'one place in the app calls the Messages API');
    t.eq([...new Set(html.match(/'claude-(?:sonnet|opus|haiku|fable)-[0-9a-z-]+'/g) || [])].sort(),
      ["'claude-haiku-4-5'", "'claude-sonnet-5-5'"], 'model ids appear only in their constants');

    t.seed();
    const app = await t.open('index.html', { email: 'putzke@demo.test' });
    try {
      await app.ready();
      const page = app.page;
      const sent = [];
      let reply = null;
      await page.route('**/api.anthropic.com/**', async route => {
        const req = route.request();
        sent.push({ headers: req.headers(), body: JSON.parse(req.postData() || '{}') });
        const r = typeof reply === 'function' ? reply(sent.length) : reply;
        await route.fulfill({ status: r.status || 200, contentType: 'application/json', body: JSON.stringify(r.body) });
      });
      await page.evaluate(() => {
        _setClaudeKey('sk-ant-test');
        window.__toasts = [];
        window.showToast = (m, kind) => window.__toasts.push({ m, kind });
      });
      const toasts = () => page.evaluate(() => window.__toasts.splice(0));
      const ok = text => ({ body: { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }] } });

      // ── a normal narrative ──────────────────────────────────────────────
      reply = ok('A drafted paragraph.');
      let out = await page.evaluate(() => _claudeNarrative('SYS', 'USER', 450));
      t.eq(out, 'A drafted paragraph.', 'text is read by block type, after a leading thinking block');
      let b = sent[0].body, h = sent[0].headers;
      t.eq(b.model, 'claude-sonnet-5-5', 'narratives run on Sonnet 5.5');
      t.eq(b.output_config, { effort: 'low' }, 'at low effort');
      t.eq(b.max_tokens, 450 + 1500, 'with thinking headroom on top of the caller’s length');
      t.eq(b.thinking, undefined, 'thinking is left adaptive (disabled would be a 400 on this model)');
      t.eq(b.temperature, undefined, 'no sampling parameters (non-default values 400 on this model)');
      t.eq(b.fallbacks, 'default', 'server-side fallback is opted into');
      t.eq(h['anthropic-beta'], 'server-side-fallback-2026-07-01', 'with its beta header');
      t.eq(h['anthropic-dangerous-direct-browser-access'], 'true', 'direct browser access header kept');

      // ── a refusal ───────────────────────────────────────────────────────
      sent.length = 0;
      reply = { body: { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms' }, content: [] } };
      out = await page.evaluate(() => _claudeNarrative('SYS', 'USER', 300));
      let ts = await toasts();
      t.eq(out, null, 'a refusal writes nothing');
      t.ok(ts.some(x => x.kind === 'warn' && /declined this request \(general_harms\)/.test(x.m)), 'and says Claude declined, naming the category: ' + JSON.stringify(ts));
      t.ok(!ts.some(x => /API error/.test(x.m)), 'not reported as an API error');

      // ── an ordinary server error is not retried ─────────────────────────
      sent.length = 0;
      reply = { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'Internal server error' } } };
      out = await page.evaluate(() => _claudeNarrative('SYS', 'USER', 300));
      ts = await toasts();
      t.eq(out, null, 'a server error returns nothing');
      t.eq(sent.length, 1, 'and is not retried');
      t.ok(ts.some(x => x.kind === 'error' && /Internal server error/.test(x.m)), 'the error is shown');

      // ── the fallback option rejected → one retry without it, then sticky ──
      sent.length = 0;
      reply = n => n === 1
        ? { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks: unexpected beta' } } }
        : ok('Recovered.');
      out = await page.evaluate(() => _claudeNarrative('SYS', 'USER', 300));
      t.eq(out, 'Recovered.', 'the call still succeeds');
      t.eq(sent.length, 2, 'after exactly one retry');
      t.ok(sent[1].body.fallbacks === undefined && !sent[1].headers['anthropic-beta'], 'the retry drops the option and its header');
      t.eq(sent[1].body.output_config, { effort: 'low' }, 'but keeps the effort setting');
      sent.length = 0; reply = ok('Next.');
      await page.evaluate(() => _claudeNarrative('SYS', 'USER', 300));
      t.ok(sent.length === 1 && sent[0].body.fallbacks === undefined, 'later calls stop sending it for the session');
      await page.evaluate(() => { _claudeNoFallback = false; });

      // ── contact importer: fast path and vision path ─────────────────────
      sent.length = 0;
      reply = ok(JSON.stringify({ contacts: [{ firstName: 'Ada', lastName: 'Lovelace' }] }));
      const c1 = await page.evaluate(() => _aiParseContacts('Ada Lovelace', CLAUDE_FAST_MODEL));
      b = sent[0].body;
      t.eq(c1.length, 1, 'the fast path still parses contacts');
      t.eq(b.model, 'claude-haiku-4-5', 'pasted text uses Haiku 4.5, by its current id');
      t.ok(b.output_config.effort === undefined && b.fallbacks === undefined && b.max_tokens === 4096,
        'with no effort or fallback (Haiku rejects effort) and its own length');
      t.ok(!sent[0].headers['anthropic-beta'], 'and no beta header');
      sent.length = 0;
      await page.evaluate(() => _aiParseContacts([{ type: 'text', text: 'see image' }], CLAUDE_TEXT_MODEL));
      b = sent[0].body;
      t.eq(b.model, 'claude-sonnet-5-5', 'images and PDFs use Sonnet 5.5');
      t.ok(b.output_config.format && b.output_config.format.type === 'json_schema' && b.output_config.effort === 'low',
        'structured output and effort sit side by side in output_config');
      t.eq(b.max_tokens, 4096 + 1500, 'with thinking headroom');

      // ── refusal on the importer surfaces as its message ─────────────────
      reply = { body: { stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] } };
      const msg = await page.evaluate(() => _aiParseContacts('x', CLAUDE_TEXT_MODEL).then(() => 'no error', e => e.message));
      t.ok(/Claude declined this request \(cyber\)/.test(msg), 'the importer gets a decline it can show');

      t.ok(/claude-sonnet-5-5/.test(await page.evaluate(() => { renderSettings(document.getElementById('main')); return document.getElementById('main').innerText; })),
        'Settings names the model in use');
      // The simulated 500 is logged on purpose (failure logging is kept app-wide).
      t.eq(app.errors.filter(e => !/Claude API error: Error: Internal server error/.test(e)), [], 'no other page errors');
    } finally {
      await app.close();
    }
  },
};
