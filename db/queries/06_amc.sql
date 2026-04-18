-- ============================================================
-- FILE: db/schema/06_amc.sql
-- Module: AMC Contracts
-- Depends on: 01_users.sql, 03_clients.sql
-- Run AFTER 01, 02, 03, 04, 05
-- ============================================================

-- NOTE: pg_trgm extension and set_updated_at() function are
-- already created in 01_users.sql — no need to repeat them here.

-- ─── ENUM: amc_status ────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE amc_status AS ENUM (
    'Active',
    'Expiring Soon',
    'Expired'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── TABLE: amc_contracts ────────────────────────────────────

CREATE TABLE IF NOT EXISTS amc_contracts (
  id                    VARCHAR(20)   PRIMARY KEY,
  client_id             INTEGER       NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  title                 VARCHAR(255)  NOT NULL,
  start_date            DATE          NOT NULL,
  end_date              DATE          NOT NULL,
  value                 NUMERIC(12,2) NOT NULL,
  status                amc_status    NOT NULL DEFAULT 'Active',
  next_service_date     DATE,
  renewal_reminder_days INTEGER       NOT NULL DEFAULT 30,
  created_by_user_id    INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT amc_end_after_start CHECK (end_date > start_date),
  CONSTRAINT amc_reminder_days_valid CHECK (
    renewal_reminder_days > 0 AND renewal_reminder_days <= 365
  )
);

COMMENT ON TABLE  amc_contracts                       IS 'Annual Maintenance Contracts with clients';
COMMENT ON COLUMN amc_contracts.renewal_reminder_days IS 'Days before end_date to trigger renewal email';
COMMENT ON COLUMN amc_contracts.next_service_date     IS 'Next scheduled service visit date';
COMMENT ON COLUMN amc_contracts.value                 IS 'Total contract value in INR';

-- ─── TABLE: amc_services ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS amc_services (
  id            SERIAL        PRIMARY KEY,
  amc_id        VARCHAR(20)   NOT NULL REFERENCES amc_contracts(id) ON DELETE CASCADE,
  service_name  VARCHAR(150)  NOT NULL,
  UNIQUE (amc_id, service_name)
);

COMMENT ON TABLE amc_services IS 'Services covered under an AMC contract';

-- ─── TRIGGER: amc_contracts ──────────────────────────────────

DROP TRIGGER IF EXISTS trg_amc_updated_at ON amc_contracts;
CREATE TRIGGER trg_amc_updated_at
  BEFORE UPDATE ON amc_contracts
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ─── INDEXES: amc_contracts ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_amc_client_id ON amc_contracts (client_id);
CREATE INDEX IF NOT EXISTS idx_amc_status    ON amc_contracts (status);
CREATE INDEX IF NOT EXISTS idx_amc_end_date  ON amc_contracts (end_date);
