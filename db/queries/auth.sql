-- ============================================================
-- FILE: db/queries/auth.sql
-- All SQL queries used by the Auth APIs
-- ============================================================


-- ─── REGISTER ───────────────────────────────────────────────

-- Insert a new user
-- Params: $1=email, $2=first_name, $3=last_name, $4=phone_number, $5=password(hashed), $6=role
INSERT INTO users (email, first_name, last_name, phone_number, password, role)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, email, first_name, last_name, phone_number, role, is_active, created_at, updated_at;


-- Check if email already exists (used before register)
-- Params: $1=email
SELECT id FROM users WHERE email = $1;


-- Check if phone number already exists (used before register)
-- Params: $1=phone_number
SELECT id FROM users WHERE phone_number = $1;


-- ─── LOGIN ───────────────────────────────────────────────────

-- Find user by email (for login)
-- Params: $1=email
SELECT id, email, first_name, last_name, phone_number, password, role, is_active, created_at, updated_at
FROM users
WHERE email = $1 AND is_active = TRUE;


-- Find user by phone number (for login)
-- Params: $1=phone_number
SELECT id, email, first_name, last_name, phone_number, password, role, is_active, created_at, updated_at
FROM users
WHERE phone_number = $1 AND is_active = TRUE;


-- ─── AUTH ME ─────────────────────────────────────────────────

-- Fetch authenticated user details by ID (used in /auth/me)
-- Params: $1=user_id
SELECT id, email, first_name, last_name, phone_number, role, is_active, created_at, updated_at
FROM users
WHERE id = $1 AND is_active = TRUE;
