-- ============================================================
-- FILE: db/queries/007_update_job_category_enum.sql
-- Module: Update job_category enum to new values
-- ============================================================

-- First, we need to drop the default on the column because we can't alter enum while it's in use as a default
ALTER TABLE jobs ALTER COLUMN category DROP DEFAULT;

-- Now, we need to rename the old enum type, create a new one, update the column, then drop the old one
-- Because you can't remove values from an existing enum type in PostgreSQL

-- Rename the old enum
ALTER TYPE job_category RENAME TO job_category_old;

-- Create the new enum type
CREATE TYPE job_category AS ENUM (
  'Service',
  'AMC Visit',
  'Breakdown',
  'Installation & Commissioning',
  'Inspection'
);

-- Update the column to use the new type
ALTER TABLE jobs 
  ALTER COLUMN category TYPE job_category 
  USING category::text::job_category;

-- Add the new default
ALTER TABLE jobs ALTER COLUMN category SET DEFAULT 'Service';

-- Drop the old enum type
DROP TYPE job_category_old;
