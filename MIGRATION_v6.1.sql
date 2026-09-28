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
