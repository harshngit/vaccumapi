// ============================================================
// src/utils/AppError.js
// ============================================================

const ERROR_CODES = require('./errorCodes');

class AppError extends Error {
  constructor(statusCode, errorCode, message, details = null) {
    super(message);
    this.statusCode    = statusCode;
    this.errorCode     = errorCode;
    this.message       = message;
    this.details       = details;
    this.isOperational = true;
  }
}

const sendError = (res, statusCode, errorCode, message, details = null) => {
  const body = { success: false, error_code: errorCode, message };
  if (details) body.details = details;
  return res.status(statusCode).json(body);
};

const Errors = {
  // Auth
  emailExists:       (res) => sendError(res, 409, ERROR_CODES.EMAIL_ALREADY_EXISTS,
    'This email is already registered. Please log in instead.'),
  phoneExists:       (res) => sendError(res, 409, ERROR_CODES.PHONE_ALREADY_EXISTS,
    'This phone number is already registered. Please log in instead.'),
  invalidCredentials:(res) => sendError(res, 401, ERROR_CODES.INVALID_CREDENTIALS,
    'Incorrect email/phone or password. Please try again.'),
  tokenMissing:      (res) => sendError(res, 401, ERROR_CODES.TOKEN_MISSING,
    'Access denied. No token provided. Please log in.'),
  tokenInvalid:      (res) => sendError(res, 401, ERROR_CODES.TOKEN_INVALID,
    'Your session is invalid. Please log in again.'),
  tokenExpired:      (res) => sendError(res, 401, ERROR_CODES.TOKEN_EXPIRED,
    'Your session has expired. Please log in again.'),
  forbidden:         (res, roles = null) => sendError(res, 403, ERROR_CODES.FORBIDDEN,
    roles
      ? `Access denied. This action requires one of these roles: ${roles.join(', ')}.`
      : 'Access denied. You do not have permission to perform this action.'),

  // Records
  userNotFound:       (res) => sendError(res, 404, ERROR_CODES.USER_NOT_FOUND,       'User not found.'),
  technicianNotFound: (res) => sendError(res, 404, ERROR_CODES.TECHNICIAN_NOT_FOUND, 'Technician not found.'),
  clientNotFound:     (res) => sendError(res, 404, ERROR_CODES.CLIENT_NOT_FOUND,     'Client not found.'),
  jobNotFound:        (res) => sendError(res, 404, ERROR_CODES.JOB_NOT_FOUND,        'Job not found.'),
  reportNotFound:     (res) => sendError(res, 404, ERROR_CODES.REPORT_NOT_FOUND,     'Report not found.'),

  internalError: (res) => sendError(res, 500, ERROR_CODES.INTERNAL_SERVER_ERROR,
    'Something went wrong on our end. Please try again later.'),
};

module.exports = { AppError, sendError, Errors };