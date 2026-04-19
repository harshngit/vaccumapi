const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const pool      = require('../config/db');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');
const { isValidEmail, isValidPhone, isValidRole } = require('../utils/validators');
const { logActivity } = require('./activityController');

const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

const sanitizeUser = ({ password, ...user }) => user;

// ────────────────────────────────────────────────────────────
// POST /api/auth/register
// ────────────────────────────────────────────────────────────
const register = async (req, res) => {
  try {
    const { email, first_name, last_name, phone_number, password, role } = req.body;

    // Missing fields
    const missing = [];
    if (!email)        missing.push('email');
    if (!first_name)   missing.push('first_name');
    if (!last_name)    missing.push('last_name');
    if (!phone_number) missing.push('phone_number');
    if (!password)     missing.push('password');
    if (!role)         missing.push('role');
    if (missing.length > 0) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        `Please fill in all required fields: ${missing.join(', ')}.`,
        { missing_fields: missing });
    }

    // Email format
    if (!isValidEmail(email)) {
      return sendError(res, 400, ERROR_CODES.INVALID_EMAIL_FORMAT,
        'Please enter a valid email address (e.g. john@example.com).',
        { field: 'email' });
    }

    // Phone format
    if (!isValidPhone(phone_number)) {
      return sendError(res, 400, ERROR_CODES.INVALID_PHONE_FORMAT,
        'Please enter a valid phone number (e.g. +911234567890).',
        { field: 'phone_number' });
    }

    // Password length
    if (password.length < 6) {
      return sendError(res, 400, ERROR_CODES.PASSWORD_TOO_SHORT,
        'Password must be at least 6 characters long.',
        { field: 'password', min_length: 6 });
    }

    // Role
    if (!isValidRole(role)) {
      return sendError(res, 400, ERROR_CODES.INVALID_ROLE,
        'Invalid role. Allowed roles are: admin, engineer, labour, manager.',
        { field: 'role', allowed: ['admin', 'engineer', 'labour', 'manager'] });
    }

    // Duplicate email
    const emailCheck = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (emailCheck.rows.length > 0) return Errors.emailExists(res);

    // Duplicate phone
    const phoneCheck = await pool.query('SELECT id FROM users WHERE phone_number = $1', [phone_number]);
    if (phoneCheck.rows.length > 0) return Errors.phoneExists(res);

    // Create user
    const hashedPassword = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, first_name, last_name, phone_number, password, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, first_name, last_name, phone_number, role, is_active, created_at, updated_at`,
      [email.toLowerCase(), first_name.trim(), last_name.trim(), phone_number, hashedPassword, role]
    );

    const user  = result.rows[0];
    const token = generateToken(user.id);

    await logActivity({
      type:         'user',
      action:       `New user registered: ${user.first_name} ${user.last_name} (${user.role})`,
      entity_type:  'user',
      entity_id:    String(user.id),
      performed_by: user.id,
    });

    return res.status(201).json({
      success: true,
      message: 'Account created successfully. Welcome!',
      token,
      user,
    });

  } catch (error) {
    console.error('Register error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/auth/login
// ────────────────────────────────────────────────────────────
const login = async (req, res) => {
  try {
    const { email, phone_number, password } = req.body;

    if (!password) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'Password is required.', { field: 'password' });
    }
    if (!email && !phone_number) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'Please provide either your email address or phone number.',
        { missing_fields: ['email or phone_number'] });
    }
    if (email && !isValidEmail(email)) {
      return sendError(res, 400, ERROR_CODES.INVALID_EMAIL_FORMAT,
        'Please enter a valid email address.', { field: 'email' });
    }

    let result;
    if (email) {
      result = await pool.query(
        `SELECT id, email, first_name, last_name, phone_number, password, role, is_active, created_at, updated_at
         FROM users WHERE email = $1`, [email.toLowerCase()]);
    } else {
      result = await pool.query(
        `SELECT id, email, first_name, last_name, phone_number, password, role, is_active, created_at, updated_at
         FROM users WHERE phone_number = $1`, [phone_number]);
    }

    // User not found — same message as wrong password (prevents user enumeration)
    if (result.rows.length === 0) return Errors.invalidCredentials(res);

    const user = result.rows[0];

    if (!user.is_active) {
      return sendError(res, 403, ERROR_CODES.ACCOUNT_INACTIVE,
        'Your account has been deactivated. Please contact your administrator.');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return Errors.invalidCredentials(res);

    const token = generateToken(user.id);

    await logActivity({
      type:         'auth',
      action:       `User "${user.first_name} ${user.last_name}" logged in`,
      entity_type:  'user',
      entity_id:    String(user.id),
      performed_by: user.id,
    });

    return res.status(200).json({
      success: true,
      message: `Welcome back, ${user.first_name}!`,
      token,
      user: sanitizeUser(user),
    });

  } catch (error) {
    console.error('Login error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/auth/me
// ────────────────────────────────────────────────────────────
const authMe = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, first_name, last_name, phone_number, role, is_active, created_at, updated_at
       FROM users WHERE id = $1 AND is_active = TRUE`,
      [req.user.id]
    );

    if (result.rows.length === 0) return Errors.userNotFound(res);

    return res.status(200).json({ success: true, user: result.rows[0] });

  } catch (error) {
    console.error('AuthMe error:', error);
    return Errors.internalError(res);
  }
};

module.exports = { register, login, authMe };