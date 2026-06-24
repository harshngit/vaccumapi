-- ============================================================
-- FILE: db/schema/12_technician_documents.sql
-- Module: Technician Documents
-- Depends on: 02_technicians.sql, 01_users.sql
-- Run AFTER 02_technicians.sql
-- ============================================================

-- ─── ENUM: technician_document_type ─────────────────────────

DO $$ BEGIN
  CREATE TYPE technician_document_type AS ENUM (
    'Aadhaar Card',
    'Technician Photo',
    'WC Policy',
    'Medical Insurance Policy',
    'Other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── TABLE: technician_documents ────────────────────────────

CREATE TABLE IF NOT EXISTS technician_documents (
  id                SERIAL                    PRIMARY KEY,
  technician_id     INTEGER                   NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  document_type     technician_document_type  NOT NULL,
  document_name     VARCHAR(255)              NOT NULL,
  file_name         VARCHAR(255)              NOT NULL,
  file_url          TEXT                      NOT NULL,
  mime_type         VARCHAR(100)              NOT NULL DEFAULT 'application/pdf',
  file_size_bytes   INTEGER,
  expiry_date       DATE,
  notes             TEXT,
  uploaded_by       INTEGER                   REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ               NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  technician_documents                IS 'Documents uploaded for technician profiles (Aadhaar, WC Policy, etc.)';
COMMENT ON COLUMN technician_documents.document_type  IS 'Category of the document';
COMMENT ON COLUMN technician_documents.document_name  IS 'User-facing label e.g. "Ravi Aadhaar Front"';
COMMENT ON COLUMN technician_documents.file_name      IS 'Original filename as uploaded';
COMMENT ON COLUMN technician_documents.file_url       IS 'Full public URL to access the file';
COMMENT ON COLUMN technician_documents.expiry_date    IS 'Optional expiry date for policies/IDs';
COMMENT ON COLUMN technician_documents.notes          IS 'Optional notes about the document';

-- ─── TRIGGER: technician_documents ──────────────────────────

DROP TRIGGER IF EXISTS trg_technician_documents_updated_at ON technician_documents;
CREATE TRIGGER trg_technician_documents_updated_at
  BEFORE UPDATE ON technician_documents
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ─── INDEXES: technician_documents ──────────────────────────

CREATE INDEX IF NOT EXISTS idx_tech_docs_technician_id
  ON technician_documents (technician_id);

CREATE INDEX IF NOT EXISTS idx_tech_docs_document_type
  ON technician_documents (document_type);

CREATE INDEX IF NOT EXISTS idx_tech_docs_expiry_date
  ON technician_documents (expiry_date)
  WHERE expiry_date IS NOT NULL;
