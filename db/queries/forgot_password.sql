-- ============================================================
-- FILE: db/queries/forgot_password.sql
-- SQL queries for Forgot Password flow
-- ============================================================


-- ─── SCHEMA: password_reset_tokens table ─────────────────────
-- Run this migration once to add the reset tokens table

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(255) UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prt_token   ON password_reset_tokens (token);
CREATE INDEX IF NOT EXISTS idx_prt_user_id ON password_reset_tokens (user_id);


-- ─── FORGOT PASSWORD ─────────────────────────────────────────

-- Find active user by email (to initiate reset)
-- Params: $1=email
SELECT id, email, first_name FROM users WHERE email = $1 AND is_active = TRUE;

-- Invalidate all existing tokens for a user before creating a new one
-- Params: $1=user_id
UPDATE password_reset_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE;

-- Insert a new password reset token
-- Params: $1=user_id, $2=token, $3=expires_at
INSERT INTO password_reset_tokens (user_id, token, expires_at)
VALUES ($1, $2, $3)
RETURNING id, token, expires_at;


-- ─── RESET PASSWORD ──────────────────────────────────────────

-- Validate reset token (must exist, unused, and not expired)
-- Params: $1=token
SELECT prt.id, prt.user_id, prt.expires_at, prt.used,
       u.email, u.first_name
FROM password_reset_tokens prt
JOIN users u ON u.id = prt.user_id
WHERE prt.token = $1 AND prt.used = FALSE AND prt.expires_at > NOW();

-- Update user password after successful reset
-- Params: $1=new_hashed_password, $2=user_id
UPDATE users SET password = $1 WHERE id = $2;

-- Mark token as used after successful reset
-- Params: $1=token
UPDATE password_reset_tokens SET used = TRUE WHERE token = $1;
