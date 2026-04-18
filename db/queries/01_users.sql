-- ============================================================
-- FILE: db/schema/01_users.sql
-- Module: Users & Authentication
-- Run this first — all other modules depend on this table
-- ============================================================


-- ─── EXTENSION ───────────────────────────────────────────────

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
-- Stores all system users — admins, office staff, and
-- technicians who log in via the app.
-- Login accepts either email OR phone_number as identifier.

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  first_name      VARCHAR(100)  NOT NULL,
  last_name       VARCHAR(100)  NOT NULL,
  email           VARCHAR(255)  UNIQUE,
  phone_number    VARCHAR(20)   UNIQUE,           -- E.164 format e.g. +919876543210
  password        VARCHAR(255)  NOT NULL,          -- bcrypt hash, cost factor 12
  role            user_role     NOT NULL DEFAULT 'technician',
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- At least one of email or phone_number must be present
  CONSTRAINT users_email_or_phone CHECK (
    email IS NOT NULL OR phone_number IS NOT NULL
  )
);

COMMENT ON TABLE  users                IS 'All system users — admins, office staff, and technicians';
COMMENT ON COLUMN users.phone_number   IS 'E.164 format — always stored with country code, e.g. +919876543210';
COMMENT ON COLUMN users.password       IS 'bcrypt hash, cost factor 12 — never stored in plain text';
COMMENT ON COLUMN users.is_active      IS 'FALSE = soft-deleted. Preserved for audit trail.';
COMMENT ON COLUMN users.last_login_at  IS 'Updated on every successful login';


-- ─── TABLE: password_reset_tokens ────────────────────────────
-- Short-lived tokens for the forgot-password flow.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(255) NOT NULL UNIQUE,     -- raw token (hashed in newer versions)
  expires_at  TIMESTAMPTZ  NOT NULL,            -- NOW() + INTERVAL '15 minutes'
  used        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  password_reset_tokens           IS 'Single-use password reset tokens, expire after 15 minutes';
COMMENT ON COLUMN password_reset_tokens.token     IS 'Cryptographically random 32-byte hex token';
COMMENT ON COLUMN password_reset_tokens.used      IS 'TRUE once the token has been consumed — cannot be reused';


-- ─── TRIGGER FUNCTION: updated_at ────────────────────────────

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
  ON users (email)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_phone
  ON users (phone_number)
  WHERE phone_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_role       ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_is_active  ON users (is_active);


-- ─── INDEXES: password_reset_tokens ──────────────────────────

CREATE INDEX IF NOT EXISTS idx_prt_user_id    ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_prt_expires_at ON password_reset_tokens (expires_at);
