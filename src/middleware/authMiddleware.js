const jwt   = require('jsonwebtoken');
const pool  = require('../config/db');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');

// ─── Protect: verify JWT ─────────────────────────────────────
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return Errors.tokenMissing(res);
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return Errors.tokenExpired(res);
      }
      return Errors.tokenInvalid(res);
    }

    const result = await pool.query(
      'SELECT id, role, is_active FROM users WHERE id = $1',
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return Errors.tokenInvalid(res);
    }

    if (!result.rows[0].is_active) {
      return sendError(res, 403, ERROR_CODES.ACCOUNT_INACTIVE,
        'Your account has been deactivated. Please contact your administrator.');
    }

    req.user = result.rows[0];
    next();

  } catch (error) {
    console.error('Auth middleware error:', error);
    return Errors.internalError(res);
  }
};

// ─── Authorize: role-based access ────────────────────────────
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return Errors.forbidden(res, roles);
    }
    next();
  };
};

module.exports = { protect, authorize };