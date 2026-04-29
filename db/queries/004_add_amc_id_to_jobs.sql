-- ============================================================
-- FILE: db/queries/004_add_amc_id_to_jobs.sql
-- Migration: Add amc_id foreign key to jobs table
-- Run ONCE on your existing database
-- ============================================================

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS amc_id VARCHAR(20) REFERENCES amc_contracts(id) ON DELETE SET NULL;

COMMENT ON COLUMN jobs.amc_id IS 'Optional link to an AMC contract this job was raised under';

CREATE INDEX IF NOT EXISTS idx_jobs_amc_id ON jobs (amc_id) WHERE amc_id IS NOT NULL;

SELECT 'Migration 004 applied successfully.' AS result;
