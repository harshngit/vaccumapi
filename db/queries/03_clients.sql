-- ============================================================
-- FILE: db/schema/03_clients.sql
-- Module: Clients
-- Depends on: 01_users.sql
-- ============================================================


-- ─── ENUM: client_type ───────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE client_type AS ENUM (
    'Corporate',
    'Residential',
    'Commercial',
    'Healthcare',
    'Government'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- ─── ENUM: client_status ─────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE client_status AS ENUM (
    'Active',
    'Inactive'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- ─── TABLE: clients ──────────────────────────────────────────
-- Client organisations that VDTI provides services to.
-- join_date is set to CURRENT_DATE automatically on INSERT
-- by the application layer.

CREATE TABLE IF NOT EXISTS clients (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(200)   NOT NULL,
  contact_person  VARCHAR(150)   NOT NULL,        -- Primary contact at the client
  email           VARCHAR(255),
  phone           VARCHAR(20),
  address         TEXT,
  type            client_type    NOT NULL DEFAULT 'Corporate',
  status          client_status  NOT NULL DEFAULT 'Active',
  contract_value  NUMERIC(12,2)  DEFAULT 0.00,    -- Indicative total contract value in INR
  join_date       DATE,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  clients                IS 'Client organisations — VDTI''s customers';
COMMENT ON COLUMN clients.contact_person IS 'Name of the primary point of contact at this client';
COMMENT ON COLUMN clients.contract_value IS 'Indicative total contract value in INR (not sum of quotations)';
COMMENT ON COLUMN clients.join_date      IS 'Set to CURRENT_DATE when client is first added';


-- ─── TRIGGER: clients updated_at ─────────────────────────────

DROP TRIGGER IF EXISTS trg_clients_updated_at ON clients;
CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- ─── INDEXES: clients ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_clients_status ON clients (status);
CREATE INDEX IF NOT EXISTS idx_clients_type   ON clients (type);

-- Fuzzy text search on client name and contact person
CREATE INDEX IF NOT EXISTS idx_clients_name_trgm
  ON clients USING GIN (name gin_trgm_ops);
