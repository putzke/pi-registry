// ============================================================
// HORIZON COMPASS — Clear All Data (wipe only, no re-seed)
//
// Use this to remove the dummy/seeded data before entering real
// project data, leaving the app completely empty.
//
// HOW TO RUN:
//   1. Open the live app (https://putzke.github.io/pi-registry/) and
//      let it fully load.
//   2. Open DevTools (F12) → Console tab.
//   3. Paste this entire file and press Enter.
//   4. Confirm the prompt.
//
// Deletes in foreign-key-safe order (children before parents), the
// same order the seed script uses. Portal tables (portal_links,
// client_access, client_summaries) are NOT touched — they aren't
// seeded and hold access grants, not project data.
//
// Reversible: re-run seed-sample-data.js anytime to get dummy data back.
// ============================================================

(async function CLEAR_ALL() {
  if (typeof DB === 'undefined' || typeof sbDelete !== 'function') {
    console.error('COMPASS app not detected. Open the app first, then paste this script.');
    return;
  }

  const WIPE_ORDER = [
    'report_archive','reports','dismissed_pairs','group_members','groups',
    'tribal_consultations','public_comments','comment_periods','deliverables',
    'commitments','issues','issue_interactions','meetings','interactions',
    'project_stakeholders','stakeholders','projects'
  ];

  // Tally what's about to be deleted so the confirmation is informed.
  let total = 0;
  const counts = WIPE_ORDER.map(function(t){
    var n = (DB.get(t) || []).length;
    total += n;
    return t + ': ' + n;
  });

  if (total === 0) {
    console.log('Nothing to clear — the database is already empty.');
    return;
  }

  console.log('About to delete ' + total + ' rows:\n  ' + counts.join('\n  '));
  if (!window.confirm('Delete ALL ' + total + ' rows of project data from Supabase?\n\nThis wipes everything currently in the app (dummy or real). It cannot be undone from here — export first if unsure.')) {
    console.log('Cancelled. Nothing was deleted.');
    return;
  }

  console.log('⚠️  Clearing…');
  for (const t of WIPE_ORDER) {
    const rows = DB.get(t) || [];
    for (const r of rows) {
      await sbDelete(t, r.id).catch(function(){});
    }
    if (rows.length) console.log('  Cleared ' + rows.length + ' from ' + t);
  }

  await loadAllData();
  if (typeof render === 'function') render();
  console.log('\n✓ Done. The app is now empty and ready for real data.');
})();
