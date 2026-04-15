-- ============================================================
-- FILE: db/queries/user.sql
-- All SQL queries used by the User Management APIs
-- ============================================================


-- ─── USER LIST ───────────────────────────────────────────────

-- Get all users with optional role filter + pagination
-- Params: $1=limit, $2=offset
SELECT id, email, first_name, last_name, phone_number, role, is_active, created_at, updated_at
FROM users
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;

-- Get all users filtered by role
-- Params: $1=role, $2=limit, $3=offset
SELECT id, email, first_name, last_name, phone_number, role, is_active, created_at, updated_at
FROM users
WHERE role = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- Get total user count (for pagination meta)
SELECT COUNT(*) FROM users;

-- Get total user count filtered by role
-- Params: $1=role
SELECT COUNT(*) FROM users WHERE role = $1;


-- ─── UPDATE USER ─────────────────────────────────────────────

-- Update user details by ID (admin can update anything)
-- Params: $1=first_name, $2=last_name, $3=phone_number, $4=role, $5=is_active, $6=id
UPDATE users
SET first_name = $1, last_name = $2, phone_number = $3, role = $4, is_active = $5
WHERE id = $6
RETURNING id, email, first_name, last_name, phone_number, role, is_active, created_at, updated_at;

-- Update own profile (user updates their own info — no role/is_active change)
-- Params: $1=first_name, $2=last_name, $3=phone_number, $4=id
UPDATE users
SET first_name = $1, last_name = $2, phone_number = $3
WHERE id = $4
RETURNING id, email, first_name, last_name, phone_number, role, is_active, created_at, updated_at;

-- Check phone uniqueness on update (exclude self)
-- Params: $1=phone_number, $2=user_id
SELECT id FROM users WHERE phone_number = $1 AND id != $2;


-- ─── DELETE USER ─────────────────────────────────────────────

-- Soft delete user (set is_active = false)
-- Params: $1=id
UPDATE users SET is_active = FALSE WHERE id = $1
RETURNING id, email, first_name, last_name, role;

-- Hard delete user permanently
-- Params: $1=id
DELETE FROM users WHERE id = $1
RETURNING id, email, first_name, last_name, role;

-- Find user by ID (for existence check)
-- Params: $1=id
SELECT id, is_active FROM users WHERE id = $1;
