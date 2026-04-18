-- ============================================================
-- FILE: db/schema/01_users.sql
-- Module: Users & Authentication
-- Run this FIRST — all other modules depend on this table
-- ============================================================

-- ─── EXTENSION ───────────────────────────────────────────────
-- Must be created before ANY GIN trgm indexes in any file
-- Running it here once covers all subsequent schema files

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── ENUM: user_role ─────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'admin',
    'manager',
    'engineer',
    'technician',
    'labour'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── TABLE: users ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL        PRIMARY KEY,
  first_name    VARCHAR(100)  NOT NULL,
  last_name     VARCHAR(100)  NOT NULL,
  email         VARCHAR(255)  UNIQUE,
  phone_number  VARCHAR(20)   UNIQUE,
  password      VARCHAR(255)  NOT NULL,
  role          user_role     NOT NULL DEFAULT 'technician',
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_or_phone CHECK (
    email IS NOT NULL OR phone_number IS NOT NULL
  )
);

COMMENT ON TABLE  users               IS 'All system users — admins, office staff, and technicians';
COMMENT ON COLUMN users.phone_number  IS 'E.164 format — e.g. +919876543210';
COMMENT ON COLUMN users.password      IS 'bcrypt hash, cost factor 12';
COMMENT ON COLUMN users.is_active     IS 'FALSE = soft-deleted. Preserved for audit trail.';
COMMENT ON COLUMN users.last_login_at IS 'Updated on every successful login';

-- ─── TABLE: password_reset_tokens ────────────────────────────

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          SERIAL        PRIMARY KEY,
  user_id     INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(255)  NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ   NOT NULL,
  used        BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  password_reset_tokens        IS 'Single-use password reset tokens, expire after 15 minutes';
COMMENT ON COLUMN password_reset_tokens.token  IS 'Cryptographically random 32-byte hex token';
COMMENT ON COLUMN password_reset_tokens.used   IS 'TRUE once consumed — cannot be reused';

-- ─── TRIGGER FUNCTION ────────────────────────────────────────
-- Defined once here — shared by ALL subsequent schema files

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── TRIGGER: users ──────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ─── INDEXES: users ──────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_email
  ON users (email) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_phone
  ON users (phone_number) WHERE phone_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_role      ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users (is_active);

-- ─── INDEXES: password_reset_tokens ──────────────────────────

CREATE INDEX IF NOT EXISTS idx_prt_user_id    ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_prt_expires_at ON password_reset_tokens (expires_at);
