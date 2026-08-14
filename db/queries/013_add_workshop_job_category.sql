-- ============================================================
-- FILE: db/queries/013_add_workshop_job_category.sql
-- Adds 'Workshop' to the job_category ENUM.
-- Run ONCE on your database.
-- ============================================================

ALTER TYPE job_category ADD VALUE IF NOT EXISTS 'Workshop';
ALTER TYPE job_category ADD VALUE IF NOT EXISTS 'Office';
ALTER TYPE job_category ADD VALUE IF NOT EXISTS 'Trial';

SELECT '013_add_workshop_job_category applied successfully.' AS result;
