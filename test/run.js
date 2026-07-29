#!/usr/bin/env node
// Test runner for Horizon COMPASS.
//
//   node test/run.js                 run everything
//   node test/run.js schema drift    run tests whose name matches a filter
//   VERBOSE=1 node test/run.js       log every shim request
//
// Each test file exports { name, run({ db, shim, openApp, t }) }. One Postgres
// and one shim are shared across the run; each test gets a clean database via
// t.reset().
const fs = require('fs');
const path = require('path');
const { startDb } = require('./lib/db');
const { startShim } = require('./lib/postgrest');
const { openApp } = require('./lib/app');

const SQL = path.join(__dirname, '..', 'sql');
const VERBOSE = !!process.env.VERBOSE;

class Assert {
  constructor() { this.checks = []; }
  ok(cond, msg)        { this.checks.push({ pass: !!cond, msg }); return !!cond; }
  eq(actual, expected, msg) {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    this.checks.push({ pass, msg: msg + (pass ? '' : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`) });
    return pass;
  }
  gt(actual, bound, msg) {
    const pass = actual > bound;
    this.checks.push({ pass, msg: msg + (pass ? '' : `  (expected > ${bound}, got ${actual})`) });
    return pass;
  }
  get failed() { return this.checks.filter(c => !c.pass); }
}

(async () => {
  const filters = process.argv.slice(2);
  console.log('Horizon COMPASS test harness\n');

  process.stdout.write('  starting postgres… ');
  const db = await startDb();
  console.log('ok');

  process.stdout.write('  applying migrations… ');
  const migrations = fs.readdirSync(SQL).filter(f => f.endsWith('.sql') && !f.includes('demo_seed')).sort();
  for (const m of migrations) {
    // Migrations are additive against the live schema; several will already be
    // satisfied by test/schema.sql, which is fine — they're all idempotent.
    try { db.runSqlFile(path.join(SQL, m)); } catch (e) { /* already applied */ }
  }
  console.log(migrations.length + ' file(s)');

  process.stdout.write('  starting rest shim… ');
  const shim = await startShim(db.pool, { log: VERBOSE });
  console.log(shim.origin + '\n');

  const dir = path.join(__dirname, 'tests');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();
  let pass = 0, fail = 0, skipped = 0;
  const startedAt = Date.now();

  // Snapshot the empty schema so each test can start clean.
  const TABLES = (await db.pool.query(
    `select tablename from pg_tables where schemaname='public' order by tablename`)).rows.map(r => r.tablename);

  for (const f of files) {
    const mod = require(path.join(dir, f));
    if (filters.length && !filters.some(x => (mod.name + ' ' + f).toLowerCase().includes(x.toLowerCase()))) {
      skipped++; continue;
    }
    const t = new Assert();
    t.reset = async () => {
      await db.pool.query(`truncate ${TABLES.map(x => '"' + x + '"').join(',')} restart identity cascade`);
      shim.calls.length = 0;
    };
    t.sql = (q, v) => db.pool.query(q, v).then(r => r.rows);
    t.seed = () => db.runSqlFile(path.join(SQL, '2026-07-26_udot_conference_demo_seed.sql'));
    t.open = (file, opts) => openApp(file, { shimOrigin: shim.origin, ...opts });

    process.stdout.write(`  ${mod.name} … `);
    try {
      await t.reset();
      await mod.run({ db, shim, t });
      if (t.failed.length) {
        fail++; console.log('FAIL');
        t.failed.forEach(c => console.log('      ✗ ' + c.msg));
      } else {
        pass++; console.log(`ok (${t.checks.length} checks)`);
      }
    } catch (e) {
      fail++; console.log('ERROR');
      console.log('      ' + (e.stack || e.message).split('\n').slice(0, 6).join('\n      '));
    }
  }

  await shim.close();
  await db.stop();
  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n  ${pass} passed, ${fail} failed${skipped ? ', ' + skipped + ' filtered out' : ''}  (${secs}s)`);
  process.exit(fail ? 1 : 0);
})();
