-- ============================================================
-- FILE: db/schema/03_clients.sql
-- Module: Clients
-- Depends on: 01_users.sql
-- Run AFTER 01_users.sql
-- ============================================================

-- NOTE: pg_trgm extension and set_updated_at() function are
-- already created in 01_users.sql — no need to repeat them here.

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

CREATE TABLE IF NOT EXISTS clients (
  id              SERIAL         PRIMARY KEY,
  name            VARCHAR(200)   NOT NULL,
  contact_person  VARCHAR(150)   NOT NULL,
  email           VARCHAR(255),
  phone           VARCHAR(20),
  address         TEXT,
  type            client_type    NOT NULL DEFAULT 'Corporate',
  status          client_status  NOT NULL DEFAULT 'Active',
  contract_value  NUMERIC(12,2)  DEFAULT 0.00,
  join_date       DATE,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  clients                IS 'Client organisations — VDTI customers';
COMMENT ON COLUMN clients.contact_person IS 'Primary point of contact at this client';
COMMENT ON COLUMN clients.contract_value IS 'Indicative total contract value in INR';
COMMENT ON COLUMN clients.join_date      IS 'Set to CURRENT_DATE when client is first added';

-- ─── TRIGGER: clients ────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_clients_updated_at ON clients;
CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ─── INDEXES: clients ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_clients_status ON clients (status);
CREATE INDEX IF NOT EXISTS idx_clients_type   ON clients (type);

-- GIN index for fuzzy name search
-- pg_trgm extension was enabled in 01_users.sql
CREATE INDEX IF NOT EXISTS idx_clients_name_trgm
  ON clients USING GIN (name gin_trgm_ops);
