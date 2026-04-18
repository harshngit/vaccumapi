-- ============================================================
-- FILE: db/schema/10_activity_log.sql
-- Stores every meaningful action performed by any user.
-- Queried by GET /api/activity with type + pagination filters.
-- Depends on: 01_users.sql
-- Run AFTER 01_users.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_log (
  id             SERIAL        PRIMARY KEY,
  type           VARCHAR(50)   NOT NULL,
  -- Allowed: job | report | client | technician | amc | user | auth | email_settings
  action         TEXT          NOT NULL,
  -- Human-readable e.g. "Job JOB-0001 raised by Arjun"
  entity_type    VARCHAR(50),   -- same as type usually
  entity_id      VARCHAR(50),   -- JOB-0001, RPT-0001, etc.
  performed_by   INTEGER        REFERENCES users(id) ON DELETE SET NULL,
  -- NULL if action is system-triggered (e.g. cron job)
  performed_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  activity_log              IS 'Audit log — every meaningful user action across all modules';
COMMENT ON COLUMN activity_log.type        IS 'Module: job | report | client | technician | amc | user | auth | email_settings';
COMMENT ON COLUMN activity_log.entity_id   IS 'ID of the affected entity e.g. JOB-0001, RPT-0001';
COMMENT ON COLUMN activity_log.performed_by IS 'User who performed the action; NULL = system';

CREATE INDEX IF NOT EXISTS idx_activity_type         ON activity_log (type);
CREATE INDEX IF NOT EXISTS idx_activity_entity        ON activity_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_performed_by  ON activity_log (performed_by);
CREATE INDEX IF NOT EXISTS idx_activity_performed_at  ON activity_log (performed_at DESC);
