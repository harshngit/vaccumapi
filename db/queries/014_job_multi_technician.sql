-- ============================================================
-- FILE: db/queries/014_job_multi_technician.sql
-- Adds start_date / end_date to jobs table and creates
-- job_technicians junction table for multi-technician support.
-- Run ONCE on your database.
-- ============================================================

-- ── Add date range columns to jobs ───────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS end_date   DATE;

-- ── Junction table: many technicians per job ─────────────────
CREATE TABLE IF NOT EXISTS job_technicians (
  id            SERIAL      PRIMARY KEY,
  job_id        VARCHAR(20) NOT NULL REFERENCES jobs(id)        ON DELETE CASCADE,
  technician_id INTEGER     NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, technician_id)
);

CREATE INDEX IF NOT EXISTS idx_job_technicians_job_id
  ON job_technicians (job_id);

CREATE INDEX IF NOT EXISTS idx_job_technicians_technician_id
  ON job_technicians (technician_id);

-- Backfill: seed job_technicians from existing technician_id assignments
INSERT INTO job_technicians (job_id, technician_id)
SELECT id, technician_id
FROM   jobs
WHERE  technician_id IS NOT NULL
ON CONFLICT DO NOTHING;

SELECT '014_job_multi_technician applied successfully.' AS result;
