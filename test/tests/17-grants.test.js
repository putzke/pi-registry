// Every migration must grant BOTH PostgREST roles.
//
// Supabase runs requests as one of two roles, and which one depends on the app:
//   * `anon`          — client-portal.html, genuinely unauthenticated.
//   * `authenticated` — index.html and mobile.html, which sign in through
//     Supabase auth; getAuthHeaders() then sends the user's access token
//     instead of the anon key.
//
// Grant one and not the other and the app using the missing role reads an empty
// table. It is silent in both directions: RLS with no matching policy returns
// zero rows rather than an error, and sbGet() turns even a hard 403 into `[]`.
// So the view renders "nothing here yet" over a table full of data.
//
// It has now happened twice, once each way. pi_client_summaries shipped without
// `anon` (sql/2026-07-06_client_summaries_grant_fix.sql). pi_parcels shipped
// without `authenticated` — the rows were in the database, the portal showed
// them, and the desktop Parcels view was blank
// (sql/2026-08-09_parcels_grant_fix.sql).
//
// The check is static because it has to be. A table created through the
// Supabase dashboard is granted to both roles automatically, so the live
// database hides the mistake for every table except the ones a migration
// creates — and the harness, which creates everything as `postgres`, cannot
// tell those two cases apart. What the migration FILE says is the real
// contract.
//
// Scope is therefore tables a migration CREATES. Those start with no grants at
// all, so the migration owns the whole contract. A migration that only tops up
// a dashboard-created table — 2026-07-04_portal_links.sql adding portal read
// access to pi_projects, pi_interactions and the rest — is correctly one-sided:
// it is opening those tables to the portal, and `authenticated` already had
// full access. Holding those to the same rule would demand grants that are
// already there and a policy the portal has no business widening.
const fs = require('fs');
const path = require('path');
const SQL = path.join(__dirname, '..', '..', 'sql');
const ROLES = ['anon', 'authenticated'];

// Deliberate asymmetries, each with the reason it is safe.
const ALLOWED = {
  // A portal visitor holds an unauthenticated link. Letting that role mint or
  // revoke links would let anyone with one URL manufacture others.
  pi_portal_links: { anon: ['SELECT'] },
  // Grants are pasted in by an admin (Option C provisioning). anon having no
  // write is what stops a client self-granting access to another project.
  pi_client_access: { anon: ['SELECT'], authenticated: ['SELECT'] },
};

// `grant a, b on t1, t2 to r1, r2;` — possibly across lines.
const GRANT = /grant\s+([\s\S]+?)\s+on\s+([\s\S]+?)\s+to\s+([\s\S]+?);/gi;
const POLICY = /create\s+policy\s+(\S+)\s+on\s+(\S+)([\s\S]*?)(?:using|with\s+check|;)/gi;

module.exports = {
  name: 'migrations — every grant and policy covers both PostgREST roles',
  async run({ t, db }) {
    const files = fs.readdirSync(SQL).filter(f => f.endsWith('.sql') && !f.includes('demo_seed')).sort();
    t.gt(files.length, 5, 'found the migration files');

    // table -> role -> Set(privilege), accumulated across every migration in
    // date order, so a later fix migration counts.
    const granted = {};
    const created = new Set();
    for (const f of files) {
      const sql = fs.readFileSync(path.join(SQL, f), 'utf8')
        .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
      let m;
      const CREATE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(pi_\w+)/gi;
      while ((m = CREATE.exec(sql))) created.add(m[1]);
      GRANT.lastIndex = 0;
      while ((m = GRANT.exec(sql))) {
        const privs = m[1].split(',').map(s => s.trim().toUpperCase());
        const targets = m[2].split(',').map(s => s.trim());
        const roles = m[3].split(',').map(s => s.trim());
        // "all sequences in schema public" and the like — not a table grant.
        if (targets.some(x => /\s/.test(x))) continue;
        for (const tbl of targets) {
          for (const role of roles) {
            if (!ROLES.includes(role)) continue;
            granted[tbl] = granted[tbl] || {};
            granted[tbl][role] = granted[tbl][role] || new Set();
            privs.forEach(p => granted[tbl][role].add(p));
          }
        }
      }
    }

    const tables = Object.keys(granted).filter(x => created.has(x)).sort();
    t.eq(tables, ['pi_client_access','pi_client_summaries','pi_parcel_owners',
                  'pi_parcels','pi_portal_links'],
         'every table a migration creates also grants it — none was missed entirely');

    for (const tbl of tables) {
      const allow = ALLOWED[tbl];
      const got = r => [...(granted[tbl][r] || [])].sort();

      if (allow) {
        for (const role of ROLES) {
          if (!allow[role]) continue;
          t.eq(got(role), allow[role].slice().sort(),
               `${tbl}: ${role} holds exactly the documented reduced privileges`);
        }
      }

      // Both roles must at minimum be able to read.
      for (const role of ROLES) {
        t.ok((granted[tbl][role] || new Set()).has('SELECT'),
             `${tbl}: granted SELECT to ${role}`);
      }

      // And write privileges must match, so one app cannot save what the other
      // cannot. Skipped where the asymmetry is deliberate and documented above.
      if (!allow) {
        t.eq(got('authenticated'), got('anon'),
             `${tbl}: both roles hold the same privileges`);
      }
    }

    // ── policies must name both roles too ──────────────────────────────────
    // A grant without a matching policy is the same silent blank screen, and
    // this half is easier to miss because it fails with zero rows, not an error.
    for (const f of files) {
      const sql = fs.readFileSync(path.join(SQL, f), 'utf8')
        .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
      let m;
      POLICY.lastIndex = 0;
      while ((m = POLICY.exec(sql))) {
        const [, name, tbl, tail] = m;
        if (!created.has(tbl)) continue;     // same scoping as the grants above
        const to = /\bto\s+([a-z_,\s]+?)(?:\s+using|\s+with|$)/i.exec(tail);
        if (!to) continue;                   // no TO clause = applies to every role
        const roles = to[1].split(',').map(s => s.trim());
        const allow = ALLOWED[tbl];
        if (allow && Object.keys(allow).length === 1) continue;  // scoped on purpose
        for (const role of ROLES) {
          t.ok(roles.includes(role),
               `${f}: policy ${name} on ${tbl} applies to ${role}`);
        }
      }
    }

    // ── and prove it lands, not just that the file says so ─────────────────
    // schema.sql now creates both roles, so migration grants actually apply
    // here. Before that they all failed and run.js swallowed the error, which
    // is the reason no test could see the parcels bug.
    for (const m of files) { try { db.runSqlFile(path.join(SQL, m)); } catch (_) {} }
    const live = (await t.sql(`
      select has_table_privilege('anon','pi_parcels','SELECT')                a_sel,
             has_table_privilege('authenticated','pi_parcels','SELECT')       u_sel,
             has_table_privilege('authenticated','pi_parcels','INSERT')       u_ins,
             has_table_privilege('authenticated','pi_parcel_owners','SELECT') o_sel,
             has_table_privilege('authenticated','pi_parcel_owners','INSERT') o_ins`))[0];
    t.eq(live, { a_sel: true, u_sel: true, u_ins: true, o_sel: true, o_ins: true },
         'both roles really can read and write the parcel tables');

    const pol = await t.sql(`
      select tablename, roles::text[] r from pg_policies
       where tablename in ('pi_parcels','pi_parcel_owners') order by tablename`);
    t.eq(pol.length, 2, 'both parcel tables have a policy');
    pol.forEach(p => t.ok(p.r.includes('anon') && p.r.includes('authenticated'),
                          `${p.tablename}: policy covers both roles (got ${p.r.join(', ')})`));
  },
};
