-- ============================================================
-- FILE: db/queries/016_amc_pumps.sql
-- Adds amc_pumps table for multiple pump serial/model entries
-- per AMC contract.
-- Run ONCE on your database.
-- ============================================================

CREATE TABLE IF NOT EXISTS amc_pumps (
  id            SERIAL       PRIMARY KEY,
  amc_id        VARCHAR(20)  NOT NULL REFERENCES amc_contracts(id) ON DELETE CASCADE,
  serial_number VARCHAR(100) NOT NULL,
  model_number  VARCHAR(100) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amc_pumps_amc_id ON amc_pumps (amc_id);

SELECT '016_amc_pumps applied successfully.' AS result;
