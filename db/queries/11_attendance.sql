-- ============================================================
-- FILE: db/queries/11_attendance.sql
-- Module: Attendance — RazorpayX People API
-- Depends on: 01_users.sql, 02_technicians.sql
-- ============================================================

-- ─── TABLE: razorpayx_employees ──────────────────────────────
-- Stores employee data fetched from RazorpayX People API

CREATE TABLE IF NOT EXISTS razorpayx_employees (
  id                    SERIAL        PRIMARY KEY,
  employee_id           VARCHAR(50)   NOT NULL UNIQUE,   -- numeric RazorpayX employee ID
  name                  VARCHAR(150),
  email                 VARCHAR(255),
  phone_number          VARCHAR(20),
  date_of_birth         DATE,
  date_of_hiring        DATE,
  title                 VARCHAR(150),
  department            VARCHAR(150),
  manager_employee_id   VARCHAR(50),
  manager_email         VARCHAR(255),
  pan                   VARCHAR(20),
  bank_ifsc             VARCHAR(20),
  bank_account_number   VARCHAR(60),
  is_active             BOOLEAN       NOT NULL DEFAULT TRUE,
  -- local references (optional)
  user_id               INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  technician_id         INTEGER       REFERENCES technicians(id) ON DELETE SET NULL,
  -- raw payload from API for audit
  raw_data              JSONB,
  last_synced_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  razorpayx_employees         IS 'Employees fetched and stored from RazorpayX People API';
COMMENT ON COLUMN razorpayx_employees.employee_id IS 'Numeric employee ID from RazorpayX';

-- ─── ALTER: add new columns if table already exists ──────────
-- Safe to run on an existing DB — skips columns that already exist

ALTER TABLE razorpayx_employees ADD COLUMN IF NOT EXISTS phone_number        VARCHAR(20);
ALTER TABLE razorpayx_employees ADD COLUMN IF NOT EXISTS date_of_birth       DATE;
ALTER TABLE razorpayx_employees ADD COLUMN IF NOT EXISTS date_of_hiring      DATE;
ALTER TABLE razorpayx_employees ADD COLUMN IF NOT EXISTS title               VARCHAR(150);
ALTER TABLE razorpayx_employees ADD COLUMN IF NOT EXISTS department          VARCHAR(150);
ALTER TABLE razorpayx_employees ADD COLUMN IF NOT EXISTS manager_employee_id VARCHAR(50);
ALTER TABLE razorpayx_employees ADD COLUMN IF NOT EXISTS manager_email       VARCHAR(255);
ALTER TABLE razorpayx_employees ADD COLUMN IF NOT EXISTS pan                 VARCHAR(20);
ALTER TABLE razorpayx_employees ADD COLUMN IF NOT EXISTS bank_ifsc           VARCHAR(20);
ALTER TABLE razorpayx_employees ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(60);
ALTER TABLE razorpayx_employees ADD COLUMN IF NOT EXISTS updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE razorpayx_employees ADD COLUMN IF NOT EXISTS annual_ctc              NUMERIC(12,2);
ALTER TABLE razorpayx_employees ADD COLUMN IF NOT EXISTS custom_salary_structure BOOLEAN DEFAULT FALSE;

-- Comments on columns that may have just been added
COMMENT ON COLUMN razorpayx_employees.annual_ctc              IS 'Annual CTC set via RazorpayX set-salary';
COMMENT ON COLUMN razorpayx_employees.custom_salary_structure IS 'Whether employee uses a custom salary structure';
COMMENT ON COLUMN razorpayx_employees.pan                     IS 'PAN number from RazorpayX';
COMMENT ON COLUMN razorpayx_employees.bank_ifsc           IS 'Bank IFSC code from RazorpayX';
COMMENT ON COLUMN razorpayx_employees.bank_account_number IS 'Bank account number from RazorpayX';

-- ─── TRIGGER ─────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_razorpayx_employees_updated_at ON razorpayx_employees;
CREATE TRIGGER trg_razorpayx_employees_updated_at
  BEFORE UPDATE ON razorpayx_employees
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ─── INDEXES ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_rpx_emp_email       ON razorpayx_employees (email);
CREATE INDEX IF NOT EXISTS idx_rpx_emp_department  ON razorpayx_employees (department);
CREATE INDEX IF NOT EXISTS idx_rpx_emp_is_active   ON razorpayx_employees (is_active);
