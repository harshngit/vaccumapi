-- ============================================================
-- FILE: db/migrations/001_add_missing_columns.sql
-- Run this ONCE on your existing database.
-- Safe to re-run — all blocks check before altering.
-- ============================================================

-- ─── STEP 1: Enable pg_trgm extension ────────────────────────
-- This is the fix for: operator class "gin_trgm_ops" does not exist
-- Must be enabled BEFORE creating any GIN trgm indexes.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── STEP 2: Add last_login_at to users ──────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'last_login_at'
  ) THEN
    ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;
    RAISE NOTICE 'Added column: users.last_login_at';
  ELSE
    RAISE NOTICE 'Column already exists, skipping: users.last_login_at';
  END IF;
END $$;

-- ─── STEP 3: Add technician to user_role enum ────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'user_role'::regtype
      AND enumlabel = 'technician'
  ) THEN
    ALTER TYPE user_role ADD VALUE 'technician';
    RAISE NOTICE 'Added enum value: user_role.technician';
  ELSE
    RAISE NOTICE 'Enum value already exists, skipping: user_role.technician';
  END IF;
END $$;

-- ─── STEP 4: Create set_updated_at() function if missing ─────
-- Some existing databases may not have this from init.sql

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── STEP 5: Verify ──────────────────────────────────────────

SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;
