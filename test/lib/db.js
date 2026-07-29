// Ephemeral Postgres for the test harness.
//
// initdb into a temp dir, start on a unix socket, load test/schema.sql, hand
// back a pg Pool. Nothing touches the real Supabase project — the harness
// exists precisely so changes can be exercised without it.
//
// schema.sql is generated from test/schema-columns.txt, which is a verbatim
// dump of the live information_schema. Regenerate both with:
//     node test/lib/build-schema.js
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PGBIN = '/usr/lib/postgresql/16/bin';
// initdb refuses to run as root, so the cluster is owned by the postgres user
// and lives outside the repo (it also must be readable by that user).
const RUN_AS_POSTGRES = process.getuid && process.getuid() === 0;

function sh(cmd) {
  const r = RUN_AS_POSTGRES
    ? spawnSync('su', ['postgres', '-c', cmd], { encoding: 'utf8' })
    : spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`command failed: ${cmd}\n${r.stdout || ''}${r.stderr || ''}`);
  }
  return r.stdout;
}

async function startDb({ schemaFile, keep = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-test-'));
  fs.chmodSync(root, 0o777);
  const data = path.join(root, 'data');
  const sock = path.join(root, 'sock');
  const schemaSrc = schemaFile || path.join(__dirname, '..', 'schema.sql');
  const schema = path.join(root, 'schema.sql');
  fs.copyFileSync(schemaSrc, schema);
  fs.chmodSync(schema, 0o644);
  if (RUN_AS_POSTGRES) execFileSync('chown', ['-R', 'postgres', root]);

  sh(`export PATH=${PGBIN}:$PATH; mkdir -p ${data} ${sock} && initdb -D ${data} -U postgres --auth=trust >/dev/null`);
  sh(`export PATH=${PGBIN}:$PATH; pg_ctl -D ${data} -o "-k ${sock} -c listen_addresses=''" -l ${root}/pg.log -w start >/dev/null`);
  sh(`export PATH=${PGBIN}:$PATH; createdb -h ${sock} hctest`);
  sh(`export PATH=${PGBIN}:$PATH; psql -h ${sock} -d hctest -q -v ON_ERROR_STOP=1 -f ${schema}`);

  const pg = require('pg');
  // Return temporal columns as raw strings, the way PostgREST does. node-pg
  // otherwise parses them into JS Dates, and JSON-serialising a Date truncates
  // microseconds — so a timestamptz stored as …:07.70969+00 came back as
  // …:07.709Z. The app echoes that value into the optimistic-concurrency guard
  // (?updated_at=eq.…), which then matched nothing and made every OCC write
  // look like a conflict. It also keeps date columns as 'YYYY-MM-DD' instead of
  // a full ISO timestamp, which is what the app's date handling expects.
  const asString = v => v;
  for (const oid of [1082 /*date*/, 1083 /*time*/, 1114 /*timestamp*/, 1184 /*timestamptz*/]) {
    pg.types.setTypeParser(oid, asString);
  }
  // bigint as a JSON number, which is what PostgREST emits. node-pg defaults to
  // a string to protect precision, but that changes behaviour: the portal does
  // _projects.find(x => x.id === _projId) with ===, so string ids silently
  // failed to match a numeric _projId and the whole project banner disappeared
  // after switching projects. Ids here are small; fidelity matters more.
  pg.types.setTypeParser(20 /*int8*/, v => Number(v));
  const pool = new pg.Pool({ host: sock, database: 'hctest', user: 'postgres' });

  return {
    pool, socket: sock, dir: root,
    // Run a .sql file (a migration, or the demo seed) against this database.
    runSqlFile(file) {
      const tmp = path.join(root, 'run-' + path.basename(file));
      fs.copyFileSync(file, tmp);
      fs.chmodSync(tmp, 0o644);
      if (RUN_AS_POSTGRES) execFileSync('chown', ['postgres', tmp]);
      return sh(`export PATH=${PGBIN}:$PATH; psql -h ${sock} -d hctest -v ON_ERROR_STOP=1 -f ${tmp} 2>&1`);
    },
    async stop() {
      await pool.end().catch(() => {});
      try { sh(`export PATH=${PGBIN}:$PATH; pg_ctl -D ${data} -m fast stop >/dev/null`); } catch (_) {}
      if (!keep) fs.rmSync(root, { recursive: true, force: true });
      else console.log('  (kept database at ' + root + ')');
    },
  };
}

module.exports = { startDb };
