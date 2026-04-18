const pool    = require('../config/db');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');
const { isValidPhone, isValidRole } = require('../utils/validators');
const { logActivity } = require('./activityController');

// ────────────────────────────────────────────────────────────
// GET /api/users
// ────────────────────────────────────────────────────────────
const getUsers = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;
    const { role, search } = req.query;

    if (role && !isValidRole(role)) {
      return sendError(res, 400, ERROR_CODES.INVALID_ROLE,
        'Invalid role filter. Allowed values: admin, engineer, labour, manager.',
        { field: 'role', allowed: ['admin', 'engineer', 'labour', 'manager'] });
    }

    const conditions = [];
    const values     = [];

    if (role) {
      values.push(role);
      conditions.push(`role = $${values.length}`);
    }

    if (search) {
      values.push(`%${search.toLowerCase()}%`);
      const idx = values.length;
      conditions.push(`(LOWER(first_name) LIKE $${idx} OR LOWER(last_name) LIKE $${idx} OR LOWER(email) LIKE $${idx})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM users ${where}`, values);
    const total       = parseInt(countResult.rows[0].count);

    values.push(limit, offset);
    const usersResult = await pool.query(
      `SELECT id, email, first_name, last_name, phone_number, role, is_active, created_at, updated_at
       FROM users ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return res.status(200).json({
      success: true,
      data: usersResult.rows,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    });

  } catch (error) {
    console.error('Get users error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// PUT /api/users/:id
// ────────────────────────────────────────────────────────────
const updateUser = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) {
      return sendError(res, 400, ERROR_CODES.INVALID_USER_ID,
        'Invalid user ID. Please provide a valid numeric ID.',
        { field: 'id' });
    }

    const existCheck = await pool.query('SELECT id, is_active FROM users WHERE id = $1', [userId]);
    if (existCheck.rows.length === 0) return Errors.userNotFound(res);

    const isAdmin = req.user.role === 'admin';
    const isSelf  = req.user.id   === userId;

    if (!isAdmin && !isSelf) {
      return sendError(res, 403, ERROR_CODES.FORBIDDEN,
        'Access denied. You can only update your own profile.');
    }

    const { first_name, last_name, phone_number, role, is_active } = req.body;

    if (!first_name && !last_name && !phone_number && role === undefined && is_active === undefined) {
      return sendError(res, 400, ERROR_CODES.NO_FIELDS_TO_UPDATE,
        'No fields provided to update. Please include at least one field.');
    }

    // Role validation (admin only)
    if (role !== undefined) {
      if (!isAdmin) {
        return sendError(res, 403, ERROR_CODES.FORBIDDEN,
          'Access denied. Only admins can change user roles.');
      }
      if (!isValidRole(role)) {
        return sendError(res, 400, ERROR_CODES.INVALID_ROLE,
          'Invalid role. Allowed roles are: admin, engineer, labour, manager.',
          { field: 'role', allowed: ['admin', 'engineer', 'labour', 'manager'] });
      }
    }

    // Fetch current data to merge
    const currentUser = await pool.query(
      'SELECT first_name, last_name, phone_number, role, is_active FROM users WHERE id = $1',
      [userId]
    );
    const cur = currentUser.rows[0];

    // Phone uniqueness check
    const newPhone = phone_number || cur.phone_number;
    if (phone_number && phone_number !== cur.phone_number) {
      if (!isValidPhone(phone_number)) {
        return sendError(res, 400, ERROR_CODES.INVALID_PHONE_FORMAT,
          'Please enter a valid phone number.', { field: 'phone_number' });
      }
      const phoneCheck = await pool.query(
        'SELECT id FROM users WHERE phone_number = $1 AND id != $2', [phone_number, userId]);
      if (phoneCheck.rows.length > 0) {
        return sendError(res, 409, ERROR_CODES.PHONE_ALREADY_IN_USE,
          'This phone number is already linked to another account. Please use a different number.',
          { field: 'phone_number' });
      }
    }

    const newFirstName = first_name ? first_name.trim() : cur.first_name;
    const newLastName  = last_name  ? last_name.trim()  : cur.last_name;
    const newRole      = (isAdmin && role) ? role : cur.role;
    const newIsActive  = (isAdmin && is_active !== undefined) ? is_active : cur.is_active;

    const result = await pool.query(
      `UPDATE users
       SET first_name = $1, last_name = $2, phone_number = $3, role = $4, is_active = $5
       WHERE id = $6
       RETURNING id, email, first_name, last_name, phone_number, role, is_active, created_at, updated_at`,
      [newFirstName, newLastName, newPhone, newRole, newIsActive, userId]
    );

    await logActivity({
      type:         'user',
      action:       `User "${result.rows[0].first_name} ${result.rows[0].last_name}" updated`,
      entity_type:  'user',
      entity_id:    String(userId),
      performed_by: req.user.id,
    });

    return res.status(200).json({
      success: true,
      message: 'User updated successfully.',
      data: result.rows[0],
    });

  } catch (error) {
    console.error('Update user error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// DELETE /api/users/:id  (admin only — soft delete)
// ────────────────────────────────────────────────────────────
const deleteUser = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) {
      return sendError(res, 400, ERROR_CODES.INVALID_USER_ID,
        'Invalid user ID. Please provide a valid numeric ID.',
        { field: 'id' });
    }

    if (req.user.id === userId) {
      return sendError(res, 400, ERROR_CODES.CANNOT_DELETE_SELF,
        'You cannot deactivate your own account.');
    }

    const existCheck = await pool.query('SELECT id, is_active FROM users WHERE id = $1', [userId]);
    if (existCheck.rows.length === 0) return Errors.userNotFound(res);

    if (!existCheck.rows[0].is_active) {
      return sendError(res, 400, ERROR_CODES.USER_ALREADY_INACTIVE,
        'This user is already deactivated.');
    }

    const result = await pool.query(
      'UPDATE users SET is_active = FALSE WHERE id = $1 RETURNING id, email, first_name, last_name, role',
      [userId]
    );

    await logActivity({
      type:         'user',
      action:       `User "${result.rows[0].first_name} ${result.rows[0].last_name}" deactivated`,
      entity_type:  'user',
      entity_id:    String(userId),
      performed_by: req.user.id,
    });

    return res.status(200).json({
      success: true,
      message: `User "${result.rows[0].first_name} ${result.rows[0].last_name}" has been deactivated successfully.`,
      data: result.rows[0],
    });

  } catch (error) {
    console.error('Delete user error:', error);
    return Errors.internalError(res);
  }
};

module.exports = { getUsers, updateUser, deleteUser };