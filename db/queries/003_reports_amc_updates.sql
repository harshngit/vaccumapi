-- ============================================================
-- FILE: db/queries/003_reports_amc_updates.sql
-- Migration: Add new fields to reports & amc_contracts tables
-- Run this ONCE on your existing database
-- ============================================================

-- ─── 1. Add new columns to reports table ─────────────────────

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS po_number       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS location        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS serial_no       VARCHAR(150),
  ADD COLUMN IF NOT EXISTS client_id       INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_name     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS client_email    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS comments        TEXT;

COMMENT ON COLUMN reports.po_number    IS 'PO Number — must match an AMC contract po_number';
COMMENT ON COLUMN reports.location     IS 'Site / installation location';
COMMENT ON COLUMN reports.serial_no    IS 'Equipment serial number';
COMMENT ON COLUMN reports.client_id    IS 'Direct client reference (in addition to job→client)';
COMMENT ON COLUMN reports.client_name  IS 'Client name snapshot at time of report';
COMMENT ON COLUMN reports.client_email IS 'Client email — report email is sent here on submit';
COMMENT ON COLUMN reports.comments     IS 'Additional comments / notes from technician';

-- ─── 2. Create technical_reports table ───────────────────────

CREATE TABLE IF NOT EXISTS technical_reports (
  id           SERIAL        PRIMARY KEY,
  report_id    VARCHAR(20)   NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  file_name    VARCHAR(255)  NOT NULL,
  file_url     TEXT          NOT NULL,
  file_size_bytes INTEGER,
  mime_type    VARCHAR(100)  DEFAULT 'application/pdf',
  uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE technical_reports IS 'Technical report documents (PDF/images) attached to a service report';

CREATE INDEX IF NOT EXISTS idx_technical_reports_report_id ON technical_reports (report_id);

-- ─── 3. Add po_number column to amc_contracts table ──────────

ALTER TABLE amc_contracts
  ADD COLUMN IF NOT EXISTS po_number VARCHAR(100);

COMMENT ON COLUMN amc_contracts.po_number IS 'Purchase Order number for this AMC contract';

CREATE INDEX IF NOT EXISTS idx_amc_po_number ON amc_contracts (po_number);

-- ─── 4. Add client email to clients table if missing ─────────
-- (clients table should already have email; this is a safety check)
-- ALTER TABLE clients ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Done.
SELECT 'Migration 003 applied successfully.' AS result;
