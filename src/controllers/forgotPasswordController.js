const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const pool    = require('../config/db');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');
const { isValidEmail } = require('../utils/validators');

const generateResetToken = () => crypto.randomBytes(32).toString('hex');

// ────────────────────────────────────────────────────────────
// POST /api/auth/forgot-password
// ────────────────────────────────────────────────────────────
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'Email address is required.', { field: 'email' });
    }

    if (!isValidEmail(email)) {
      return sendError(res, 400, ERROR_CODES.INVALID_EMAIL_FORMAT,
        'Please enter a valid email address.', { field: 'email' });
    }

    const result = await pool.query(
      'SELECT id, email, first_name FROM users WHERE email = $1 AND is_active = TRUE',
      [email.toLowerCase()]
    );

    // Always return same message to prevent email enumeration
    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'If that email is registered, you will receive a password reset link shortly.',
      });
    }

    const user = result.rows[0];

    // Invalidate any old tokens
    await pool.query(
      'UPDATE password_reset_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE',
      [user.id]
    );

    const resetToken = generateResetToken();
    const expiresAt  = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, resetToken, expiresAt]
    );

    // In production: send email with reset link
    // e.g. await sendResetEmail(user.email, resetToken)
    console.log(`🔑 [DEV] Reset token for ${user.email}: ${resetToken}`);

    return res.status(200).json({
      success: true,
      message: 'If that email is registered, you will receive a password reset link shortly.',
      // ⚠️ REMOVE dev_only_reset_token in production
      dev_only_reset_token: resetToken,
      expires_in: '15 minutes',
      expires_at: expiresAt,
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/auth/reset-password
// ────────────────────────────────────────────────────────────
const resetPassword = async (req, res) => {
  try {
    const { token, new_password, confirm_password } = req.body;

    // Missing fields
    const missing = [];
    if (!token)            missing.push('token');
    if (!new_password)     missing.push('new_password');
    if (!confirm_password) missing.push('confirm_password');
    if (missing.length > 0) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        `Please provide all required fields: ${missing.join(', ')}.`,
        { missing_fields: missing });
    }

    // Password length
    if (new_password.length < 6) {
      return sendError(res, 400, ERROR_CODES.PASSWORD_TOO_SHORT,
        'New password must be at least 6 characters long.',
        { field: 'new_password', min_length: 6 });
    }

    // Passwords match
    if (new_password !== confirm_password) {
      return sendError(res, 400, ERROR_CODES.PASSWORDS_DO_NOT_MATCH,
        'Passwords do not match. Please make sure both passwords are the same.',
        { fields: ['new_password', 'confirm_password'] });
    }

    // Validate token
    const tokenResult = await pool.query(
      `SELECT prt.id, prt.user_id, prt.expires_at, prt.used
       FROM password_reset_tokens prt
       WHERE prt.token = $1`,
      [token]
    );

    if (tokenResult.rows.length === 0) {
      return sendError(res, 400, ERROR_CODES.RESET_TOKEN_INVALID,
        'This password reset link is invalid. Please request a new one.');
    }

    const tokenRow = tokenResult.rows[0];

    if (tokenRow.used) {
      return sendError(res, 400, ERROR_CODES.RESET_TOKEN_INVALID,
        'This password reset link has already been used. Please request a new one.');
    }

    if (new Date(tokenRow.expires_at) < new Date()) {
      return sendError(res, 400, ERROR_CODES.RESET_TOKEN_EXPIRED,
        'This password reset link has expired (valid for 15 minutes). Please request a new one.');
    }

    // Update password + mark token used in a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const hashedPassword = await bcrypt.hash(new_password, 12);
      await client.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, tokenRow.user_id]);
      await client.query('UPDATE password_reset_tokens SET used = TRUE WHERE token = $1', [token]);
      await client.query('COMMIT');
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully! You can now log in with your new password.',
    });

  } catch (error) {
    console.error('Reset password error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/auth/change-password  (authenticated)
// ────────────────────────────────────────────────────────────
const changePassword = async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;

    // Missing fields
    const missing = [];
    if (!current_password) missing.push('current_password');
    if (!new_password)     missing.push('new_password');
    if (!confirm_password) missing.push('confirm_password');
    if (missing.length > 0) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        `Please provide all required fields: ${missing.join(', ')}.`,
        { missing_fields: missing });
    }

    if (new_password.length < 6) {
      return sendError(res, 400, ERROR_CODES.PASSWORD_TOO_SHORT,
        'New password must be at least 6 characters long.',
        { field: 'new_password', min_length: 6 });
    }

    if (new_password !== confirm_password) {
      return sendError(res, 400, ERROR_CODES.PASSWORDS_DO_NOT_MATCH,
        'New passwords do not match. Please make sure both passwords are the same.',
        { fields: ['new_password', 'confirm_password'] });
    }

    if (current_password === new_password) {
      return sendError(res, 400, ERROR_CODES.SAME_PASSWORD,
        'New password must be different from your current password.');
    }

    const result = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
    const isMatch = await bcrypt.compare(current_password, result.rows[0].password);

    if (!isMatch) {
      return sendError(res, 401, ERROR_CODES.CURRENT_PASSWORD_WRONG,
        'Current password is incorrect. Please try again.',
        { field: 'current_password' });
    }

    const hashedPassword = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, req.user.id]);

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully!',
    });

  } catch (error) {
    console.error('Change password error:', error);
    return Errors.internalError(res);
  }
};

module.exports = { forgotPassword, resetPassword, changePassword };