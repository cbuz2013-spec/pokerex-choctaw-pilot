-- DealerFlow v5.2.4.4 — Owner room controls + unified roster/schedule import
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS rooms_org_archived_idx
  ON rooms(organization_id, archived_at);
