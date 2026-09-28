-- DealerFlow v5.2.4 — Choctaw Pilot
ALTER TABLE room_members
  ADD COLUMN IF NOT EXISTS dealer_number TEXT,
  ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS room_dealer_number_unique
  ON room_members(room_id, dealer_number)
  WHERE dealer_number IS NOT NULL;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS event_name TEXT,
  ADD COLUMN IF NOT EXISTS event_start_date DATE,
  ADD COLUMN IF NOT EXISTS event_end_date DATE;
