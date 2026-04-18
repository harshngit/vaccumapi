  -- ============================================================
-- FILE: db/schema/02_technicians.sql
-- Module: Technicians
-- Depends on: 01_users.sql  (references users.id)
-- ============================================================


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
-- Field technician profiles — operational attributes kept
-- separate from login credentials (users table).
--
-- A technician may have a linked users row (user_id IS NOT NULL)
-- so they can log in via the mobile app.
-- If user_id IS NULL the technician is admin-managed only.

CREATE TABLE IF NOT EXISTS technicians (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  -- ^ If this technician also has a login account, link here.
  --   NULL = technician is managed by admin but does not log in.
  name            VARCHAR(150)  NOT NULL,
  email           VARCHAR(255),
  phone           VARCHAR(20)   NOT NULL,
  specialization  VARCHAR(100)  NOT NULL,         -- e.g. HVAC, Electrical, Plumbing
  status          technician_status NOT NULL DEFAULT 'Active',
  join_date       DATE,
  jobs_completed  INTEGER       NOT NULL DEFAULT 0,
  rating          NUMERIC(3,2)  DEFAULT 0.00
                  CHECK (rating >= 0 AND rating <= 5),
  avatar          VARCHAR(10),                    -- initials e.g. 'RK' for Ravi Kumar
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  technicians               IS 'Field technician profiles — operational attributes separate from login credentials';
COMMENT ON COLUMN technicians.user_id       IS 'Optional link to users row if this technician has a mobile login account';
COMMENT ON COLUMN technicians.rating        IS 'Average rating 0.00–5.00, updated via job closure or manual entry';
COMMENT ON COLUMN technicians.avatar        IS 'Two-letter initials for UI avatars, e.g. RK for Ravi Kumar';
COMMENT ON COLUMN technicians.jobs_completed IS 'Incremented automatically when a job is closed for this technician';


-- ─── TRIGGER: technicians updated_at ─────────────────────────

DROP TRIGGER IF EXISTS trg_technicians_updated_at ON technicians;
CREATE TRIGGER trg_technicians_updated_at
  BEFORE UPDATE ON technicians
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- ─── INDEXES: technicians ─────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_technicians_status
  ON technicians (status);

CREATE INDEX IF NOT EXISTS idx_technicians_user_id
  ON technicians (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_technicians_specialization
  ON technicians (specialization);

-- Fuzzy text search on technician name
CREATE INDEX IF NOT EXISTS idx_technicians_name_trgm
  ON technicians USING GIN (name gin_trgm_ops);
