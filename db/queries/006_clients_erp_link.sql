-- ============================================================
-- FILE: db/queries/006_clients_erp_link.sql
-- Migration: allow clients to be mirrored from the external ERP
--            so AMC contracts can link to ERP customers by local id.
-- Run ONCE on your existing database.
-- ============================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS origin          VARCHAR(10) NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS erp_customer_id BIGINT,
  ADD COLUMN IF NOT EXISTS erp_cust_code   VARCHAR(50);

-- origin must be either 'local' (created in this app) or 'erp' (mirrored)
DO $$ BEGIN
  ALTER TABLE clients
    ADD CONSTRAINT clients_origin_check CHECK (origin IN ('local', 'erp'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- One local mirror per ERP customer (only enforced when erp_customer_id is set)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_clients_erp_customer_id
  ON clients (erp_customer_id)
  WHERE erp_customer_id IS NOT NULL;

COMMENT ON COLUMN clients.origin          IS 'Where this client came from: local (created here) or erp (mirrored from ERP)';
COMMENT ON COLUMN clients.erp_customer_id IS 'ERP CustId this local row mirrors (NULL for local clients)';
COMMENT ON COLUMN clients.erp_cust_code   IS 'ERP CustCode for reference (e.g. B59)';

SELECT '006_clients_erp_link applied successfully.' AS result;
