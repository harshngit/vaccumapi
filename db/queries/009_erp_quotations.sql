-- ============================================================
-- FILE: db/queries/009_erp_quotations.sql
-- Creates tables for locally-synced ERP quotations.
-- Run ONCE on your database before using POST /api/erp/sync/quotations.
-- ============================================================

-- ── Main quotations table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_quotations (
    quot_id            INTEGER PRIMARY KEY,   -- ERP QuotId (stable across syncs)
    quot_no            VARCHAR(50),
    enquiry_no         VARCHAR(50),
    enquiry_id         INTEGER,
    date               DATE,
    enquiry_date       DATE,
    subject            TEXT,
    kind_attention     VARCHAR(255),
    email              VARCHAR(255),

    -- Raw ERP customer info (always stored)
    erp_customer_id    INTEGER,
    erp_customer_code  VARCHAR(50),
    erp_customer_name  VARCHAR(255),
    bill_to_id         INTEGER,
    bill_to_name       VARCHAR(255),
    ship_to_id         INTEGER,
    ship_to_name       VARCHAR(255),

    -- Link to local clients table (matched via clients.erp_customer_id)
    -- NULL if no matching local client found
    client_id          INTEGER REFERENCES clients(id) ON DELETE SET NULL,

    priority           VARCHAR(20),
    category           VARCHAR(100),
    sector             VARCHAR(100),
    plant              VARCHAR(100),
    financial_year     VARCHAR(10),
    currency           VARCHAR(10) DEFAULT 'Rs',

    net_total          NUMERIC(14,2) DEFAULT 0,
    discount_per       NUMERIC(6,2)  DEFAULT 0,
    discount_amt       NUMERIC(14,2) DEFAULT 0,

    cgst_per           NUMERIC(6,2)  DEFAULT 0,
    cgst_amt           NUMERIC(14,2) DEFAULT 0,
    sgst_per           NUMERIC(6,2)  DEFAULT 0,
    sgst_amt           NUMERIC(14,2) DEFAULT 0,
    igst_per           NUMERIC(6,2)  DEFAULT 0,
    igst_amt           NUMERIC(14,2) DEFAULT 0,

    prepared_by        VARCHAR(100),
    prepared_by_id     INTEGER,
    entered_by         VARCHAR(100),
    entered_by_id      INTEGER,

    quotation_status   VARCHAR(20)  DEFAULT 'Open',  -- Open | Approved | Cancelled
    enquiry_status     VARCHAR(50),
    is_amended         BOOLEAN      DEFAULT FALSE,
    is_cancelled       BOOLEAN      DEFAULT FALSE,
    version_no         INTEGER      DEFAULT 0,

    auth1_status       VARCHAR(5),
    auth1_by           VARCHAR(100),
    auth1_date         DATE,
    auth2_status       VARCHAR(5),
    auth2_by           VARCHAR(100),
    auth2_date         DATE,

    cancel_by          VARCHAR(100),
    cancel_date        DATE,
    cancel_remark      TEXT,

    synced_at          TIMESTAMPTZ  DEFAULT NOW(),   -- last time pulled from ERP
    created_at         TIMESTAMPTZ  DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Line items table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS erp_quotation_items (
    id           SERIAL PRIMARY KEY,
    quot_id      INTEGER NOT NULL REFERENCES erp_quotations(quot_id) ON DELETE CASCADE,
    line_id      INTEGER,            -- ERP DetailAutoId
    item_id      INTEGER,
    item_code    VARCHAR(100),
    item_no      VARCHAR(100),
    description  TEXT,
    qty          NUMERIC(10,3) DEFAULT 0,
    unit         VARCHAR(20),
    rate         NUMERIC(14,2) DEFAULT 0,
    discount_per NUMERIC(6,2)  DEFAULT 0,
    discount_amt NUMERIC(14,2) DEFAULT 0,
    total        NUMERIC(14,2) DEFAULT 0,
    note         TEXT,
    hsn_code     VARCHAR(50),
    created_at   TIMESTAMPTZ   DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_erp_quotations_date
    ON erp_quotations (date);

CREATE INDEX IF NOT EXISTS idx_erp_quotations_status
    ON erp_quotations (quotation_status);

CREATE INDEX IF NOT EXISTS idx_erp_quotations_erp_customer
    ON erp_quotations (erp_customer_id);

CREATE INDEX IF NOT EXISTS idx_erp_quotations_client
    ON erp_quotations (client_id);

CREATE INDEX IF NOT EXISTS idx_erp_quotations_enquiry
    ON erp_quotations (enquiry_id);

CREATE INDEX IF NOT EXISTS idx_erp_quotation_items_quot
    ON erp_quotation_items (quot_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_erp_quotation_items_line
    ON erp_quotation_items (quot_id, line_id)
    WHERE line_id IS NOT NULL;

-- ── updated_at trigger ────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_erp_quotations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_erp_quotations_updated_at ON erp_quotations;
CREATE TRIGGER trg_erp_quotations_updated_at
    BEFORE UPDATE ON erp_quotations
    FOR EACH ROW EXECUTE FUNCTION fn_erp_quotations_updated_at();

SELECT '009_erp_quotations applied successfully.' AS result;
