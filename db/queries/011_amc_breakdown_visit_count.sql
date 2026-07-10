-- ============================================================
-- FILE: db/queries/011_amc_breakdown_visit_count.sql
-- Migration: Add breakdown_visit_count to amc_contracts
-- Tracks the number of emergency/breakdown-type visits covered
-- by the AMC, separate from the regular visit_count.
-- Run ONCE on your existing database
-- ============================================================

ALTER TABLE amc_contracts
  ADD COLUMN IF NOT EXISTS breakdown_visit_count INTEGER;

COMMENT ON COLUMN amc_contracts.breakdown_visit_count IS 'Number of emergency/breakdown-type service visits covered by the AMC';

-- ─── Done ───────────────────────────────────────────────────

SELECT '011_amc_breakdown_visit_count applied successfully.' AS result;
