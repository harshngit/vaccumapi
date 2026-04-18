-- ============================================================
-- FILE: db/schema/07_email_settings.sql
-- Module: Email Settings & Notification Triggers
-- Depends on: 01_users.sql
-- Run AFTER 01
-- ============================================================


-- ─── TABLE: email_settings ───────────────────────────────────
-- SMTP configuration for the system email service.
-- Only ONE active row is ever allowed (singleton table).

CREATE TABLE IF NOT EXISTS email_settings (
  id                  SERIAL        PRIMARY KEY,
  smtp_host           VARCHAR(255)  NOT NULL DEFAULT 'smtp.gmail.com',
  smtp_port           INTEGER       NOT NULL DEFAULT 587,
  from_email          VARCHAR(255)  NOT NULL,
  from_name           VARCHAR(150)  NOT NULL DEFAULT 'VDTI Service Hub',
  smtp_password_enc   TEXT,
  -- ^ SMTP password stored encrypted at rest (AES-256 via application layer).
  --   NEVER returned in any API response.
  is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
  updated_by_user_id  INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Enforce singleton: only one active email_settings row allowed
CREATE UNIQUE INDEX IF NOT EXISTS email_settings_single_active
  ON email_settings (is_active)
  WHERE is_active = TRUE;

COMMENT ON TABLE  email_settings                  IS 'SMTP configuration — singleton table, only one active row allowed';
COMMENT ON COLUMN email_settings.smtp_password_enc IS 'AES-256 encrypted SMTP password — NEVER returned in API responses';


-- ─── TABLE: notification_triggers ────────────────────────────
-- Stores which email notification events are enabled.
-- References the one active email_settings row.

CREATE TABLE IF NOT EXISTS notification_triggers (
  id                  SERIAL        PRIMARY KEY,
  email_settings_id   INTEGER       NOT NULL REFERENCES email_settings(id) ON DELETE CASCADE,
  trigger_key         VARCHAR(100)  NOT NULL,
  -- Allowed values:
  --   job_raised       — new job created
  --   job_assigned     — technician assigned to job
  --   job_completed    — job status changed to Closed
  --   report_approved  — report approved by admin
  --   amc_renewal      — AMC nearing renewal_reminder_days before end_date
  --   quotation_sent   — (future use)
  is_enabled          BOOLEAN       NOT NULL DEFAULT TRUE,
  label               VARCHAR(200),
  -- ^ Human-readable label for UI e.g. 'New Job Raised'
  UNIQUE (email_settings_id, trigger_key)
);

COMMENT ON TABLE  notification_triggers            IS 'Individual email notification event toggles tied to email_settings';
COMMENT ON COLUMN notification_triggers.trigger_key IS 'Event identifier: job_raised | job_assigned | job_completed | report_approved | amc_renewal | quotation_sent';
