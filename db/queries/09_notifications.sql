-- ============================================================
-- FILE: db/schema/09_notifications.sql
-- Persists every notification so users can see history even
-- after page refresh. The frontend reads this via GET /api/notifications.
-- Depends on: 01_users.sql
-- Run AFTER 01_users.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id           SERIAL        PRIMARY KEY,
  user_id      INTEGER       REFERENCES users(id) ON DELETE CASCADE,
  -- NULL = broadcast (meant for all users — each user fetches their own copy)
  role         VARCHAR(50),
  -- If user_id is NULL, role targets e.g. 'admin', 'manager'. NULL = everyone.
  event        VARCHAR(100)  NOT NULL,
  -- e.g. job_raised | job_status | report_submitted | report_reviewed | amc_expiring
  title        VARCHAR(255)  NOT NULL,
  message      TEXT          NOT NULL,
  entity_type  VARCHAR(50),    -- 'job' | 'report' | 'amc'
  entity_id    VARCHAR(50),    -- JOB-0001, RPT-0001, AMC-0001
  is_read      BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  notifications IS 'Persisted notification log — every WS push is also saved here';
COMMENT ON COLUMN notifications.user_id  IS 'NULL = targeted by role or broadcast';
COMMENT ON COLUMN notifications.role     IS 'If user_id is NULL, which role this is for. NULL = all roles.';
COMMENT ON COLUMN notifications.entity_id IS 'ID of the related entity e.g. JOB-0001';

CREATE INDEX IF NOT EXISTS idx_notif_user_id    ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notif_role        ON notifications (role);
CREATE INDEX IF NOT EXISTS idx_notif_is_read     ON notifications (is_read);
CREATE INDEX IF NOT EXISTS idx_notif_created_at  ON notifications (created_at DESC);
