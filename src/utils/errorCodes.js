// ============================================================
// src/utils/errorCodes.js
// All standardized error codes used across the API
// Frontend can use `error_code` to show the right message/UI
// ============================================================

const ERROR_CODES = {

  // ─── Validation ────────────────────────────────────────────
  VALIDATION_ERROR:          'VALIDATION_ERROR',
  MISSING_REQUIRED_FIELDS:   'MISSING_REQUIRED_FIELDS',
  INVALID_EMAIL_FORMAT:      'INVALID_EMAIL_FORMAT',
  INVALID_PHONE_FORMAT:      'INVALID_PHONE_FORMAT',
  PASSWORD_TOO_SHORT:        'PASSWORD_TOO_SHORT',
  PASSWORDS_DO_NOT_MATCH:    'PASSWORDS_DO_NOT_MATCH',
  INVALID_ROLE:              'INVALID_ROLE',
  INVALID_USER_ID:           'INVALID_USER_ID',
  NO_FIELDS_TO_UPDATE:       'NO_FIELDS_TO_UPDATE',

  // ─── Auth ───────────────────────────────────────────────────
  EMAIL_ALREADY_EXISTS:      'EMAIL_ALREADY_EXISTS',
  PHONE_ALREADY_EXISTS:      'PHONE_ALREADY_EXISTS',
  PHONE_ALREADY_IN_USE:      'PHONE_ALREADY_IN_USE',
  INVALID_CREDENTIALS:       'INVALID_CREDENTIALS',
  ACCOUNT_INACTIVE:          'ACCOUNT_INACTIVE',
  TOKEN_MISSING:             'TOKEN_MISSING',
  TOKEN_INVALID:             'TOKEN_INVALID',
  TOKEN_EXPIRED:             'TOKEN_EXPIRED',

  // ─── Password ───────────────────────────────────────────────
  RESET_TOKEN_INVALID:       'RESET_TOKEN_INVALID',
  RESET_TOKEN_EXPIRED:       'RESET_TOKEN_EXPIRED',
  CURRENT_PASSWORD_WRONG:    'CURRENT_PASSWORD_WRONG',
  SAME_PASSWORD:             'SAME_PASSWORD',

  // ─── User ───────────────────────────────────────────────────
  USER_NOT_FOUND:            'USER_NOT_FOUND',
  USER_ALREADY_INACTIVE:     'USER_ALREADY_INACTIVE',
  CANNOT_DELETE_SELF:        'CANNOT_DELETE_SELF',

  // ─── Access ─────────────────────────────────────────────────
  UNAUTHORIZED:              'UNAUTHORIZED',
  FORBIDDEN:                 'FORBIDDEN',

  // ─── Server ─────────────────────────────────────────────────
  INTERNAL_SERVER_ERROR:     'INTERNAL_SERVER_ERROR',
};

module.exports = ERROR_CODES;
