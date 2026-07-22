-- Per-project influence level on the stakeholder↔project link.
--
-- Influence was previously a single global value on the stakeholder record
-- (pi_stakeholders.influence_tier) and was not editable in the normal workflow,
-- so the sentiment/engagement matrix defaulted everyone to "Medium". Move it to
-- the project link so a contact's influence can differ per project — consistent
-- with how "support" already works.
--
-- SAFE / ADDITIVE. Run once in the Supabase SQL Editor BEFORE the app writes
-- influence to a link (the app now includes this column when saving a link).

alter table pi_project_stakeholders
  add column if not exists influence text default 'Medium';

-- Backfill existing links from the stakeholder's global tier where available,
-- otherwise leave the 'Medium' default.
update pi_project_stakeholders ps
set influence = coalesce(nullif(s.influence_tier, ''), 'Medium')
from pi_stakeholders s
where ps.stakeholder_id = s.id::text
  and (ps.influence is null or ps.influence = '');
