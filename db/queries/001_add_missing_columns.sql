-- ============================================================
-- FILE: db/migrations/001_add_missing_columns.sql
-- Run this ONCE on your existing database to add columns
-- that are missing from the original init.sql schema.
-- Safe to run — uses IF NOT EXISTS / DO blocks to skip
-- if columns already exist.
-- ============================================================


-- ─── users: add last_login_at ────────────────────────────────

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


-- ─── users: add technician to user_role enum ─────────────────
-- Your original enum was: admin, engineer, labour, manager
-- The new code also uses 'technician' as a role value.

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


-- ─── Verify ──────────────────────────────────────────────────

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;
