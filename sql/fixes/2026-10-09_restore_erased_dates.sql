-- Restore dates erased by partial saves (Oct 2026). One-off repair — NOT a
-- migration (sql/fixes/ is never applied by the test harness).
--
-- Cause: index.html's toSB() wrote null into every date column a save did not
-- carry. Attaching a final .docx to an archived report (or flipping Share)
-- blanked that report's period_start/period_end; "Reconcile with UGRC" blanked
-- parcels' notice dates. Fixed in the app the same day.
--
-- 1. Archived report periods — recovered from each report's own frozen
--    snapshot, which kept the period label ("Aug 22, 2026 – Sep 4, 2026").
--    Only rows whose columns are blank AND whose label has both dates.
update pi_report_archive
   set period_start = to_date(trim(split_part(snapshot->>'periodLabel', '–', 1)), 'Mon DD, YYYY'),
       period_end   = to_date(trim(split_part(snapshot->>'periodLabel', '–', 2)), 'Mon DD, YYYY')
 where period_start is null and period_end is null
   and snapshot->>'periodLabel' ~ '^[A-Z][a-z]{2} \d{1,2}, \d{4} – [A-Z][a-z]{2} \d{1,2}, \d{4}$';

-- 2. Demo parcels on 25-3W-DESIGN — the notice dates the demo seed gave them
--    (sql/2026-07-26_udot_conference_demo_seed.sql). Only fills a blank.
update pi_parcels p
   set notice_date = v.d::date
  from (values ('12-047-0001','2026-03-04'), ('12-047-0014','2026-03-06'),
               ('12-047-0015','2026-03-06'), ('12-047-0031','2026-03-18'),
               ('12-047-0038','2026-03-25')) v(num, d)
 where p.parcel_number = v.num and p.notice_date is null
   and p.project_id::text = (select id::text from pi_projects where pid = '25-3W-DESIGN');

-- Check (expect 0 and 0):
--   select count(*) from pi_report_archive where period_start is null and coalesce(snapshot->>'periodLabel','') <> '';
--   select count(*) from pi_parcels where notice_date is null and project_id::text = (select id::text from pi_projects where pid='25-3W-DESIGN') and parcel_number <> '12-047-0044';
