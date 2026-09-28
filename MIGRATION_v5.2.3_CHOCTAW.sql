-- DealerFlow v5.2.3 — Choctaw Pilot
-- Safe additive migration over v5.2.x

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS event_name TEXT,
  ADD COLUMN IF NOT EXISTS event_start_date DATE,
  ADD COLUMN IF NOT EXISTS event_end_date DATE;

-- Existing rooms keep their current EO method until a manager saves the pilot event.
-- The Choctaw pilot setup action sets:
--   eo_method = 'choctaw_prior_hours'
--   eo_tiebreaker = 'signup'

-- No new table is required. Prior-hours EO priority is calculated from completed
-- time_entries whose clock_in date is before CURRENT_DATE.
