// ============================================================
// src/controllers/clientController.js
// ============================================================

const pool = require('../config/db');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');
const {
  isValidEmail,
  isValidPhone,
  isValidClientType,
  isValidClientStatus,
} = require('../utils/validators');

// ────────────────────────────────────────────────────────────
// GET /api/clients
// ────────────────────────────────────────────────────────────
const getClients = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const { type, status, search } = req.query;

    if (type && !isValidClientType(type)) {
      return sendError(res, 400, ERROR_CODES.INVALID_CLIENT_TYPE,
        'Invalid client type. Allowed: Corporate, Residential, Commercial, Healthcare, Government.',
        { field: 'type', allowed: ['Corporate', 'Residential', 'Commercial', 'Healthcare', 'Government'] });
    }

    if (status && !isValidClientStatus(status)) {
      return sendError(res, 400, ERROR_CODES.INVALID_CLIENT_STATUS,
        'Invalid status. Allowed: Active, Inactive.',
        { field: 'status', allowed: ['Active', 'Inactive'] });
    }

    const conditions = [];
    const values     = [];

    if (type) {
      values.push(type);
      conditions.push(`type = $${values.length}`);
    }

    if (status) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }

    if (search) {
      values.push(`%${search.toLowerCase()}%`);
      const idx = values.length;
      conditions.push(
        `(LOWER(name) LIKE $${idx} OR LOWER(contact_person) LIKE $${idx})`
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM clients ${where}`, values
    );
    const total = parseInt(countResult.rows[0].count);

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT id, name, contact_person, email, phone, gst_no, address, type, status,
              contract_value, join_date, created_at, updated_at
       FROM clients ${where}
       ORDER BY created_at DESC
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
    console.error('Get clients error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/clients
// ────────────────────────────────────────────────────────────
const createClient = async (req, res) => {
  try {
    const {
      name,
      contact_person,
      email,
      phone,
      gst_no,
      address,
      type = 'Corporate',
      status = 'Active',
      contract_value = 0,
    } = req.body;

    const missing = [];
    if (!name)           missing.push('name');
    if (!contact_person) missing.push('contact_person');
    if (missing.length > 0) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        `Please fill in all required fields: ${missing.join(', ')}.`,
        { missing_fields: missing });
    }

    if (email && !isValidEmail(email)) {
      return sendError(res, 400, ERROR_CODES.INVALID_EMAIL_FORMAT,
        'Please enter a valid email address.', { field: 'email' });
    }

    if (phone && !isValidPhone(phone)) {
      return sendError(res, 400, ERROR_CODES.INVALID_PHONE_FORMAT,
        'Please enter a valid phone number.', { field: 'phone' });
    }

    if (!isValidClientType(type)) {
      return sendError(res, 400, ERROR_CODES.INVALID_CLIENT_TYPE,
        'Invalid client type. Allowed: Corporate, Residential, Commercial, Healthcare, Government.',
        { field: 'type' });
    }

    if (!isValidClientStatus(status)) {
      return sendError(res, 400, ERROR_CODES.INVALID_CLIENT_STATUS,
        'Invalid status. Allowed: Active, Inactive.', { field: 'status' });
    }

    const result = await pool.query(
      `INSERT INTO clients
         (name, contact_person, email, phone, gst_no, address, type, status, contract_value, join_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE)
       RETURNING id, name, contact_person, email, phone, gst_no, address, type, status,
                 contract_value, join_date, created_at, updated_at`,
      [
        name.trim(),
        contact_person.trim(),
        email ? email.toLowerCase() : null,
        phone  || null,
        gst_no || null,
        address || null,
        type,
        status,
        parseFloat(contract_value) || 0,
      ]
    );

    return res.status(201).json({
      success: true,
      message: `Client "${name}" added successfully.`,
      data: result.rows[0],
    });

  } catch (error) {
    console.error('Create client error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/clients/:id
// ────────────────────────────────────────────────────────────
const getClientById = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Invalid client ID.', { field: 'id' });
    }

    const result = await pool.query(
      `SELECT id, name, contact_person, email, phone, gst_no, address, type, status,
              contract_value, join_date, created_at, updated_at
       FROM clients WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return Errors.clientNotFound(res);

    const client = result.rows[0];

    // Attach stats
    const statsResult = await pool.query(
      `SELECT
         COUNT(*)                                         AS total_jobs,
         COUNT(*) FILTER (WHERE status != 'Closed')      AS open_jobs,
         (SELECT COUNT(*) FROM amc_contracts
          WHERE client_id = $1 AND status = 'Active')    AS active_amc_count
       FROM jobs
       WHERE client_id = $1`,
      [id]
    );

    client.stats = {
      total_jobs:       parseInt(statsResult.rows[0].total_jobs),
      open_jobs:        parseInt(statsResult.rows[0].open_jobs),
      active_amc_count: parseInt(statsResult.rows[0].active_amc_count),
    };

    return res.status(200).json({ success: true, data: client });

  } catch (error) {
    console.error('Get client by ID error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// PUT /api/clients/:id
// ────────────────────────────────────────────────────────────
const updateClient = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Invalid client ID.', { field: 'id' });
    }

    const existCheck = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.clientNotFound(res);

    const cur = existCheck.rows[0];
    const { name, contact_person, email, phone, gst_no, address, type, status, contract_value } = req.body;

    if (!name && !contact_person && email === undefined && phone === undefined &&
        gst_no === undefined && address === undefined && !type && !status && contract_value === undefined) {
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

    if (type && !isValidClientType(type)) {
      return sendError(res, 400, ERROR_CODES.INVALID_CLIENT_TYPE,
        'Invalid client type.', { field: 'type' });
    }

    if (status && !isValidClientStatus(status)) {
      return sendError(res, 400, ERROR_CODES.INVALID_CLIENT_STATUS,
        'Invalid status.', { field: 'status' });
    }

    const newName           = name           ? name.trim()           : cur.name;
    const newContactPerson  = contact_person ? contact_person.trim() : cur.contact_person;
    const newEmail          = email          ? email.toLowerCase()   : cur.email;
    const newPhone          = phone          !== undefined ? phone     : cur.phone;
    const newGstNo          = gst_no         !== undefined ? gst_no    : cur.gst_no;
    const newAddress        = address        !== undefined ? address   : cur.address;
    const newType           = type           || cur.type;
    const newStatus         = status         || cur.status;
    const newContractValue  = contract_value !== undefined
      ? parseFloat(contract_value)
      : cur.contract_value;

    const result = await pool.query(
      `UPDATE clients
       SET name=$1, contact_person=$2, email=$3, phone=$4, gst_no=$5, address=$6,
           type=$7, status=$8, contract_value=$9
       WHERE id=$10
       RETURNING id, name, contact_person, email, phone, gst_no, address, type, status,
                 contract_value, join_date, created_at, updated_at`,
      [newName, newContactPerson, newEmail, newPhone, newGstNo, newAddress,
       newType, newStatus, newContractValue, id]
    );

    return res.status(200).json({
      success: true,
      message: 'Client updated successfully.',
      data: result.rows[0],
    });

  } catch (error) {
    console.error('Update client error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// DELETE /api/clients/:id
// ────────────────────────────────────────────────────────────
const deleteClient = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Invalid client ID.', { field: 'id' });
    }

    const existCheck = await pool.query('SELECT name FROM clients WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.clientNotFound(res);

    // Check for open jobs
    const openJobs = await pool.query(
      `SELECT id FROM jobs WHERE client_id = $1 AND status != 'Closed'`,
      [id]
    );
    if (openJobs.rows.length > 0) {
      return sendError(res, 409, ERROR_CODES.CLIENT_HAS_OPEN_JOBS,
        'Cannot delete client. They have open jobs that must be closed first.',
        { open_job_ids: openJobs.rows.map(r => r.id) });
    }

    // Check for active AMC contracts
    const activeAmc = await pool.query(
      `SELECT id FROM amc_contracts WHERE client_id = $1 AND status = 'Active'`,
      [id]
    );
    if (activeAmc.rows.length > 0) {
      return sendError(res, 409, ERROR_CODES.CLIENT_HAS_ACTIVE_AMC,
        'Cannot delete client. They have active AMC contracts.',
        { active_amc_ids: activeAmc.rows.map(r => r.id) });
    }

    await pool.query('DELETE FROM clients WHERE id = $1', [id]);

    return res.status(200).json({
      success: true,
      message: `Client "${existCheck.rows[0].name}" deleted successfully.`,
    });

  } catch (error) {
    console.error('Delete client error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/clients/from-erp
// Mirror an ERP customer into the local clients table and return
// its local id (so it can be used as amc_contracts.client_id).
//
// Body: the ERP customer object, e.g.
//   {
//     "CustId": 90, "CustCode": "B59",
//     "CustName": "Deccan fine chemicals India Pvt Ltd",
//     "CustAdd": "Kesavaram(Village),", "CustAdd1": null, "CustAdd2": null,
//     "ContactNo": "+91-4067111102",
//     "EmailId": "mohanchand@deccanchemicals.com",
//     "PinCode": "531127", "StateCode": "37 ANDHRA PRADESH"
//   }
//
// Behaviour:
//   - If a local mirror of this CustId already exists -> refresh it and
//     return it (linked: "existing").
//   - Otherwise create a new local client (linked: "created").
// ────────────────────────────────────────────────────────────
const linkErpClient = async (req, res) => {
  try {
    const b = req.body || {};

    const custId = b.CustId ?? b.custId ?? b.cust_id;
    if (custId === undefined || custId === null || custId === '') {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'CustId is required to link an ERP customer.', { field: 'CustId' });
    }

    const name = (b.CustName ?? b.custName ?? '').toString().trim();
    if (!name) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'CustName is required to link an ERP customer.', { field: 'CustName' });
    }

    // Build a single address from the ERP address parts (skip nulls/blanks)
    const address = [b.CustAdd, b.CustAdd1, b.CustAdd2, b.PinCode, b.StateCode]
      .map((p) => (p === null || p === undefined ? '' : String(p).trim()))
      .filter(Boolean)
      .join(', ') || null;

    const email   = b.EmailId ? String(b.EmailId).toLowerCase().trim() : null;
    const phone   = b.ContactNo ? String(b.ContactNo).trim() : null;
    const custCode = b.CustCode ? String(b.CustCode).trim() : null;
    // ERP has no separate contact-person field; fall back to the company name
    const contactPerson = name;

    // Already mirrored?
    const existing = await pool.query(
      'SELECT id FROM clients WHERE erp_customer_id = $1',
      [custId]
    );

    if (existing.rows.length > 0) {
      const updated = await pool.query(
        `UPDATE clients
            SET name = $1, contact_person = $2, email = $3, phone = $4,
                address = $5, erp_cust_code = $6, origin = 'erp'
          WHERE erp_customer_id = $7
        RETURNING id, name, contact_person, email, phone, gst_no, address, type, status,
                  contract_value, join_date, origin, erp_customer_id, erp_cust_code,
                  created_at, updated_at`,
        [name, contactPerson, email, phone, address, custCode, custId]
      );

      return res.status(200).json({
        success: true,
        linked:  'existing',
        message: `ERP customer "${name}" is already linked. Use this client id for the AMC.`,
        data:    updated.rows[0],
      });
    }

    // Create a new local mirror
    const created = await pool.query(
      `INSERT INTO clients
         (name, contact_person, email, phone, gst_no, address, type, status,
          contract_value, join_date, origin, erp_customer_id, erp_cust_code)
       VALUES ($1, $2, $3, $4, NULL, $5, 'Corporate', 'Active',
               0, CURRENT_DATE, 'erp', $6, $7)
       RETURNING id, name, contact_person, email, phone, gst_no, address, type, status,
                 contract_value, join_date, origin, erp_customer_id, erp_cust_code,
                 created_at, updated_at`,
      [name, contactPerson, email, phone, address, custId, custCode]
    );

    return res.status(201).json({
      success: true,
      linked:  'created',
      message: `ERP customer "${name}" linked. Use this client id for the AMC.`,
      data:    created.rows[0],
    });

  } catch (error) {
    console.error('Link ERP client error:', error);
    return Errors.internalError(res);
  }
};

module.exports = {
  getClients,
  createClient,
  getClientById,
  updateClient,
  deleteClient,
  linkErpClient,
};