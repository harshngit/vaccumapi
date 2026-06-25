-- ============================================================
-- FILE: db/queries/008_amc_last_service_date.sql
-- Migration: Add last_service_date to amc_contracts
-- Also adds technician_documents + technician_ratings tables
-- Run ONCE on your existing database
-- ============================================================

-- ─── 1. amc_contracts: add last_service_date ────────────────

ALTER TABLE amc_contracts
  ADD COLUMN IF NOT EXISTS last_service_date DATE;

COMMENT ON COLUMN amc_contracts.last_service_date IS 'Date of the most recent completed service visit';

-- ─── 2. technician_documents table ──────────────────────────

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

DROP TRIGGER IF EXISTS trg_technician_documents_updated_at ON technician_documents;
CREATE TRIGGER trg_technician_documents_updated_at
  BEFORE UPDATE ON technician_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_tech_docs_technician_id ON technician_documents (technician_id);
CREATE INDEX IF NOT EXISTS idx_tech_docs_document_type ON technician_documents (document_type);
CREATE INDEX IF NOT EXISTS idx_tech_docs_expiry_date   ON technician_documents (expiry_date) WHERE expiry_date IS NOT NULL;

-- ─── 3. technician_ratings table ────────────────────────────

CREATE TABLE IF NOT EXISTS technician_ratings (
  id              SERIAL        PRIMARY KEY,
  technician_id   INTEGER       NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  job_id          VARCHAR(20)   REFERENCES jobs(id) ON DELETE SET NULL,
  rating          NUMERIC(2,1)  NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review          TEXT,
  rated_by        INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tech_ratings_job_unique
  ON technician_ratings (technician_id, job_id) WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tech_ratings_technician_id
  ON technician_ratings (technician_id);

-- ─── Done ───────────────────────────────────────────────────

SELECT '008_amc_last_service_date + technician_documents + technician_ratings applied successfully.' AS result;
