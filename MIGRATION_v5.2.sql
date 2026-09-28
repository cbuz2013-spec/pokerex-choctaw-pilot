ALTER TABLE rooms ADD COLUMN IF NOT EXISTS eo_method TEXT NOT NULL DEFAULT 'shift_start';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS eo_tiebreaker TEXT NOT NULL DEFAULT 'signup';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS eo_min_hours NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS eo_min_downs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS shift_label TEXT;
CREATE TABLE IF NOT EXISTS down_entries (
  id TEXT PRIMARY KEY,
  room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
  member_id BIGINT REFERENCES room_members(id) ON DELETE SET NULL,
  dealer_name TEXT NOT NULL,
  series_name TEXT NOT NULL,
  work_date DATE NOT NULL,
  shift_start TEXT NOT NULL,
  table_label TEXT NOT NULL,
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('table','break','setup')),
  down_start TEXT NOT NULL,
  down_end TEXT NOT NULL,
  correction_needed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS down_entries_room_dealer_date_idx ON down_entries(room_id,dealer_name,work_date);
CREATE INDEX IF NOT EXISTS down_entries_room_series_idx ON down_entries(room_id,dealer_name,series_name);
