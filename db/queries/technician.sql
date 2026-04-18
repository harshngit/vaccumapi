-- ============================================================
-- FILE: db/queries/technician.sql
-- All SQL queries used by the Technicians APIs
-- ============================================================


-- ─── LIST TECHNICIANS ────────────────────────────────────────

-- Get all technicians (paginated)
-- Params: $1=limit, $2=offset
SELECT id, user_id, name, email, phone, specialization,
       status, join_date, jobs_completed, rating, avatar,
       created_at, updated_at
FROM technicians
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;

-- Get total count (for pagination meta)
SELECT COUNT(*) FROM technicians;

-- Filter by status
-- Params: $1=status, $2=limit, $3=offset
SELECT id, user_id, name, email, phone, specialization,
       status, join_date, jobs_completed, rating, avatar,
       created_at, updated_at
FROM technicians
WHERE status = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- Filter by specialization (partial match)
-- Params: $1=%specialization%, $2=limit, $3=offset
SELECT id, user_id, name, email, phone, specialization,
       status, join_date, jobs_completed, rating, avatar,
       created_at, updated_at
FROM technicians
WHERE LOWER(specialization) LIKE $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- Search by name or specialization
-- Params: $1=%search%, $2=limit, $3=offset
SELECT id, user_id, name, email, phone, specialization,
       status, join_date, jobs_completed, rating, avatar,
       created_at, updated_at
FROM technicians
WHERE LOWER(name) LIKE $1
   OR LOWER(specialization) LIKE $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;


-- ─── GET SINGLE TECHNICIAN ───────────────────────────────────

-- Get technician by ID
-- Params: $1=id
SELECT id, user_id, name, email, phone, specialization,
       status, join_date, jobs_completed, rating, avatar,
       created_at, updated_at
FROM technicians
WHERE id = $1;

-- Get recent jobs for a technician (last 10)
-- Params: $1=technician_id
SELECT id, title, status, closed_date
FROM jobs
WHERE technician_id = $1
ORDER BY created_at DESC
LIMIT 10;


-- ─── CREATE TECHNICIAN ───────────────────────────────────────

-- Insert new technician profile
-- Params: $1=user_id (nullable), $2=name, $3=email, $4=phone,
--         $5=specialization, $6=status, $7=join_date, $8=avatar
INSERT INTO technicians
  (user_id, name, email, phone, specialization, status, join_date, avatar)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, user_id, name, email, phone, specialization,
          status, join_date, jobs_completed, rating, avatar,
          created_at, updated_at;

-- Create linked users row for technician login
-- Params: $1=first_name, $2=last_name, $3=email, $4=phone_number, $5=password(hashed)
INSERT INTO users (first_name, last_name, email, phone_number, password, role)
VALUES ($1, $2, $3, $4, $5, 'technician')
RETURNING id;

-- Check if a users row with role=technician already exists for email
-- Params: $1=email
SELECT id FROM users WHERE email = $1 AND role = 'technician';

-- Check if a users row with role=technician already exists for phone
-- Params: $1=phone_number
SELECT id FROM users WHERE phone_number = $1 AND role = 'technician';

-- Check if user_id is already linked to another technician profile
-- Params: $1=user_id
SELECT id FROM technicians WHERE user_id = $1;


-- ─── UPDATE TECHNICIAN ───────────────────────────────────────

-- Update technician profile
-- Params: $1=name, $2=email, $3=phone, $4=specialization,
--         $5=status, $6=join_date, $7=avatar, $8=id
UPDATE technicians
SET name           = $1,
    email          = $2,
    phone          = $3,
    specialization = $4,
    status         = $5,
    join_date      = $6,
    avatar         = $7
WHERE id = $8
RETURNING id, user_id, name, email, phone, specialization,
          status, join_date, jobs_completed, rating, avatar,
          created_at, updated_at;

-- Increment jobs_completed when a job is closed
-- Params: $1=technician_id
UPDATE technicians
SET jobs_completed = jobs_completed + 1
WHERE id = $1;


-- ─── DELETE TECHNICIAN ───────────────────────────────────────

-- Check for open (non-closed) jobs before deleting
-- Params: $1=technician_id
SELECT id FROM jobs
WHERE technician_id = $1
  AND status != 'Closed';

-- Hard delete technician (only allowed when no open jobs)
-- Params: $1=id
DELETE FROM technicians WHERE id = $1;


-- ─── TECHNICIAN LOGIN ────────────────────────────────────────

-- Find user+technician by email for login
-- Params: $1=email
SELECT u.id, u.email, u.first_name, u.last_name, u.phone_number,
       u.password, u.role, u.is_active,
       t.id             AS technician_id,
       t.name           AS technician_name,
       t.specialization,
       t.status         AS technician_status,
       t.avatar
FROM users u
LEFT JOIN technicians t ON t.user_id = u.id
WHERE u.email = $1
  AND u.role  = 'technician';

-- Find user+technician by phone for login
-- Params: $1=phone_number
SELECT u.id, u.email, u.first_name, u.last_name, u.phone_number,
       u.password, u.role, u.is_active,
       t.id             AS technician_id,
       t.name           AS technician_name,
       t.specialization,
       t.status         AS technician_status,
       t.avatar
FROM users u
LEFT JOIN technicians t ON t.user_id = u.id
WHERE u.phone_number = $1
  AND u.role         = 'technician';

-- Update last_login_at after successful login
-- Params: $1=user_id
UPDATE users SET last_login_at = NOW() WHERE id = $1;
