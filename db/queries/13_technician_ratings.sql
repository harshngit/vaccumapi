-- ============================================================
-- FILE: db/schema/13_technician_ratings.sql
-- Module: Technician Ratings
-- Depends on: 02_technicians.sql, 04_jobs.sql, 01_users.sql
-- Run AFTER 02_technicians.sql and 04_jobs.sql
-- ============================================================

-- ─── TABLE: technician_ratings ──────────────────────────────

CREATE TABLE IF NOT EXISTS technician_ratings (
  id              SERIAL        PRIMARY KEY,
  technician_id   INTEGER       NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  job_id          VARCHAR(20)   REFERENCES jobs(id) ON DELETE SET NULL,
  rating          NUMERIC(2,1)  NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review          TEXT,
  rated_by        INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  technician_ratings              IS 'Individual ratings given to technicians, typically after a job is closed';
COMMENT ON COLUMN technician_ratings.rating       IS 'Rating value 1.0–5.0 (half-star increments)';
COMMENT ON COLUMN technician_ratings.job_id       IS 'Optional — links rating to a specific completed job';
COMMENT ON COLUMN technician_ratings.review       IS 'Optional text feedback';

-- Prevent duplicate ratings per job
CREATE UNIQUE INDEX IF NOT EXISTS idx_tech_ratings_job_unique
  ON technician_ratings (technician_id, job_id)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tech_ratings_technician_id
  ON technician_ratings (technician_id);
