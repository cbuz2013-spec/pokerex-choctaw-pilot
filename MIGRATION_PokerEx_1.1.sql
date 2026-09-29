
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS owner_id BIGINT REFERENCES organization_owners(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS sessions_owner_idx ON sessions(owner_id);

CREATE TABLE IF NOT EXISTS chat_conversations (
 id TEXT PRIMARY KEY,room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('channel','dm')),name TEXT NOT NULL,
 conversation_key TEXT NOT NULL,participants JSONB NOT NULL DEFAULT '[]',
 managers_only BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(room_id,conversation_key)
);
CREATE TABLE IF NOT EXISTS chat_messages (
 id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
 sender_key TEXT NOT NULL,sender_name TEXT NOT NULL,body TEXT NOT NULL,
 client_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,sender_key,client_id)
);
CREATE INDEX IF NOT EXISTS chat_message_history_idx ON chat_messages(conversation_id,created_at,id);
