// ============================================================
// src/controllers/technicianController.js
// ============================================================

const pool    = require('../config/db');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');
const {
  isValidEmail,
  isValidPhone,
  isValidTechnicianStatus,
  computeAvatar,
} = require('../utils/validators');

const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// ────────────────────────────────────────────────────────────
// GET /api/technicians
// Returns ALL technicians PLUS users with role='technician'
// that don't already have a technician profile row.
// ────────────────────────────────────────────────────────────
const getTechnicians = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const { status, specialization, search } = req.query;

    if (status && !isValidTechnicianStatus(status)) {
      return sendError(res, 400, ERROR_CODES.INVALID_TECHNICIAN_STATUS,
        'Invalid status. Allowed values: Active, On Leave, Inactive.',
        { field: 'status', allowed: ['Active', 'On Leave', 'Inactive'] });
    }

    const conditions = [];
    const values     = [];

    if (status) {
      values.push(status);
      conditions.push(`t.status = $${values.length}`);
    }

    if (specialization) {
      values.push(`%${specialization.toLowerCase()}%`);
      conditions.push(`LOWER(t.specialization) LIKE $${values.length}`);
    }

    if (search) {
      values.push(`%${search.toLowerCase()}%`);
      const idx = values.length;
      conditions.push(`(LOWER(t.name) LIKE $${idx} OR LOWER(t.specialization) LIKE $${idx})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM technicians t ${where}`, values
    );
    const total = parseInt(countResult.rows[0].count);

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT
         t.id, t.user_id, t.name, t.email, t.phone, t.specialization,
         t.status, t.join_date, t.jobs_completed, t.rating, t.avatar,
         t.created_at, t.updated_at
       FROM technicians t
       ${where}
       ORDER BY t.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    });

  } catch (error) {
    console.error('Get technicians error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/technicians
// Creates a technician profile.
// If email/phone provided, also creates a linked users row
// with role='technician' so the technician can log in.
// If a users row with role='technician' already exists for
// that email/phone, it links to that user instead.
// ────────────────────────────────────────────────────────────
const createTechnician = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      name,
      email,
      phone,
      specialization,
      status = 'Active',
      join_date,
      // Optional login credentials — if provided, creates/links a user account
      password,
    } = req.body;

    // Required fields
    const missing = [];
    if (!name)           missing.push('name');
    if (!phone)          missing.push('phone');
    if (!specialization) missing.push('specialization');
    if (missing.length > 0) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        `Please fill in all required fields: ${missing.join(', ')}.`,
        { missing_fields: missing });
    }

    if (!isValidPhone(phone)) {
      return sendError(res, 400, ERROR_CODES.INVALID_PHONE_FORMAT,
        'Please enter a valid phone number.', { field: 'phone' });
    }

    if (email && !isValidEmail(email)) {
      return sendError(res, 400, ERROR_CODES.INVALID_EMAIL_FORMAT,
        'Please enter a valid email address.', { field: 'email' });
    }

    if (!isValidTechnicianStatus(status)) {
      return sendError(res, 400, ERROR_CODES.INVALID_TECHNICIAN_STATUS,
        'Invalid status. Allowed: Active, On Leave, Inactive.',
        { field: 'status' });
    }

    const avatar = computeAvatar(name);

    await client.query('BEGIN');

    // ── Resolve or create linked user account ──────────────
    let linkedUserId = null;

    if (email || phone) {
      // Check if a user with role=technician already exists for this email/phone
      let existingUser = null;

      if (email) {
        const r = await client.query(
          `SELECT id FROM users WHERE email = $1 AND role = 'technician'`,
          [email.toLowerCase()]
        );
        if (r.rows.length > 0) existingUser = r.rows[0];
      }

      if (!existingUser && phone) {
        const r = await client.query(
          `SELECT id FROM users WHERE phone_number = $1 AND role = 'technician'`,
          [phone]
        );
        if (r.rows.length > 0) existingUser = r.rows[0];
      }

      if (existingUser) {
        // Check that this user isn't already linked to another technician
        const alreadyLinked = await client.query(
          'SELECT id FROM technicians WHERE user_id = $1', [existingUser.id]
        );
        if (alreadyLinked.rows.length > 0) {
          await client.query('ROLLBACK');
          return sendError(res, 409, ERROR_CODES.PHONE_ALREADY_EXISTS,
            'A technician profile already exists for this email/phone.');
        }
        linkedUserId = existingUser.id;
      } else if (password) {
        // Create a new user account for login
        if (password.length < 6) {
          await client.query('ROLLBACK');
          return sendError(res, 400, ERROR_CODES.PASSWORD_TOO_SHORT,
            'Password must be at least 6 characters long.', { field: 'password' });
        }

        // Guard: unique email/phone in users table
        if (email) {
          const emailCheck = await client.query(
            'SELECT id FROM users WHERE email = $1', [email.toLowerCase()]
          );
          if (emailCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return Errors.emailExists(res);
          }
        }
        if (phone) {
          const phoneCheck = await client.query(
            'SELECT id FROM users WHERE phone_number = $1', [phone]
          );
          if (phoneCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return Errors.phoneExists(res);
          }
        }

        const nameParts    = name.trim().split(/\s+/);
        const firstName    = nameParts[0];
        const lastName     = nameParts.slice(1).join(' ') || '-';
        const hashedPass   = await bcrypt.hash(password, 12);

        const userResult = await client.query(
          `INSERT INTO users (first_name, last_name, email, phone_number, password, role)
           VALUES ($1, $2, $3, $4, $5, 'technician')
           RETURNING id`,
          [firstName, lastName, email ? email.toLowerCase() : null, phone || null, hashedPass]
        );
        linkedUserId = userResult.rows[0].id;
      }
    }

    // ── Insert technician row ─────────────────────────────
    const techResult = await client.query(
      `INSERT INTO technicians
         (user_id, name, email, phone, specialization, status, join_date, avatar)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, user_id, name, email, phone, specialization, status,
                 join_date, jobs_completed, rating, avatar, created_at, updated_at`,
      [
        linkedUserId,
        name.trim(),
        email ? email.toLowerCase() : null,
        phone,
        specialization.trim(),
        status,
        join_date || null,
        avatar,
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: `Technician ${name} added successfully.`,
      data: techResult.rows[0],
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create technician error:', error);
    return Errors.internalError(res);
  } finally {
    client.release();
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/technicians/:id
// ────────────────────────────────────────────────────────────
const getTechnicianById = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Invalid technician ID.', { field: 'id' });
    }

    const result = await pool.query(
      `SELECT t.id, t.user_id, t.name, t.email, t.phone, t.specialization,
              t.status, t.join_date, t.jobs_completed, t.rating, t.avatar,
              t.created_at, t.updated_at
       FROM technicians t
       WHERE t.id = $1`,
      [id]
    );

    if (result.rows.length === 0) return Errors.technicianNotFound(res);

    const technician = result.rows[0];

    // Recent jobs (last 10 closed)
    const recentJobs = await pool.query(
      `SELECT id, title, status, closed_date
       FROM jobs
       WHERE technician_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [id]
    );

    technician.recent_jobs = recentJobs.rows;

    return res.status(200).json({ success: true, data: technician });

  } catch (error) {
    console.error('Get technician by ID error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// PUT /api/technicians/:id
// ────────────────────────────────────────────────────────────
const updateTechnician = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Invalid technician ID.', { field: 'id' });
    }

    const existCheck = await pool.query('SELECT * FROM technicians WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.technicianNotFound(res);

    const cur = existCheck.rows[0];
    const { name, email, phone, specialization, status, join_date } = req.body;

    if (!name && !email && !phone && !specialization && !status && !join_date) {
      return sendError(res, 400, ERROR_CODES.NO_FIELDS_TO_UPDATE,
        'No fields provided to update. Please include at least one field.');
    }

    if (email && !isValidEmail(email)) {
      return sendError(res, 400, ERROR_CODES.INVALID_EMAIL_FORMAT,
        'Please enter a valid email address.', { field: 'email' });
    }

    if (phone && !isValidPhone(phone)) {
      return sendError(res, 400, ERROR_CODES.INVALID_PHONE_FORMAT,
        'Please enter a valid phone number.', { field: 'phone' });
    }

    if (status && !isValidTechnicianStatus(status)) {
      return sendError(res, 400, ERROR_CODES.INVALID_TECHNICIAN_STATUS,
        'Invalid status. Allowed: Active, On Leave, Inactive.', { field: 'status' });
    }

    const newName           = name           ? name.trim()           : cur.name;
    const newEmail          = email          ? email.toLowerCase()   : cur.email;
    const newPhone          = phone          || cur.phone;
    const newSpecialization = specialization ? specialization.trim() : cur.specialization;
    const newStatus         = status         || cur.status;
    const newJoinDate       = join_date      || cur.join_date;
    const newAvatar         = name ? computeAvatar(name) : cur.avatar;

    const result = await pool.query(
      `UPDATE technicians
       SET name=$1, email=$2, phone=$3, specialization=$4, status=$5, join_date=$6, avatar=$7
       WHERE id=$8
       RETURNING id, user_id, name, email, phone, specialization, status,
                 join_date, jobs_completed, rating, avatar, created_at, updated_at`,
      [newName, newEmail, newPhone, newSpecialization, newStatus, newJoinDate, newAvatar, id]
    );

    return res.status(200).json({
      success: true,
      message: 'Technician updated successfully.',
      data: result.rows[0],
    });

  } catch (error) {
    console.error('Update technician error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// DELETE /api/technicians/:id
// ────────────────────────────────────────────────────────────
const deleteTechnician = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Invalid technician ID.', { field: 'id' });
    }

    const existCheck = await pool.query('SELECT * FROM technicians WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.technicianNotFound(res);

    // Check for open (non-closed) jobs
    const openJobs = await pool.query(
      `SELECT id FROM jobs WHERE technician_id = $1 AND status != 'Closed'`,
      [id]
    );

    if (openJobs.rows.length > 0) {
      return sendError(res, 409, ERROR_CODES.TECHNICIAN_HAS_OPEN_JOBS,
        'Cannot delete technician. They have open jobs that must be closed first.',
        { open_job_ids: openJobs.rows.map(r => r.id) });
    }

    await pool.query('DELETE FROM technicians WHERE id = $1', [id]);

    return res.status(200).json({
      success: true,
      message: `Technician "${existCheck.rows[0].name}" deleted successfully.`,
    });

  } catch (error) {
    console.error('Delete technician error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/technicians/login
// Technicians log in using their linked users account
// (same endpoint logic, separate route for clarity)
// ────────────────────────────────────────────────────────────
const technicianLogin = async (req, res) => {
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

    // Look up in users table with role = technician
    let userResult;
    if (email) {
      userResult = await pool.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.phone_number,
                u.password, u.role, u.is_active,
                t.id AS technician_id, t.name AS technician_name,
                t.specialization, t.status AS technician_status, t.avatar
         FROM users u
         LEFT JOIN technicians t ON t.user_id = u.id
         WHERE u.email = $1 AND u.role = 'technician'`,
        [email.toLowerCase()]
      );
    } else {
      userResult = await pool.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.phone_number,
                u.password, u.role, u.is_active,
                t.id AS technician_id, t.name AS technician_name,
                t.specialization, t.status AS technician_status, t.avatar
         FROM users u
         LEFT JOIN technicians t ON t.user_id = u.id
         WHERE u.phone_number = $1 AND u.role = 'technician'`,
        [phone_number]
      );
    }

    if (userResult.rows.length === 0) return Errors.invalidCredentials(res);

    const user = userResult.rows[0];

    if (!user.is_active) {
      return sendError(res, 403, ERROR_CODES.ACCOUNT_INACTIVE,
        'Your account has been deactivated. Please contact your administrator.');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return Errors.invalidCredentials(res);

    const token = generateToken(user.id);

    // Update last_login_at
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const { password: _pw, ...safeUser } = user;

    return res.status(200).json({
      success: true,
      message: `Welcome back, ${user.technician_name || user.first_name}!`,
      token,
      user: safeUser,
    });

  } catch (error) {
    console.error('Technician login error:', error);
    return Errors.internalError(res);
  }
};

module.exports = {
  getTechnicians,
  createTechnician,
  getTechnicianById,
  updateTechnician,
  deleteTechnician,
  technicianLogin,
};
