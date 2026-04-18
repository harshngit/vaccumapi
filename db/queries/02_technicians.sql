-- ============================================================
-- FILE: db/schema/02_technicians.sql
-- Module: Technicians
-- Depends on: 01_users.sql
-- Run AFTER 01_users.sql
-- ============================================================

-- NOTE: pg_trgm extension and set_updated_at() function are
-- already created in 01_users.sql — no need to repeat them here.

-- ─── ENUM: technician_status ─────────────────────────────────

DO $$ BEGIN
  CREATE TYPE technician_status AS ENUM (
    'Active',
    'On Leave',
    'Inactive'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── TABLE: technicians ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS technicians (
  id              SERIAL            PRIMARY KEY,
  user_id         INTEGER           REFERENCES users(id) ON DELETE SET NULL,
  name            VARCHAR(150)      NOT NULL,
  email           VARCHAR(255),
  phone           VARCHAR(20)       NOT NULL,
  specialization  VARCHAR(100)      NOT NULL,
  status          technician_status NOT NULL DEFAULT 'Active',
  join_date       DATE,
  jobs_completed  INTEGER           NOT NULL DEFAULT 0,
  rating          NUMERIC(3,2)      DEFAULT 0.00
                  CHECK (rating >= 0 AND rating <= 5),
  avatar          VARCHAR(10),
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  technicians                IS 'Field technician profiles — separate from login credentials';
COMMENT ON COLUMN technicians.user_id        IS 'Optional link to users row for mobile login';
COMMENT ON COLUMN technicians.rating         IS 'Average rating 0.00–5.00';
COMMENT ON COLUMN technicians.avatar         IS 'Two-letter initials e.g. RK for Ravi Kumar';
COMMENT ON COLUMN technicians.jobs_completed IS 'Incremented when a job is closed for this technician';

-- ─── TRIGGER: technicians ────────────────────────────────────
-- set_updated_at() function was already created in 01_users.sql

DROP TRIGGER IF EXISTS trg_technicians_updated_at ON technicians;
CREATE TRIGGER trg_technicians_updated_at
  BEFORE UPDATE ON technicians
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ─── INDEXES: technicians ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_technicians_status
  ON technicians (status);

CREATE INDEX IF NOT EXISTS idx_technicians_user_id
  ON technicians (user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_technicians_specialization
  ON technicians (specialization);

-- GIN index for fuzzy name search
-- pg_trgm extension was enabled in 01_users.sql
CREATE INDEX IF NOT EXISTS idx_technicians_name_trgm
  ON technicians USING GIN (name gin_trgm_ops);
