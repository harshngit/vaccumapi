-- ============================================================
-- FILE: db/queries/012_erp_quotations_series.sql
-- Migration: Add series (ERP SeriesName) to erp_quotations
-- Run ONCE on your existing database
-- ============================================================

ALTER TABLE erp_quotations
  ADD COLUMN IF NOT EXISTS series VARCHAR(100);

COMMENT ON COLUMN erp_quotations.series IS 'ERP SeriesName — e.g. Spares, Accessories, AMC Quotation, Service';

CREATE INDEX IF NOT EXISTS idx_erp_quotations_series
  ON erp_quotations (series);

-- ─── Done ───────────────────────────────────────────────────

SELECT '012_erp_quotations_series applied successfully.' AS result;
