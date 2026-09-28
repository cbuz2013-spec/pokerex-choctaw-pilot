-- DealerFlow v5.2.4.6 — Choctaw Pilot
-- Safe/idempotent schema guard for room archive support.
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS rooms_org_archived_idx
  ON rooms(organization_id, archived_at);
