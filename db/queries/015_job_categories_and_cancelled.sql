-- ============================================================
-- FILE: db/queries/015_job_categories_and_cancelled.sql
-- Adds new job categories and Cancelled status to ENUMs.
-- Run ONCE on your database.
-- ============================================================

-- ── New visit categories ──────────────────────────────────────
ALTER TYPE job_category ADD VALUE IF NOT EXISTS 'Office Visit';
ALTER TYPE job_category ADD VALUE IF NOT EXISTS 'Vendor Visit';
ALTER TYPE job_category ADD VALUE IF NOT EXISTS 'Trial Pump Installation';

-- ── Cancelled job status ──────────────────────────────────────
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'Cancelled';

-- ── Track who cancelled and why ───────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancel_reason  TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancelled_by   INTEGER REFERENCES users(id) ON DELETE SET NULL;

SELECT '015_job_categories_and_cancelled applied successfully.' AS result;
