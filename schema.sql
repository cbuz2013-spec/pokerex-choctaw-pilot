CREATE TABLE IF NOT EXISTS organizations (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial',
  owner_name TEXT NOT NULL DEFAULT 'Owner',
  owner_pin_hash TEXT NOT NULL,
  owner_pin_salt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  room_name TEXT NOT NULL,
  shift_name TEXT NOT NULL DEFAULT 'PM Shift',
  require_pickup_approval BOOLEAN NOT NULL DEFAULT TRUE,
  require_swap_approval BOOLEAN NOT NULL DEFAULT TRUE,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room_members (
  id BIGSERIAL PRIMARY KEY,
  room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dealer_number TEXT,
  must_change_pin BOOLEAN NOT NULL DEFAULT FALSE,
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  manager_pin_hash TEXT,
  manager_pin_salt TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  is_manager BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS room_members_room_lower_name_uq ON room_members(room_id, lower(name));

CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
  member_id BIGINT REFERENCES room_members(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','dealer','manager')),
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS eo_requests (
  id TEXT PRIMARY KEY,
  room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
  member_id BIGINT REFERENCES room_members(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  queue_order BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS eo_room_status_idx ON eo_requests(room_id,status,queue_order);

CREATE TABLE IF NOT EXISTS join_requests (
  id TEXT PRIMARY KEY,
  room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dealer_number TEXT,
  must_change_pin BOOLEAN NOT NULL DEFAULT FALSE,
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  dealer_name TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shifts_room_date_idx ON shifts(room_id,shift_date);

CREATE TABLE IF NOT EXISTS shift_requests (
  id TEXT PRIMARY KEY,
  room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
  shift_id TEXT REFERENCES shifts(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('pickup','swap')),
  requester TEXT NOT NULL,
  acceptor TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  denied_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
  member_id BIGINT REFERENCES room_members(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  clock_in TIMESTAMPTZ NOT NULL,
  clock_out TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS time_entries_room_name_idx ON time_entries(room_id,name,clock_in);

CREATE TABLE IF NOT EXISTS attendance (
  id BIGSERIAL PRIMARY KEY,
  room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
  shift_id TEXT REFERENCES shifts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  marked_by TEXT,
  UNIQUE(room_id,shift_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  event_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_room_time_idx ON audit_logs(room_id,created_at DESC);

-- DealerFlow v5.2 Giant Build additions
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

CREATE UNIQUE INDEX IF NOT EXISTS room_dealer_number_unique ON room_members(room_id,dealer_number) WHERE dealer_number IS NOT NULL;

-- DealerFlow v5.2.4.7 owner management
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

-- DealerFlow v6.0 additions
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS event_name TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS event_start_date DATE;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS event_end_date DATE;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS geofence_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS geofence_lat DOUBLE PRECISION;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS geofence_lng DOUBLE PRECISION;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS geofence_radius_m INTEGER NOT NULL DEFAULT 250;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS resource_config JSONB NOT NULL DEFAULT '{"tables":[],"breaks":["Break"],"brushes":["Brush"],"setup":["Setup"]}'::jsonb;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE down_entries DROP CONSTRAINT IF EXISTS down_entries_entry_kind_check;
ALTER TABLE down_entries ADD CONSTRAINT down_entries_entry_kind_check CHECK (entry_kind IN ('table','break','setup','brush'));
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

-- DealerFlow 6.1

CREATE TABLE IF NOT EXISTS down_card_uploads (
 id TEXT PRIMARY KEY, room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 filename TEXT NOT NULL, image_data TEXT NOT NULL, extracted JSONB NOT NULL,
 reviewed JSONB, uploaded_by TEXT NOT NULL, imported_by TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), imported_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS down_card_uploads_room_idx ON down_card_uploads(room_id,created_at);
ALTER TABLE down_entries ADD COLUMN IF NOT EXISTS card_upload_id TEXT REFERENCES down_card_uploads(id) ON DELETE SET NULL;
ALTER TABLE down_entries ADD COLUMN IF NOT EXISTS dealer_number_snapshot TEXT;
CREATE INDEX IF NOT EXISTS down_entries_card_idx ON down_entries(card_upload_id);

-- PokerEx 1.0 notifications and messaging

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Chicago';
CREATE TABLE IF NOT EXISTS manager_messages (
 id TEXT PRIMARY KEY,room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,request_hash TEXT NOT NULL,sender TEXT NOT NULL,
 subject TEXT NOT NULL,body TEXT NOT NULL,audience TEXT NOT NULL,
 recipients JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(room_id,request_id)
);
CREATE TABLE IF NOT EXISTS push_deliveries (
 id BIGSERIAL PRIMARY KEY,notification_id BIGINT NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
 subscription_id BIGINT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
 room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 last_error TEXT,sent_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(notification_id,subscription_id)
);
CREATE INDEX IF NOT EXISTS push_deliveries_due_idx ON push_deliveries(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS notification_worker_status (
 id INTEGER PRIMARY KEY CHECK(id=1),last_started_at TIMESTAMPTZ,last_completed_at TIMESTAMPTZ
);
