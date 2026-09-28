-- DealerFlow v5.2.4.8 — compatibility / manager PIN hotfix support
-- Safe to run repeatedly.
ALTER TABLE room_members
  ADD COLUMN IF NOT EXISTS dealer_number TEXT;

ALTER TABLE room_members
  ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS room_dealer_number_unique
  ON room_members(room_id, dealer_number)
  WHERE dealer_number IS NOT NULL;
