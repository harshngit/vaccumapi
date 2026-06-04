-- ============================================================
-- FILE: db/queries/11_attendance.sql
-- Module: Attendance (RazorpayX Payroll Sync)
-- Depends on: 01_users.sql, 02_technicians.sql
-- Run AFTER 02_technicians.sql
-- ============================================================

-- ─── TABLE: attendance ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS attendance (
  id                SERIAL        PRIMARY KEY,
  employee_id       VARCHAR(50)   NOT NULL,          -- RazorpayX employee_id
  user_id           INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  technician_id     INTEGER       REFERENCES technicians(id) ON DELETE SET NULL,
  name              VARCHAR(150),                    -- from RazorpayX
  date              DATE          NOT NULL,
  check_in          TIMESTAMPTZ,
  check_out         TIMESTAMPTZ,
  status            VARCHAR(30)   NOT NULL DEFAULT 'present',
  -- e.g. 'present', 'absent', 'half_day', 'on_leave', 'holiday'
  working_hours     NUMERIC(5,2)  DEFAULT 0.00,
  source            VARCHAR(20)   NOT NULL DEFAULT 'razorpayx',
  -- 'razorpayx' | 'manual'
  razorpayx_raw     JSONB,                           -- raw payload from API
  synced_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT attendance_employee_date_unique UNIQUE (employee_id, date)
);

COMMENT ON TABLE  attendance               IS 'Daily attendance synced from RazorpayX Payroll API';
COMMENT ON COLUMN attendance.employee_id   IS 'RazorpayX employee ID (string from Payroll)';
COMMENT ON COLUMN attendance.razorpayx_raw IS 'Full raw JSON response from RazorpayX for audit';

-- ─── TRIGGER ─────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_attendance_updated_at ON attendance;
CREATE TRIGGER trg_attendance_updated_at
  BEFORE UPDATE ON attendance
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ─── INDEXES ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_attendance_employee_id  ON attendance (employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date         ON attendance (date);
CREATE INDEX IF NOT EXISTS idx_attendance_user_id      ON attendance (user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_technician_id ON attendance (technician_id);
CREATE INDEX IF NOT EXISTS idx_attendance_status       ON attendance (status);
CREATE INDEX IF NOT EXISTS idx_attendance_synced_at    ON attendance (synced_at);

-- ─── TABLE: razorpayx_employees ──────────────────────────────
-- Cache of employee list fetched from RazorpayX
-- So we don't hit the API every time

CREATE TABLE IF NOT EXISTS razorpayx_employees (
  id              SERIAL        PRIMARY KEY,
  employee_id     VARCHAR(50)   NOT NULL UNIQUE,   -- RazorpayX employee ID
  name            VARCHAR(150),
  email           VARCHAR(255),
  user_id         INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  technician_id   INTEGER       REFERENCES technicians(id) ON DELETE SET NULL,
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  raw_data        JSONB,
  last_synced_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE razorpayx_employees IS 'Cache of employees fetched from RazorpayX Payroll';

CREATE INDEX IF NOT EXISTS idx_rpx_emp_email ON razorpayx_employees (email);
