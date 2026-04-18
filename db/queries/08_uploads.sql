-- ============================================================
-- FILE: db/schema/08_uploads.sql
-- Module: File Uploads (local storage on Railway)
-- Depends on: 01_users.sql
-- Run AFTER 01_users.sql
-- ============================================================

-- ─── TABLE: uploads ──────────────────────────────────────────
-- Tracks all files uploaded to the server's local /uploads dir.
-- Public URL format: {BASE_URL}/uploads/{stored_filename}
-- e.g. https://vaccumapi-production.up.railway.app/uploads/1714012345678_site_before.jpg

CREATE TABLE IF NOT EXISTS uploads (
  id                  SERIAL        PRIMARY KEY,
  original_name       VARCHAR(255)  NOT NULL,
  stored_name         VARCHAR(255)  NOT NULL,
  file_url            TEXT          NOT NULL,
  mime_type           VARCHAR(100)  NOT NULL DEFAULT 'image/jpeg',
  file_size_bytes     INTEGER,
  entity_type         VARCHAR(50),   -- 'job' | 'report'
  entity_id           VARCHAR(50),   -- JOB-0001, RPT-0001 etc.
  uploaded_by_user_id INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  uploads               IS 'Locally uploaded files. URL = BASE_URL/uploads/stored_name';
COMMENT ON COLUMN uploads.stored_name   IS 'Filename on disk: {timestamp}_{originalname}';
COMMENT ON COLUMN uploads.file_url      IS 'Full public URL the client uses to access the file';
COMMENT ON COLUMN uploads.entity_type   IS 'Which module owns this upload: job | report';
COMMENT ON COLUMN uploads.entity_id     IS 'ID of the owning entity e.g. JOB-0001, RPT-0001';

-- ─── INDEXES: uploads ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_uploads_entity
  ON uploads (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_uploads_uploaded_by
  ON uploads (uploaded_by_user_id);
