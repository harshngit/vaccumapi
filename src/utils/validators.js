// ============================================================
// src/utils/validators.js
// Reusable input validators
// ============================================================

const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(String(email).toLowerCase());
};

const isValidPhone = (phone) => {
  const phoneRegex = /^\+?[\d\s\-()]{7,15}$/;
  return phoneRegex.test(phone);
};

const isValidRole = (role) => {
  return ['admin', 'engineer', 'labour', 'manager', 'technician'].includes(role);
};

const isValidTechnicianStatus = (status) => {
  return ['Active', 'On Leave', 'Inactive'].includes(status);
};

const isValidClientType = (type) => {
  return ['Corporate', 'Residential', 'Commercial', 'Healthcare', 'Government'].includes(type);
};

const isValidClientStatus = (status) => {
  return ['Active', 'Inactive'].includes(status);
};

const isValidJobStatus = (status) => {
  return ['Raised', 'Assigned', 'In Progress', 'Closed'].includes(status);
};

const isValidJobPriority = (priority) => {
  return ['Low', 'Medium', 'High', 'Critical'].includes(priority);
};

const isValidJobCategory = (category) => {
  return ['Maintenance', 'Repair', 'Installation', 'Inspection'].includes(category);
};

const isValidReportStatus = (status) => {
  return ['Approved', 'Rejected'].includes(status);
};

// Valid forward-only status transitions for jobs
const JOB_STATUS_TRANSITIONS = {
  'Raised':      'Assigned',
  'Assigned':    'In Progress',
  'In Progress': 'Closed',
};

const isValidStatusTransition = (from, to) => {
  return JOB_STATUS_TRANSITIONS[from] === to;
};

// Compute avatar from name: first letters of first two words, uppercase
const computeAvatar = (name) => {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
};

module.exports = {
  isValidEmail,
  isValidPhone,
  isValidRole,
  isValidTechnicianStatus,
  isValidClientType,
  isValidClientStatus,
  isValidJobStatus,
  isValidJobPriority,
  isValidJobCategory,
  isValidReportStatus,
  isValidStatusTransition,
  JOB_STATUS_TRANSITIONS,
  computeAvatar,
};