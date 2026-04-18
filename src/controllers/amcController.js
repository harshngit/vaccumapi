// ============================================================
// src/controllers/amcController.js
// ============================================================

const pool = require('../config/db');
const { sendError, Errors } = require('../utils/AppError');
const { notify } = require('./notificationController');
const wsManager  = require('../config/websocketManager');
const ERROR_CODES = require('../utils/errorCodes');

// ─── Helper: compute AMC status from dates ───────────────────
const computeAmcStatus = (endDate, reminderDays) => {
  const today      = new Date();
  today.setHours(0, 0, 0, 0);
  const end        = new Date(endDate);
  const reminderMs = reminderDays * 24 * 60 * 60 * 1000;
  if (end < today)                          return 'Expired';
  if (end - today <= reminderMs)            return 'Expiring Soon';
  return 'Active';
};

// ─── Helper: generate next AMC ID ────────────────────────────
const generateAmcId = async (client) => {
  const result = await client.query(
    `SELECT id FROM amc_contracts ORDER BY id DESC LIMIT 1`
  );
  if (result.rows.length === 0) return 'AMC-0001';
  const lastNum = parseInt(result.rows[0].id.replace('AMC-', ''), 10);
  return `AMC-${String(lastNum + 1).padStart(4, '0')}`;
};

// ────────────────────────────────────────────────────────────
// GET /api/amc
// ────────────────────────────────────────────────────────────
const getAmcContracts = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const { status, client_id } = req.query;

    const conditions = [];
    const values     = [];

    if (status) {
      values.push(status);
      conditions.push(`a.status = $${values.length}`);
    }
    if (client_id) {
      values.push(parseInt(client_id));
      conditions.push(`a.client_id = $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM amc_contracts a ${where}`, values
    );
    const total = parseInt(countResult.rows[0].count);

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT
         a.id, a.client_id, c.name AS client_name,
         a.title, a.start_date, a.end_date, a.value,
         a.status, a.next_service_date, a.renewal_reminder_days,
         (a.end_date - CURRENT_DATE) AS days_left,
         a.created_by_user_id, a.created_at, a.updated_at
       FROM amc_contracts a
       LEFT JOIN clients c ON c.id = a.client_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    // Attach services array to each contract
    const contracts = result.rows;
    for (const contract of contracts) {
      const svc = await pool.query(
        'SELECT service_name FROM amc_services WHERE amc_id = $1 ORDER BY id',
        [contract.id]
      );
      contract.services = svc.rows.map(r => r.service_name);
    }

    return res.status(200).json({
      success: true,
      data: contracts,
      pagination: { total, page, limit, total_pages: Math.ceil(total / limit) },
    });

  } catch (error) {
    console.error('Get AMC contracts error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/amc
// ────────────────────────────────────────────────────────────
const createAmcContract = async (req, res) => {
  const dbClient = await pool.connect();
  try {
    const {
      client_id, title, start_date, end_date, value,
      next_service_date, renewal_reminder_days = 30,
      services = [],
    } = req.body;

    const missing = [];
    if (!client_id)  missing.push('client_id');
    if (!title)      missing.push('title');
    if (!start_date) missing.push('start_date');
    if (!end_date)   missing.push('end_date');
    if (!value)      missing.push('value');
    if (missing.length > 0) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        `Please fill in all required fields: ${missing.join(', ')}.`,
        { missing_fields: missing });
    }

    if (new Date(end_date) <= new Date(start_date)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'end_date must be after start_date.');
    }

    if (renewal_reminder_days < 1 || renewal_reminder_days > 365) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'renewal_reminder_days must be between 1 and 365.');
    }

    // Validate client exists
    const clientCheck = await dbClient.query('SELECT id, name FROM clients WHERE id = $1', [client_id]);
    if (clientCheck.rows.length === 0) return Errors.clientNotFound(res);

    await dbClient.query('BEGIN');

    const amcId = await generateAmcId(dbClient);
    const status = computeAmcStatus(end_date, renewal_reminder_days);

    const result = await dbClient.query(
      `INSERT INTO amc_contracts
         (id, client_id, title, start_date, end_date, value, status,
          next_service_date, renewal_reminder_days, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        amcId, client_id, title.trim(), start_date, end_date,
        parseFloat(value), status,
        next_service_date || null, renewal_reminder_days, req.user.id,
      ]
    );

    const contract = result.rows[0];

    // Insert services
    if (services.length > 0) {
      for (const svc of services) {
        await dbClient.query(
          'INSERT INTO amc_services (amc_id, service_name) VALUES ($1, $2)',
          [amcId, svc.trim()]
        );
      }
    }

    await dbClient.query('COMMIT');

    contract.services    = services;
    contract.client_name = clientCheck.rows[0].name;
    contract.days_left   = Math.ceil((new Date(end_date) - new Date()) / (1000 * 60 * 60 * 24));

    // ── Fire real-time notification: amc_created ──────────
    await notify({
      event:       'amc_created',
      title:       'New AMC Contract Created',
      message:     `${amcId} — ${title.trim()} for ${contract.client_name}`,
      entity_type: 'amc',
      entity_id:   amcId,
      roles:       ['admin', 'manager'],
    }, wsManager);

    return res.status(201).json({
      success: true,
      message: `AMC contract ${amcId} created for ${contract.client_name}.`,
      data: contract,
    });

  } catch (error) {
    await dbClient.query('ROLLBACK');
    console.error('Create AMC error:', error);
    return Errors.internalError(res);
  } finally {
    dbClient.release();
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/amc/expiring
// Used by cron/scheduled job — returns contracts whose
// renewal reminder should fire today
// ────────────────────────────────────────────────────────────
const getExpiringContracts = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         a.id, a.client_id, c.name AS client_name,
         c.email AS client_email, c.contact_person,
         a.title, a.end_date, a.renewal_reminder_days,
         (a.end_date - CURRENT_DATE) AS days_left
       FROM amc_contracts a
       LEFT JOIN clients c ON c.id = a.client_id
       WHERE (a.end_date - a.renewal_reminder_days) <= CURRENT_DATE
         AND a.end_date >= CURRENT_DATE
       ORDER BY a.end_date ASC`
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });

  } catch (error) {
    console.error('Get expiring AMC error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/amc/:id
// ────────────────────────────────────────────────────────────
const getAmcById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT
         a.id, a.client_id, c.name AS client_name,
         a.title, a.start_date, a.end_date, a.value,
         a.status, a.next_service_date, a.renewal_reminder_days,
         (a.end_date - CURRENT_DATE) AS days_left,
         a.created_by_user_id, a.created_at, a.updated_at
       FROM amc_contracts a
       LEFT JOIN clients c ON c.id = a.client_id
       WHERE a.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, ERROR_CODES.CLIENT_NOT_FOUND,
        'AMC contract not found.');
    }

    const contract = result.rows[0];
    const svc = await pool.query(
      'SELECT service_name FROM amc_services WHERE amc_id = $1 ORDER BY id', [id]
    );
    contract.services = svc.rows.map(r => r.service_name);

    return res.status(200).json({ success: true, data: contract });

  } catch (error) {
    console.error('Get AMC by ID error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// PUT /api/amc/:id
// ────────────────────────────────────────────────────────────
const updateAmcContract = async (req, res) => {
  const dbClient = await pool.connect();
  try {
    const { id } = req.params;

    const existCheck = await dbClient.query('SELECT * FROM amc_contracts WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) {
      return sendError(res, 404, ERROR_CODES.CLIENT_NOT_FOUND, 'AMC contract not found.');
    }

    const cur = existCheck.rows[0];
    const {
      title, end_date, value,
      next_service_date, renewal_reminder_days,
      services,
    } = req.body;

    const newTitle             = title               ? title.trim()              : cur.title;
    const newEndDate           = end_date            || cur.end_date;
    const newValue             = value               !== undefined ? parseFloat(value) : cur.value;
    const newNextServiceDate   = next_service_date   !== undefined ? next_service_date : cur.next_service_date;
    const newReminderDays      = renewal_reminder_days !== undefined ? renewal_reminder_days : cur.renewal_reminder_days;

    if (newReminderDays < 1 || newReminderDays > 365) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'renewal_reminder_days must be between 1 and 365.');
    }

    const newStatus = computeAmcStatus(newEndDate, newReminderDays);

    await dbClient.query('BEGIN');

    const result = await dbClient.query(
      `UPDATE amc_contracts
       SET title=$1, end_date=$2, value=$3, status=$4,
           next_service_date=$5, renewal_reminder_days=$6
       WHERE id=$7
       RETURNING *`,
      [newTitle, newEndDate, newValue, newStatus,
       newNextServiceDate, newReminderDays, id]
    );

    // Replace services if provided
    if (Array.isArray(services)) {
      await dbClient.query('DELETE FROM amc_services WHERE amc_id = $1', [id]);
      for (const svc of services) {
        await dbClient.query(
          'INSERT INTO amc_services (amc_id, service_name) VALUES ($1, $2)',
          [id, svc.trim()]
        );
      }
    }

    await dbClient.query('COMMIT');

    const updated = result.rows[0];
    const svc = await pool.query(
      'SELECT service_name FROM amc_services WHERE amc_id = $1 ORDER BY id', [id]
    );
    updated.services = svc.rows.map(r => r.service_name);

    return res.status(200).json({
      success: true,
      message: 'AMC contract updated successfully.',
      data: updated,
    });

  } catch (error) {
    await dbClient.query('ROLLBACK');
    console.error('Update AMC error:', error);
    return Errors.internalError(res);
  } finally {
    dbClient.release();
  }
};

// ────────────────────────────────────────────────────────────
// DELETE /api/amc/:id  — admin only
// ────────────────────────────────────────────────────────────
const deleteAmcContract = async (req, res) => {
  try {
    const { id } = req.params;

    const existCheck = await pool.query('SELECT id, title FROM amc_contracts WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) {
      return sendError(res, 404, ERROR_CODES.CLIENT_NOT_FOUND, 'AMC contract not found.');
    }

    // amc_services will cascade delete automatically
    await pool.query('DELETE FROM amc_contracts WHERE id = $1', [id]);

    return res.status(200).json({
      success: true,
      message: `AMC contract "${existCheck.rows[0].title}" deleted successfully.`,
    });

  } catch (error) {
    console.error('Delete AMC error:', error);
    return Errors.internalError(res);
  }
};

module.exports = {
  getAmcContracts,
  createAmcContract,
  getExpiringContracts,
  getAmcById,
  updateAmcContract,
  deleteAmcContract,
};