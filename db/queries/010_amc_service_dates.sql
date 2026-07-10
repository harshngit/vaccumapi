-- ============================================================
-- FILE: db/queries/010_amc_service_dates.sql
-- Migration: Add 6 individual service date fields to amc_contracts
-- (service_date_1 .. service_date_6) — one per scheduled visit,
-- used when visit_count indicates how many of these are required.
-- Run ONCE on your existing database
-- ============================================================

ALTER TABLE amc_contracts
  ADD COLUMN IF NOT EXISTS service_date_1 DATE,
  ADD COLUMN IF NOT EXISTS service_date_2 DATE,
  ADD COLUMN IF NOT EXISTS service_date_3 DATE,
  ADD COLUMN IF NOT EXISTS service_date_4 DATE,
  ADD COLUMN IF NOT EXISTS service_date_5 DATE,
  ADD COLUMN IF NOT EXISTS service_date_6 DATE;

COMMENT ON COLUMN amc_contracts.service_date_1 IS 'Scheduled date for service visit 1 (required when visit_count >= 1)';
COMMENT ON COLUMN amc_contracts.service_date_2 IS 'Scheduled date for service visit 2 (required when visit_count >= 2)';
COMMENT ON COLUMN amc_contracts.service_date_3 IS 'Scheduled date for service visit 3 (required when visit_count >= 3)';
COMMENT ON COLUMN amc_contracts.service_date_4 IS 'Scheduled date for service visit 4 (required when visit_count >= 4)';
COMMENT ON COLUMN amc_contracts.service_date_5 IS 'Scheduled date for service visit 5 (required when visit_count >= 5)';
COMMENT ON COLUMN amc_contracts.service_date_6 IS 'Scheduled date for service visit 6 (required when visit_count >= 6)';

-- ─── Done ───────────────────────────────────────────────────

SELECT '010_amc_service_dates applied successfully.' AS result;
