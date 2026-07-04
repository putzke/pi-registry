-- Full column set for pi_tribal_consultations.
-- The table was created early with a minimal schema; this adds all columns
-- the app expects. Safe to run multiple times (uses ADD COLUMN IF NOT EXISTS).

alter table pi_tribal_consultations
  -- Tribe & contacts
  add column if not exists tribe_type              text,
  add column if not exists tribal_official         text,
  add column if not exists tribal_official_email   text,
  add column if not exists tribal_official_phone   text,
  add column if not exists thpo_contact            text,
  add column if not exists thpo_email              text,
  add column if not exists thpo_phone              text,
  add column if not exists agency_official         text,
  add column if not exists fhwa_liaison            text,

  -- Project & consultation type
  add column if not exists consultation_trigger    text,
  add column if not exists section106_phase        text,

  -- Dates & response
  add column if not exists notification_date       date,
  add column if not exists response_deadline       date,
  add column if not exists response_date           date,
  add column if not exists response_status         text,
  add column if not exists language_access_needed  boolean default false,

  -- ROW & land acquisition
  add column if not exists near_tribal_lands       boolean default false,
  add column if not exists cfr710_review           boolean default false,
  add column if not exists row_type                text,
  add column if not exists ura_notice_date         date,
  add column if not exists bia_involvement         boolean default false,
  add column if not exists bia_approval_status     text,

  -- Agreement & compliance
  add column if not exists moa_required            boolean default false,
  add column if not exists utah_pa_ref             text,
  add column if not exists certification_status    text,
  add column if not exists included_in_annual_report boolean default false,
  add column if not exists annual_report_year      text,

  -- Follow-up & notes
  add column if not exists next_action             text,
  add column if not exists follow_up_date          date,
  add column if not exists notes                   text,

  -- Metadata
  add column if not exists created_at              timestamptz default now();
