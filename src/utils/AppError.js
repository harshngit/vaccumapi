// ============================================================
// src/utils/AppError.js
// Custom error class + sendError helper
// ============================================================

const ERROR_CODES = require('./errorCodes');

// ─── Custom Error Class ──────────────────────────────────────
class AppError extends Error {
  constructor(statusCode, errorCode, message, details = null) {
    super(message);
    this.statusCode  = statusCode;
    this.errorCode   = errorCode;
    this.message     = message;
    this.details     = details;   // optional field-level errors for forms
    this.isOperational = true;
  }
}

// ─── Standard Error Response ─────────────────────────────────
// Every error response across the whole API uses this shape:
// {
//   success: false,
//   error_code: "EMAIL_ALREADY_EXISTS",   ← frontend uses this
//   message: "This email is already registered. Try logging in instead.",
//   details: { field: "email", ... }      ← optional, for form validation
// }
const sendError = (res, statusCode, errorCode, message, details = null) => {
  const body = {
    success: false,
    error_code: errorCode,
    message,
  };
  if (details) body.details = details;
  return res.status(statusCode).json(body);
};

// ─── Pre-built common errors ─────────────────────────────────
const Errors = {
  // Validation
  missingFields: (fields) =>
    sendError.bind(null, null, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
      `Missing required fields: ${fields.join(', ')}`),

  // Auth
  emailExists: (res) =>
    sendError(res, 409, ERROR_CODES.EMAIL_ALREADY_EXISTS,
      'This email is already registered. Please log in instead.'),

  phoneExists: (res) =>
    sendError(res, 409, ERROR_CODES.PHONE_ALREADY_EXISTS,
      'This phone number is already registered. Please log in instead.'),

  invalidCredentials: (res) =>
    sendError(res, 401, ERROR_CODES.INVALID_CREDENTIALS,
      'Incorrect email/phone or password. Please try again.'),

  tokenMissing: (res) =>
    sendError(res, 401, ERROR_CODES.TOKEN_MISSING,
      'Access denied. No token provided. Please log in.'),

  tokenInvalid: (res) =>
    sendError(res, 401, ERROR_CODES.TOKEN_INVALID,
      'Your session is invalid. Please log in again.'),

  tokenExpired: (res) =>
    sendError(res, 401, ERROR_CODES.TOKEN_EXPIRED,
      'Your session has expired. Please log in again.'),

  forbidden: (res, roles = null) =>
    sendError(res, 403, ERROR_CODES.FORBIDDEN,
      roles
        ? `Access denied. This action requires one of these roles: ${roles.join(', ')}.`
        : 'Access denied. You do not have permission to perform this action.'),

  // User
  userNotFound: (res) =>
    sendError(res, 404, ERROR_CODES.USER_NOT_FOUND,
      'User not found.'),

  internalError: (res) =>
    sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR,
      'Something went wrong on our end. Please try again later.'),
};

module.exports = { AppError, sendError, Errors };
