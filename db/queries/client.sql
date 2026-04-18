-- ============================================================
-- FILE: db/queries/client.sql
-- All SQL queries used by the Clients APIs
-- ============================================================


-- ─── LIST CLIENTS ────────────────────────────────────────────

-- Get all clients (paginated)
-- Params: $1=limit, $2=offset
SELECT id, name, contact_person, email, phone, address,
       type, status, contract_value, join_date,
       created_at, updated_at
FROM clients
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;

-- Get total client count
SELECT COUNT(*) FROM clients;

-- Filter by type
-- Params: $1=type, $2=limit, $3=offset
SELECT id, name, contact_person, email, phone, address,
       type, status, contract_value, join_date,
       created_at, updated_at
FROM clients
WHERE type = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- Filter by status
-- Params: $1=status, $2=limit, $3=offset
SELECT id, name, contact_person, email, phone, address,
       type, status, contract_value, join_date,
       created_at, updated_at
FROM clients
WHERE status = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- Search by name or contact person (partial match)
-- Params: $1=%search%, $2=limit, $3=offset
SELECT id, name, contact_person, email, phone, address,
       type, status, contract_value, join_date,
       created_at, updated_at
FROM clients
WHERE LOWER(name)           LIKE $1
   OR LOWER(contact_person) LIKE $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;


-- ─── GET SINGLE CLIENT ───────────────────────────────────────

-- Get client by ID
-- Params: $1=id
SELECT id, name, contact_person, email, phone, address,
       type, status, contract_value, join_date,
       created_at, updated_at
FROM clients
WHERE id = $1;

-- Get stats for a client (total jobs, open jobs, active AMC count)
-- Params: $1=client_id
SELECT
  COUNT(*)                                        AS total_jobs,
  COUNT(*) FILTER (WHERE status != 'Closed')      AS open_jobs,
  (
    SELECT COUNT(*)
    FROM amc_contracts
    WHERE client_id = $1
      AND status = 'Active'
  )                                               AS active_amc_count
FROM jobs
WHERE client_id = $1;


-- ─── CREATE CLIENT ───────────────────────────────────────────

-- Insert new client
-- Params: $1=name, $2=contact_person, $3=email, $4=phone,
--         $5=address, $6=type, $7=status, $8=contract_value
INSERT INTO clients
  (name, contact_person, email, phone, address, type, status, contract_value, join_date)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE)
RETURNING id, name, contact_person, email, phone, address,
          type, status, contract_value, join_date,
          created_at, updated_at;


-- ─── UPDATE CLIENT ───────────────────────────────────────────

-- Update client record
-- Params: $1=name, $2=contact_person, $3=email, $4=phone,
--         $5=address, $6=type, $7=status, $8=contract_value, $9=id
UPDATE clients
SET name           = $1,
    contact_person = $2,
    email          = $3,
    phone          = $4,
    address        = $5,
    type           = $6,
    status         = $7,
    contract_value = $8
WHERE id = $9
RETURNING id, name, contact_person, email, phone, address,
          type, status, contract_value, join_date,
          created_at, updated_at;


-- ─── DELETE CLIENT ───────────────────────────────────────────

-- Check for open (non-closed) jobs before deleting
-- Params: $1=client_id
SELECT id FROM jobs
WHERE client_id = $1
  AND status != 'Closed';

-- Check for active AMC contracts before deleting
-- Params: $1=client_id
SELECT id FROM amc_contracts
WHERE client_id = $1
  AND status = 'Active';

-- Hard delete client (only allowed when no open jobs / active AMC)
-- Params: $1=id
DELETE FROM clients WHERE id = $1;
