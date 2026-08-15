// A PostgREST-compatible shim over a local Postgres.
//
// Implements only the surface index.html / client-portal.html actually use —
// see sbGet / sbAdd / sbUpdate / sbDelete in index.html:
//   GET    /<table>?select=*&order=id.asc&limit=5000&<col>=<op>.<val>
//   POST   /<table>[?on_conflict=id]           Prefer: return=representation
//                                              Prefer: resolution=merge-duplicates
//   PATCH  /<table>?id=eq.N[&updated_at=eq.…]  Prefer: return=representation
//   DELETE /<table>?id=eq.N
//
// Returning the representation on POST/PATCH matters: sbAdd reads the new id
// out of the response body, and the optimistic-concurrency guard in sbUpdate
// treats "zero rows returned" as a conflict. A shim that returned 204 would
// make every OCC write look like a lost update.
const http = require('http');

const OPS = {
  eq:  (c, i) => [`${c} = $${i}`, v => v],
  neq: (c, i) => [`${c} <> $${i}`, v => v],
  gt:  (c, i) => [`${c} > $${i}`, v => v],
  gte: (c, i) => [`${c} >= $${i}`, v => v],
  lt:  (c, i) => [`${c} < $${i}`, v => v],
  lte: (c, i) => [`${c} <= $${i}`, v => v],
  like: (c, i) => [`${c}::text like $${i}`, v => v.replace(/\*/g, '%')],
  ilike:(c, i) => [`${c}::text ilike $${i}`, v => v.replace(/\*/g, '%')],
};

// Column types, loaded once per table. Needed because comparisons cannot all be
// done as text: timestamptz renders as "2026-07-29 23:51:35.813+00", not the
// ISO-Z form the app sends, so the optimistic-concurrency guard
// (?updated_at=eq.<iso>) would never match and every OCC write would look like
// a conflict. Everything else still compares as text, which is what makes a
// filter work whether project_id is text or bigint.
const _typeCache = {};
async function colTypes(pool, table) {
  if (!_typeCache[table]) {
    const { rows } = await pool.query(
      `select column_name, data_type from information_schema.columns
        where table_schema='public' and table_name=$1`, [table]);
    _typeCache[table] = Object.fromEntries(rows.map(r => [r.column_name, r.data_type]));
  }
  return _typeCache[table];
}
const TEMPORAL = /^(timestamp|date|time)/;

function buildWhere(params, startIdx, types) {
  const clauses = [], values = [];
  let i = startIdx;
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
    const dot = raw.indexOf('.');
    const op = dot < 0 ? 'eq' : raw.slice(0, dot);
    const val = dot < 0 ? raw : raw.slice(dot + 1);
    if (op === 'is') {                       // is.null / is.true / is.false
      const w = val.toLowerCase();
      clauses.push(`${key} is ${w === 'null' ? 'null' : w}`);
      continue;
    }
    if (op === 'in') {
      const list = val.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, ''));
      if (!list.length) { clauses.push('false'); continue; }
      clauses.push(`${key}::text = any($${i}::text[])`);
      values.push(list); i++;
      continue;
    }
    const make = OPS[op];
    if (!make) throw new Error(`postgrest shim: unsupported operator "${op}" on ${key}`);
    const dt = (types || {})[key] || '';
    // Temporal columns compare natively (see colTypes); everything else as text.
    const lhs = TEMPORAL.test(dt) ? key : `${key}::text`;
    const rhs = TEMPORAL.test(dt) ? `$${i}::${dt === 'timestamp with time zone' ? 'timestamptz' : dt}` : `$${i}`;
    clauses.push(`${lhs} ${op === 'eq' ? '=' : op === 'neq' ? '<>' : op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : op === 'lte' ? '<=' : 'like'} ${rhs}`);
    values.push(make(key, i)[1](val)); i++;
  }
  return { sql: clauses.length ? ' where ' + clauses.join(' and ') : '', values };
}

// Honour ?select=a,b,c. The shim used to always `select *`, which meant a
// narrowed select looked identical to a full one — so the lazily-fetched
// pi_report_archive.snapshot still arrived and the app could not be tested for
// what it does when a column is genuinely absent. An unknown column is a hard
// error rather than a silent pass, since that is exactly the drift worth
// catching. Embedded resources (`select=a(b)`) remain unsupported.
function buildSelect(sp, types) {
  const s = (sp.get('select') || '*').trim();
  if (!s || s === '*') return '*';
  if (/[()]/.test(s)) throw new Error('postgrest shim: embedded resources in select are not supported');
  const cols = s.split(',').map(c => c.trim()).filter(Boolean);
  for (const c of cols) {
    if (!/^[a-z_][a-z0-9_]*$/.test(c)) throw new Error(`postgrest shim: bad column in select "${c}"`);
    if (types && !(c in types)) throw new Error(`postgrest shim: unknown column in select "${c}"`);
  }
  return cols.join(',');
}

function buildOrder(params) {
  const o = params.get('order');
  if (!o) return '';
  const parts = o.split(',').map(seg => {
    const [col, ...mods] = seg.split('.');
    const dir = mods.includes('desc') ? 'desc' : 'asc';
    const nulls = mods.includes('nullsfirst') ? ' nulls first'
                : mods.includes('nullslast') ? ' nulls last' : '';
    return `${col} ${dir}${nulls}`;
  });
  return ' order by ' + parts.join(', ');
}

async function handle(pool, req, body) {
  const url = new URL(req.url, 'http://local');
  const table = url.pathname.replace(/^\/rest\/v1\//, '').replace(/\/$/, '');
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error('bad table: ' + table);
  const params = [...url.searchParams.entries()];
  const sp = url.searchParams;
  const prefer = String(req.headers['prefer'] || '');
  const wantRows = prefer.includes('return=representation');
  const types = await colTypes(pool, table);

  if (req.method === 'GET') {
    const { sql, values } = buildWhere(params, 1, types);
    const limit = sp.get('limit') ? ` limit ${parseInt(sp.get('limit'), 10)}` : '';
    const q = `select ${buildSelect(sp, types)} from ${table}${sql}${buildOrder(sp)}${limit}`;
    const { rows } = await pool.query(q, values);
    return { status: 200, body: rows };
  }

  // node-pg turns a JS array into a Postgres ARRAY literal ({a,b}), which a
  // json/jsonb column rejects outright — "invalid input syntax for type json".
  // Real PostgREST takes the value straight from the request body, so without
  // this every write of a jsonb column (attendee_ids, nepa_checklist, sections,
  // snapshot, dist_groups) fails here and only here. That is a harness lie in
  // the dangerous direction: it invents a failure the app does not have, and
  // would send someone hunting a bug in application code.
  const bind = (col, v) => {
    const ty = (types && types[col]) || '';
    if (/json/.test(ty) && v !== null && typeof v === 'object') return JSON.stringify(v);
    return v;
  };

  if (req.method === 'POST') {
    const items = Array.isArray(body) ? body : [body];
    const out = [];
    for (const item of items) {
      const cols = Object.keys(item);
      if (!cols.length) continue;
      const ph = cols.map((_, n) => `$${n + 1}`);
      let q = `insert into ${table} (${cols.join(',')}) values (${ph.join(',')})`;
      // Text-PK tables upsert on id (Prefer: resolution=merge-duplicates)
      if (sp.get('on_conflict') && prefer.includes('merge-duplicates')) {
        const upd = cols.filter(c => c !== 'id').map(c => `${c}=excluded.${c}`);
        q += ` on conflict (${sp.get('on_conflict')}) do update set ${upd.join(',')}`;
      }
      q += ' returning *';
      const { rows } = await pool.query(q, cols.map(c => bind(c, item[c])));
      out.push(...rows);
    }
    return { status: 201, body: wantRows ? out : null };
  }

  if (req.method === 'PATCH') {
    const cols = Object.keys(body || {});
    const { sql, values } = buildWhere(params, cols.length + 1, types);
    if (!cols.length) return { status: 200, body: [] };
    const sets = cols.map((c, n) => `${c}=$${n + 1}`);
    const q = `update ${table} set ${sets.join(',')}${sql} returning *`;
    const { rows } = await pool.query(q, [...cols.map(c => bind(c, body[c])), ...values]);
    return { status: 200, body: wantRows ? rows : null };
  }

  if (req.method === 'DELETE') {
    const { sql, values } = buildWhere(params, 1, types);
    const { rows } = await pool.query(`delete from ${table}${sql} returning *`, values);
    return { status: 200, body: wantRows ? rows : null };
  }

  return { status: 405, body: { message: 'method not allowed' } };
}

// Starts the shim and returns { origin, close(), calls } — `calls` is a log a
// test can assert against ("did saving this actually PATCH the right table?").
function startShim(pool, { log = false } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', async () => {
      let parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch (_) {}
      const entry = { method: req.method, url: req.url, body: parsed };
      try {
        const r = await handle(pool, req, parsed);
        entry.status = r.status;
        // Rows affected/returned — lets a test assert "the OCC guard matched"
        // rather than just "the request was accepted".
        entry.rows = Array.isArray(r.body) ? r.body.length : null;
        calls.push(entry);
        if (log) console.log(`    ${req.method} ${req.url} -> ${r.status}` +
                             (entry.rows === null ? '' : ` (${entry.rows} row${entry.rows === 1 ? '' : 's'})`));
        res.writeHead(r.status, { 'Content-Type': 'application/json',
                                  'Access-Control-Allow-Origin': '*' });
        res.end(r.body == null ? '' : JSON.stringify(r.body));
      } catch (e) {
        entry.status = 400; entry.error = e.message;
        calls.push(entry);
        if (log) console.log(`    ${req.method} ${req.url} -> 400 ${e.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: e.message, code: e.code || '' }));
      }
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        calls,
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

module.exports = { startShim };
