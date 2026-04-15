// ============================================================
// src/utils/validators.js
// Reusable input validators
// ============================================================

const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(String(email).toLowerCase());
};

const isValidPhone = (phone) => {
  // Accepts formats: +911234567890 / 9876543210 / +1-800-555-0199
  const phoneRegex = /^\+?[\d\s\-()]{7,15}$/;
  return phoneRegex.test(phone);
};

const isValidRole = (role) => {
  return ['admin', 'engineer', 'labour', 'manager'].includes(role);
};

module.exports = { isValidEmail, isValidPhone, isValidRole };
