-- ============================================================
-- FILE: db/queries/004_amc_report_pdf_fields.sql
-- Migration: Add AMC Service Report PDF fields to reports table
--            and create 3 new child tables for structured data
-- Run ONCE on your existing database (after 003_reports_amc_updates.sql)
-- ============================================================     

-- ─── 1. Add new columns to reports table ─────────────────────
--     Maps to PDF Page 1 (client info block) + Page 3 (remarks)
--     and Page 4 (signature block)

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS company_name                  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_person                VARCHAR(255),
  ADD COLUMN IF NOT EXISTS model_serial_installation     VARCHAR(300),
  ADD COLUMN IF NOT EXISTS operating_hours_per_day       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS application_process_description TEXT,
  ADD COLUMN IF NOT EXISTS remarks                       TEXT,
  ADD COLUMN IF NOT EXISTS vdt_representative_name       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS client_representative_name    VARCHAR(255);

COMMENT ON COLUMN reports.company_name
  IS 'PDF Page 1 – Company Name (may differ from clients.name snapshot)';
COMMENT ON COLUMN reports.contact_person
  IS 'PDF Page 1 – Contact Person at client site';
COMMENT ON COLUMN reports.model_serial_installation
  IS 'PDF Page 1 – Model - Serial No. - Installation Year (combined field)';
COMMENT ON COLUMN reports.operating_hours_per_day
  IS 'PDF Page 1 – Operating Hours / Day';
COMMENT ON COLUMN reports.application_process_description
  IS 'PDF Page 1 – Application / Process Description';
COMMENT ON COLUMN reports.remarks
  IS 'PDF Page 3 – Free-text Remarks section';
COMMENT ON COLUMN reports.vdt_representative_name
  IS 'PDF Page 4 – Vacuum Drying Technology representative signatory';
COMMENT ON COLUMN reports.client_representative_name
  IS 'PDF Page 4 – Client representative signatory';


-- ─── 2. TABLE: report_checklist_items ────────────────────────
--     Maps to PDF Page 1 – Checklist (Routine Preventive Maintenance)
--
--     SR | Description                                     | Status
--      1 | Check the oil level in the oil reserves.        | OK / Topped Up
--      2 | Check the oil level on the Root Compressors ... | OK / Topped Up / NA
--      3 | Check the lubrication circuit.                  | Normal / Leakage / Blockage
--      4 | Check the discharge valves.                     | OK / Cleaned/Replaced / Spare Required
--      5 | Check & adjust the Gland packing.               | OK / Adjusted/Replaced / Spare Required
--      6 | Oil filter cleaning.                            | OK / Cleaned/Replaced / Spare Required
--      7 | Greasing of the pump.                           | OK / Done
--      8 | Check the oil seal Ring.                        | OK / Replaced / Spare Required
--      9 | Check & adjustment of the driving belts.        | OK / Replaced / Spare Required

CREATE TABLE IF NOT EXISTS report_checklist_items (
  id          SERIAL        PRIMARY KEY,
  report_id   VARCHAR(20)   NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  sr          INTEGER       NOT NULL,                     -- SR number (1-9+)
  description TEXT          NOT NULL,                     -- Checklist item text
  status      VARCHAR(150),                               -- Selected status value(s)
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  report_checklist_items            IS 'PDF Page 1 – Routine Preventive Maintenance Checklist items';
COMMENT ON COLUMN report_checklist_items.sr         IS 'Serial number of the checklist item';
COMMENT ON COLUMN report_checklist_items.description IS 'Checklist item description';
COMMENT ON COLUMN report_checklist_items.status     IS 'Checked status, e.g. OK, Topped Up, Leakage, Cleaned/Replaced, Spare Required';

CREATE INDEX IF NOT EXISTS idx_checklist_report_id ON report_checklist_items (report_id);


-- ─── 3. TABLE: report_issue_observations ─────────────────────
--     Maps to PDF Page 2 – Detailed Issue - Observation - Impact Matrix
--
--     SR | Issue          | Observation               | Impact on Pump    | Severity | Recommended Spares
--      1 | Low Vaccum     | Valve damage (chock up)   | Overheat          | Med      | Valve set
--      1 | Low Vaccum     | Slide valve Damaged       | Abnormal Noise    | High     | slide valve or spring
--      2 | Abnormal Sound | Slide valve / Slide Valve | Overheat, Low Vac | High     | Slide valve / spring
--     ...

CREATE TABLE IF NOT EXISTS report_issue_observations (
  id                  SERIAL        PRIMARY KEY,
  report_id           VARCHAR(20)   NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  sr                  INTEGER,                            -- Groups rows by issue number
  issue               VARCHAR(255),                       -- Issue category (e.g. Low Vaccum, Abnormal Sound)
  observation         TEXT,                               -- Specific observation (e.g. Valve damage)
  impact_on_pump      VARCHAR(255),                       -- Effect on pump (e.g. Overheat)
  severity            VARCHAR(20),                        -- Low / Med / High
  recommended_spares  TEXT,                               -- Spare part name(s)
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  report_issue_observations                  IS 'PDF Page 2 – Issue-Observation-Impact Matrix rows';
COMMENT ON COLUMN report_issue_observations.sr               IS 'Groups multiple observations under the same issue SR number';
COMMENT ON COLUMN report_issue_observations.issue            IS 'Issue category, e.g. Low Vaccum, Abnormal Sound, Excessive Oil, No Lubrication';
COMMENT ON COLUMN report_issue_observations.observation      IS 'Specific observation for the issue';
COMMENT ON COLUMN report_issue_observations.impact_on_pump   IS 'Impact this observation has on the pump';
COMMENT ON COLUMN report_issue_observations.severity         IS 'Low, Med, or High';
COMMENT ON COLUMN report_issue_observations.recommended_spares IS 'Recommended spare part(s) to resolve this observation';

CREATE INDEX IF NOT EXISTS idx_issue_obs_report_id ON report_issue_observations (report_id);


-- ─── 4. TABLE: report_mandatory_spares ───────────────────────
--     Maps to PDF Page 4 – Mandatory Spares - AMC Compliance Matrix
--
--     Spare Name                     | Pump Model | Total To Order
--     Complete set of Gaskets        |            |
--     Complete set of Valve Gasket   |            |
--     Complete set of Valve Spring   |            |
--     Complete set of Valve Screw    |            |
--     Complete set of Oil Connectors |            |
--     Ferrule / Insert / Reducer set |            |
--     Nylon Tubing Set               |            |

CREATE TABLE IF NOT EXISTS report_mandatory_spares (
  id              SERIAL        PRIMARY KEY,
  report_id       VARCHAR(20)   NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  spare_name      VARCHAR(255)  NOT NULL,                -- Spare part name
  pump_model      VARCHAR(150),                          -- Applicable pump model
  total_to_order  VARCHAR(100),                          -- Quantity to order
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  report_mandatory_spares                IS 'PDF Page 4 – Mandatory Spares AMC Compliance Matrix rows';
COMMENT ON COLUMN report_mandatory_spares.spare_name     IS 'Name of the mandatory spare part';
COMMENT ON COLUMN report_mandatory_spares.pump_model     IS 'Pump model this spare applies to';
COMMENT ON COLUMN report_mandatory_spares.total_to_order IS 'Total quantity to be ordered / maintained on site';

CREATE INDEX IF NOT EXISTS idx_mandatory_spares_report_id ON report_mandatory_spares (report_id);


-- ─── 5. Done ──────────────────────────────────────────────────
SELECT '004_amc_report_pdf_fields applied successfully.' AS result;
