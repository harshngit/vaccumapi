-- ============================================================
-- FILE: db/schema/05_reports.sql
-- Module: Service Reports
-- Depends on: 01_users.sql, 02_technicians.sql, 04_jobs.sql
-- Run AFTER 01, 02, 03, 04
-- ============================================================


-- ─── ENUM: report_status ─────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE report_status AS ENUM (
    'Pending',
    'Approved',
    'Rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- ─── TABLE: reports ──────────────────────────────────────────
-- Service / inspection reports submitted by technicians
-- after completing or progressing a job.
-- id format: RPT-NNNN (e.g. RPT-0001)

CREATE TABLE IF NOT EXISTS reports (
  id                    VARCHAR(20)    PRIMARY KEY,
  job_id                VARCHAR(20)    NOT NULL REFERENCES jobs(id)        ON DELETE RESTRICT,
  title                 VARCHAR(255)   NOT NULL,
  findings              TEXT,                        -- What the technician found — free text
  recommendations       TEXT,                        -- Suggested follow-up actions
  status                report_status  NOT NULL DEFAULT 'Pending',
  technician_id         INTEGER        NOT NULL REFERENCES technicians(id) ON DELETE RESTRICT,
  approved_by_user_id   INTEGER        REFERENCES users(id)                ON DELETE SET NULL,
  -- ^ The admin user who approved or rejected this report
  approved_at           TIMESTAMPTZ,
  -- ^ Set when status transitions to Approved or Rejected
  report_date           DATE           NOT NULL DEFAULT CURRENT_DATE,
  created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  -- approved_by must be set when status is not Pending
  CONSTRAINT reports_approval_requires_approver CHECK (
    status = 'Pending' OR approved_by_user_id IS NOT NULL
  )
);

COMMENT ON TABLE  reports                     IS 'Field service and inspection reports submitted by technicians';
COMMENT ON COLUMN reports.findings            IS 'What the technician found during inspection — free text';
COMMENT ON COLUMN reports.recommendations     IS 'Suggested follow-up actions or next service notes';
COMMENT ON COLUMN reports.approved_by_user_id IS 'Admin who approved or rejected the report; NULL while Pending';
COMMENT ON COLUMN reports.approved_at         IS 'Timestamp when admin reviewed the report';


-- ─── TABLE: report_images ────────────────────────────────────
-- Before/after photos and evidence images attached to a report.

CREATE TABLE IF NOT EXISTS report_images (
  id                    SERIAL       PRIMARY KEY,
  report_id             VARCHAR(20)  NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  file_name             VARCHAR(255) NOT NULL,
  file_url              TEXT         NOT NULL,
  file_size_bytes       INTEGER,
  mime_type             VARCHAR(100) DEFAULT 'image/jpeg',
  uploaded_by_user_id   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE report_images IS 'Images attached to a service report — stored externally, URL recorded here';


-- ─── TRIGGER: reports updated_at ─────────────────────────────

DROP TRIGGER IF EXISTS trg_reports_updated_at ON reports;
CREATE TRIGGER trg_reports_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- ─── INDEXES: reports ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_reports_job_id        ON reports (job_id);
CREATE INDEX IF NOT EXISTS idx_reports_technician_id ON reports (technician_id);
CREATE INDEX IF NOT EXISTS idx_reports_status        ON reports (status);
CREATE INDEX IF NOT EXISTS idx_reports_report_date   ON reports (report_date DESC);


-- ─── INDEXES: report_images ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_report_images_report_id ON report_images (report_id);
