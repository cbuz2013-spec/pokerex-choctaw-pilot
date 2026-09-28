-- DealerFlow v5.2.4.7 — owner management + AI schedule import support
-- Safe to run more than once.
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
CREATE UNIQUE INDEX IF NOT EXISTS organization_owners_org_lower_name_uq
  ON organization_owners(organization_id, lower(name));
INSERT INTO organization_owners(organization_id,name,pin_hash,pin_salt,active)
SELECT id,owner_name,owner_pin_hash,owner_pin_salt,true FROM organizations
ON CONFLICT DO NOTHING;
