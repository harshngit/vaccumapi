-- ============================================================
-- FILE: db/queries/user.sql
-- All SQL queries used by the User Management APIs
-- ============================================================


-- ─── LIST USERS ──────────────────────────────────────────────

-- Get all users (paginated)
-- Params: $1=limit, $2=offset
SELECT id, email, first_name, last_name, phone_number,
       role, is_active, last_login_at, created_at, updated_at
FROM users
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;

-- Get total user count (for pagination meta)
SELECT COUNT(*) FROM users;

-- Filter by role
-- Params: $1=role, $2=limit, $3=offset
SELECT id, email, first_name, last_name, phone_number,
       role, is_active, last_login_at, created_at, updated_at
FROM users
WHERE role = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- Filter by is_active
-- Params: $1=is_active (boolean), $2=limit, $3=offset
SELECT id, email, first_name, last_name, phone_number,
       role, is_active, last_login_at, created_at, updated_at
FROM users
WHERE is_active = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- Search by first_name, last_name, or email (partial match)
-- Params: $1=%search%, $2=limit, $3=offset
SELECT id, email, first_name, last_name, phone_number,
       role, is_active, last_login_at, created_at, updated_at
FROM users
WHERE LOWER(first_name) LIKE $1
   OR LOWER(last_name)  LIKE $1
   OR LOWER(COALESCE(email, '')) LIKE $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;


-- ─── GET SINGLE USER ─────────────────────────────────────────

-- Get user by ID
-- Params: $1=id
SELECT id, email, first_name, last_name, phone_number,
       role, is_active, last_login_at, created_at, updated_at
FROM users
WHERE id = $1;

-- Check user exists (for update / delete pre-checks)
-- Params: $1=id
SELECT id, role, is_active FROM users WHERE id = $1;


-- ─── CREATE USER (admin) ─────────────────────────────────────

-- Insert a new user (admin-created, no auto-login token)
-- Params: $1=email, $2=first_name, $3=last_name, $4=phone_number,
--         $5=password(hashed), $6=role, $7=is_active
INSERT INTO users (email, first_name, last_name, phone_number, password, role, is_active)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, email, first_name, last_name, phone_number,
          role, is_active, created_at, updated_at;

-- Check email uniqueness before create
-- Params: $1=email
SELECT id FROM users WHERE email = $1;

-- Check phone uniqueness before create
-- Params: $1=phone_number
SELECT id FROM users WHERE phone_number = $1;


-- ─── UPDATE USER ─────────────────────────────────────────────

-- Full update by admin (can change role + is_active)
-- Params: $1=first_name, $2=last_name, $3=phone_number,
--         $4=role, $5=is_active, $6=id
UPDATE users
SET first_name   = $1,
    last_name    = $2,
    phone_number = $3,
    role         = $4,
    is_active    = $5
WHERE id = $6
RETURNING id, email, first_name, last_name, phone_number,
          role, is_active, created_at, updated_at;

-- Self-update (user updates own profile — role/is_active not changeable)
-- Params: $1=first_name, $2=last_name, $3=phone_number, $4=id
UPDATE users
SET first_name   = $1,
    last_name    = $2,
    phone_number = $3
WHERE id = $4
RETURNING id, email, first_name, last_name, phone_number,
          role, is_active, created_at, updated_at;

-- Check phone uniqueness on update (exclude current user)
-- Params: $1=phone_number, $2=user_id
SELECT id FROM users WHERE phone_number = $1 AND id != $2;

-- Count active admins (used to prevent deactivating last admin)
-- Params: $1=user_id (the one being deactivated)
SELECT COUNT(*) FROM users
WHERE role = 'admin'
  AND is_active = TRUE
  AND id != $1;


-- ─── DELETE USER (soft) ──────────────────────────────────────

-- Soft delete — set is_active = FALSE (record is preserved)
-- Params: $1=id
UPDATE users
SET is_active = FALSE
WHERE id = $1
RETURNING id, email, first_name, last_name, role;