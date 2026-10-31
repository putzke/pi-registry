-- Project website (Oct 2026): the address, what its analytics counts
-- ("Website visits" when blank) and the visit counts kept from archived PI
-- reports ([{date, visits, by}]), for the "Project website updates" section.
-- Until this runs the app leaves the three columns out of every save
-- (window._webCols), so nothing breaks.
alter table pi_projects add column if not exists website_url text;
alter table pi_projects add column if not exists website_label text;
alter table pi_projects add column if not exists website_readings jsonb not null default '[]'::jsonb;
