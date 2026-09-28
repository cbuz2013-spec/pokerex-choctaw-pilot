-- DealerFlow v6.0 — tournament operations upgrade
-- Safe to run repeatedly.

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS event_name TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS event_start_date DATE;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS event_end_date DATE;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS eo_method TEXT NOT NULL DEFAULT 'shift_start';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS eo_tiebreaker TEXT NOT NULL DEFAULT 'signup';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS eo_min_hours NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS eo_min_downs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS geofence_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS geofence_lat DOUBLE PRECISION;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS geofence_lng DOUBLE PRECISION;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS geofence_radius_m INTEGER NOT NULL DEFAULT 250;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS resource_config JSONB NOT NULL DEFAULT '{"tables":[],"breaks":["Break"],"brushes":["Brush"],"setup":["Setup"]}'::jsonb;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE room_members ADD COLUMN IF NOT EXISTS dealer_number TEXT;
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS room_dealer_number_unique ON room_members(room_id,dealer_number) WHERE dealer_number IS NOT NULL;

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS shift_label TEXT;

ALTER TABLE down_entries DROP CONSTRAINT IF EXISTS down_entries_entry_kind_check;
ALTER TABLE down_entries ADD CONSTRAINT down_entries_entry_kind_check CHECK (entry_kind IN ('table','break','setup','brush'));

CREATE TABLE IF NOT EXISTS organization_owners (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS organization_owners_org_lower_name_uq ON organization_owners(organization_id, lower(name));
INSERT INTO organization_owners(organization_id,name,pin_hash,pin_salt,active)
SELECT id,owner_name,owner_pin_hash,owner_pin_salt,true FROM organizations
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
  member_id BIGINT REFERENCES room_members(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  subscription JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(room_id, endpoint)
);
CREATE INDEX IF NOT EXISTS push_subscriptions_room_member_idx ON push_subscriptions(room_id,member_id,active);

CREATE TABLE IF NOT EXISTS notification_events (
  id BIGSERIAL PRIMARY KEY,
  room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
  member_id BIGINT REFERENCES room_members(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  UNIQUE(room_id,member_id,event_key)
);
CREATE INDEX IF NOT EXISTS notification_events_member_idx ON notification_events(room_id,member_id,created_at DESC);
