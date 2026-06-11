-- ============================================================
-- FILE: db/queries/005_doc_links_and_amc_pricing.sql
-- Migration:
--   1. Add report document links (upload_document_link[]) support
--   2. Add pricing fields to amc_contracts
-- Run ONCE on your existing database (after 004_amc_report_pdf_fields.sql)
-- ============================================================

-- ─── 1. TABLE: report_document_links ─────────────────────────
--     Stores the `upload_document_link[]` entries for a report.
--     Mirrors report_images / technical_reports.

CREATE TABLE IF NOT EXISTS report_document_links (
  id                  SERIAL        PRIMARY KEY,
  report_id           VARCHAR(20)   NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  file_name           VARCHAR(255),
  file_url            TEXT          NOT NULL,
  mime_type           VARCHAR(100),
  file_size_bytes     INTEGER,
  uploaded_by_user_id INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  report_document_links           IS 'Document links (upload_document_link[]) attached to a service report';
COMMENT ON COLUMN report_document_links.file_url  IS 'Public URL / link to the uploaded document';
COMMENT ON COLUMN report_document_links.file_name IS 'Display name of the document (optional)';

CREATE INDEX IF NOT EXISTS idx_report_document_links_report_id
  ON report_document_links (report_id);


-- ─── 2. amc_contracts pricing fields ─────────────────────────
--     visit_count, pumps_count, per_pump_price, total_price, gst_percent

ALTER TABLE amc_contracts
  ADD COLUMN IF NOT EXISTS visit_count    INTEGER,
  ADD COLUMN IF NOT EXISTS pumps_count    INTEGER,
  ADD COLUMN IF NOT EXISTS per_pump_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS total_price    NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS gst_percent    NUMERIC(5,2);

COMMENT ON COLUMN amc_contracts.visit_count    IS 'Number of service visits covered by the AMC';
COMMENT ON COLUMN amc_contracts.pumps_count    IS 'Number of pumps covered by the AMC';
COMMENT ON COLUMN amc_contracts.per_pump_price IS 'Price charged per pump (INR)';
COMMENT ON COLUMN amc_contracts.total_price    IS 'Total price before GST (INR)';
COMMENT ON COLUMN amc_contracts.gst_percent    IS 'GST percentage applied to the contract';


-- ─── 3. Done ─────────────────────────────────────────────────
SELECT '005_doc_links_and_amc_pricing applied successfully.' AS result;
