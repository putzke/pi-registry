-- Parcel tracking for right-of-way / property-owner campaigns.
--
-- pi_stakeholders.parcel_id is a single text field on the contact, which cannot
-- represent what a ROW campaign actually is:
--   * one owner holding several parcels  — the field holds one value
--   * several owners on one parcel       — the number gets typed once per owner,
--     so a single typo silently splits the parcel into two groups that never
--     appear together again
-- Both directions together are a many-to-many, and a column on one side can't
-- model it.
--
-- It also matters beyond convenience: in a ROW campaign the compliance unit is
-- the PARCEL, not the contact. "Was every affected parcel's owner noticed, and
-- when" is a count over parcels, and there was nothing to count.
--
-- pi_stakeholders.parcel_id is deliberately left in place — it still displays,
-- exports and imports, so nothing that already works breaks. It becomes a
-- convenience label; pi_parcels is the record.
--
-- Idempotent: safe to run more than once.

create table if not exists pi_parcels (
  id               bigint generated always as identity primary key,
  project_id       text,
  parcel_number    text not null,
  situs_address    text,
  -- A parcel with no dwelling or address yet (unsubdivided land) can only be
  -- designated by coordinates, so these are first-class rather than an add-on.
  latitude         text,
  longitude        text,
  acquisition_type text,          -- Full take / Partial take / TCE / Permanent easement / None
  status           text,          -- Not started / Notice sent / Contacted / Negotiating / Acquired / Declined
  notice_date      date,
  notes            text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  updated_by       text
);

-- The typo guard. Two rows for the same parcel number on one project is the
-- failure this table exists to prevent, so the database refuses it rather than
-- relying on the UI to check.
create unique index if not exists pi_parcels_proj_number_uniq
  on pi_parcels (project_id, lower(trim(parcel_number)));

create table if not exists pi_parcel_owners (
  id             bigint generated always as identity primary key,
  parcel_id      text,
  stakeholder_id text,
  ownership_role text,            -- Owner / Co-owner / Tenant / Agent / Heir / Unknown
  created_at     timestamptz default now()
);

-- A contact should appear once per parcel; the role says what they are.
create unique index if not exists pi_parcel_owners_uniq
  on pi_parcel_owners (parcel_id, stakeholder_id);

create index if not exists pi_parcels_project_idx on pi_parcels (project_id);
create index if not exists pi_parcel_owners_parcel_idx on pi_parcel_owners (parcel_id);
create index if not exists pi_parcel_owners_stake_idx  on pi_parcel_owners (stakeholder_id);

-- RLS + grants. BOTH roles, every time:
--   * `anon`          — the client portal, which is genuinely unauthenticated.
--   * `authenticated` — the desktop and mobile apps. getAuthHeaders() sends the
--     signed-in user's access token when a session exists, so PostgREST runs
--     those requests as `authenticated`, NOT as `anon`.
-- Granting one and not the other fails silently in whichever app uses the other
-- role: sbGet() turns the failed read into an empty array, so the view renders
-- "nothing here yet" over a table full of rows. Missing `anon` was learned the
-- hard way in sql/2026-07-06_client_summaries_grant_fix.sql; missing
-- `authenticated` cost the Parcels view the same way — see
-- sql/2026-08-09_parcels_grant_fix.sql.
alter table pi_parcels        enable row level security;
alter table pi_parcel_owners  enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where tablename='pi_parcels' and policyname='pi_parcels_anon_all') then
    create policy pi_parcels_anon_all on pi_parcels
      for all to anon, authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies
                  where tablename='pi_parcel_owners' and policyname='pi_parcel_owners_anon_all') then
    create policy pi_parcel_owners_anon_all on pi_parcel_owners
      for all to anon, authenticated using (true) with check (true);
  end if;
end $$;

grant select, insert, update, delete on pi_parcels       to anon, authenticated;
grant select, insert, update, delete on pi_parcel_owners to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
