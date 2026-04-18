-- ============================================================
-- FILE: db/schema/07_email_settings.sql
-- Module: Email Settings & Notification Triggers
-- Depends on: 01_users.sql
-- Run AFTER 01_users.sql
-- ============================================================

-- NOTE: set_updated_at() function already created in 01_users.sql.

-- ─── TABLE: email_settings ───────────────────────────────────
-- Singleton table — only ONE active row is ever allowed.

CREATE TABLE IF NOT EXISTS email_settings (
  id                  SERIAL        PRIMARY KEY,
  smtp_host           VARCHAR(255)  NOT NULL DEFAULT 'smtp.gmail.com',
  smtp_port           INTEGER       NOT NULL DEFAULT 587,
  from_email          VARCHAR(255)  NOT NULL,
  from_name           VARCHAR(150)  NOT NULL DEFAULT 'VDTI Service Hub',
  smtp_password_enc   TEXT,
  -- ^ SMTP password — NEVER returned in any API response
  is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
  updated_by_user_id  INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Enforce singleton: only one active row allowed
CREATE UNIQUE INDEX IF NOT EXISTS email_settings_single_active
  ON email_settings (is_active)
  WHERE is_active = TRUE;

COMMENT ON TABLE  email_settings                   IS 'SMTP config — singleton, only one active row';
COMMENT ON COLUMN email_settings.smtp_password_enc IS 'SMTP password — never returned in API responses';

-- ─── TRIGGER: email_settings ─────────────────────────────────

DROP TRIGGER IF EXISTS trg_email_settings_updated_at ON email_settings;
CREATE TRIGGER trg_email_settings_updated_at
  BEFORE UPDATE ON email_settings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ─── TABLE: notification_triggers ────────────────────────────

CREATE TABLE IF NOT EXISTS notification_triggers (
  id                  SERIAL        PRIMARY KEY,
  email_settings_id   INTEGER       NOT NULL REFERENCES email_settings(id) ON DELETE CASCADE,
  trigger_key         VARCHAR(100)  NOT NULL,
  -- Values: job_raised | job_assigned | job_completed |
  --         report_approved | amc_renewal | quotation_sent
  is_enabled          BOOLEAN       NOT NULL DEFAULT TRUE,
  label               VARCHAR(200),
  UNIQUE (email_settings_id, trigger_key)
);

COMMENT ON TABLE  notification_triggers             IS 'Email notification event toggles';
COMMENT ON COLUMN notification_triggers.trigger_key IS 'job_raised | job_assigned | job_completed | report_approved | amc_renewal | quotation_sent';
