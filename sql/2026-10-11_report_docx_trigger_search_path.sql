-- Pin the search_path of the report-share trigger function.
-- Supabase's security advisor flags any function whose search_path is left to
-- the caller ("function_search_path_mutable"). This one only reads NEW/OLD and
-- raises, so an empty search_path changes nothing about what it does.
alter function public.pi_report_archive_require_docx() set search_path = '';

-- Check: should return one row with proconfig = {search_path=""}
select proname, proconfig from pg_proc where proname = 'pi_report_archive_require_docx';
