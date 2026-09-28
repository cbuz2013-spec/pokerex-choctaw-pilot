-- Upgrade from DealerFlow 6.0 or 6.1. Safe to repeat.
-- Apply after the existing v6.0 schema/migration. Safe to rerun.

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
