// ============================================================
// src/controllers/attendanceController.js
// Module: Attendance — RazorpayX People API
// ============================================================

const pool          = require('../config/db');
const { sendError } = require('../utils/AppError');
const ERROR_CODES   = require('../utils/errorCodes');

const RPX_API_ID     = process.env.RAZORPAYX_API_ID;
const RPX_API_KEY    = process.env.RAZORPAYX_API_KEY;
const RPX_PEOPLE_URL = 'https://payroll.razorpay.com/api/people';

// ─── Helper: POST to RazorpayX /api/people ───────────────────
async function razorpayxPeoplePost(type, subType, data = {}) {
  const payload = {
    auth:    { id: parseInt(RPX_API_ID, 10) || RPX_API_ID, key: RPX_API_KEY },
    request: { type, 'sub-type': subType },
    data,
  };

  console.log(`[RazorpayX People] → type: ${type} | sub-type: ${subType}`);
  console.log(`[RazorpayX People] → API_ID: "${RPX_API_ID}" | KEY: "${RPX_API_KEY ? RPX_API_KEY.slice(0, 8) + '...' : 'MISSING'}"`);

  const resp = await fetch(RPX_PEOPLE_URL, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-id':     RPX_API_ID,
      'x-api-key':    RPX_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const text = await resp.text();

  if (text.trim().startsWith('<')) {
    console.error('[RazorpayX People] Received HTML — check API credentials and endpoint');
    throw new Error('RazorpayX returned HTML. Verify RAZORPAYX_API_ID and RAZORPAYX_API_KEY in .env');
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error('[RazorpayX People] Non-JSON response:', text.slice(0, 200));
    throw new Error('RazorpayX returned unexpected response format');
  }

  if (!resp.ok) {
    console.error('[RazorpayX People] Error response:', json);
    throw new Error(json.message || json.error || `RazorpayX error (HTTP ${resp.status})`);
  }

  return json;
}

// RazorpayX returns dates as "DD/MM/YYYY" — convert to "YYYY-MM-DD" for Postgres
function parseDDMMYYYY(str) {
  if (!str) return null;
  const parts = str.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// ────────────────────────────────────────────────────────────
// GET /api/attendance/people/view/:employee_id
// Live fetch from RazorpayX — does NOT touch the DB
// Query param: employee_type (default: "employee")
// ────────────────────────────────────────────────────────────
const viewEmployeeFromPeople = async (req, res) => {
  try {
    const { employee_id } = req.params;
    const { employee_type = 'employee' } = req.query;

    const empId = parseInt(employee_id, 10);
    if (!empId) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'employee_id must be a numeric RazorpayX employee ID.');
    }

    console.log(`[Attendance] Fetching people/view for employee-id: ${empId}`);

    const data = await razorpayxPeoplePost('people', 'view', {
      'employee-id':   empId,
      'employee-type': employee_type,
    });

    return res.status(200).json({
      success:  true,
      employee: data,
    });

  } catch (error) {
    console.error('[Attendance] viewEmployeeFromPeople error:', error.message);
    return sendError(res, 502, 'RAZORPAYX_ERROR', error.message);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/attendance/people
// Store employee from request body into DB.
// Body: { employee_id, employee: { name, email, ... } }
// Rejects if another record already uses the same email or phone_number.
// ────────────────────────────────────────────────────────────
const storeEmployee = async (req, res) => {
  try {
    const { employee_id, employee: emp } = req.body;

    if (!employee_id || !emp) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'employee_id and employee object are required.');
    }

    const email       = emp.email        ?? null;
    const phoneNumber = emp.phone_number ?? null;

    // Duplicate check — reject if same email OR phone_number belongs to a different record
    if (email || phoneNumber) {
      const conditions = [];
      const dupValues  = [];

      if (email) {
        dupValues.push(email);
        conditions.push(`email = $${dupValues.length}`);
      }
      if (phoneNumber) {
        dupValues.push(phoneNumber);
        conditions.push(`phone_number = $${dupValues.length}`);
      }

      dupValues.push(String(employee_id));
      const dupCheck = await pool.query(
        `SELECT employee_id, name, email, phone_number
         FROM razorpayx_employees
         WHERE (${conditions.join(' OR ')})
           AND employee_id != $${dupValues.length}`,
        dupValues
      );

      if (dupCheck.rows.length > 0) {
        const conflict = dupCheck.rows[0];
        return sendError(res, 409, 'DUPLICATE_EMPLOYEE',
          `An employee with the same ${conflict.email === email ? 'email' : 'phone number'} already exists (employee_id: ${conflict.employee_id}, name: ${conflict.name}).`);
      }
    }

    const result = await pool.query(
      `INSERT INTO razorpayx_employees
         (employee_id, name, email, phone_number,
          date_of_birth, date_of_hiring,
          title, department,
          manager_employee_id, manager_email,
          pan, bank_ifsc, bank_account_number,
          is_active, raw_data, last_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
       ON CONFLICT (employee_id) DO UPDATE SET
         name                = EXCLUDED.name,
         email               = EXCLUDED.email,
         phone_number        = EXCLUDED.phone_number,
         date_of_birth       = EXCLUDED.date_of_birth,
         date_of_hiring      = EXCLUDED.date_of_hiring,
         title               = EXCLUDED.title,
         department          = EXCLUDED.department,
         manager_employee_id = EXCLUDED.manager_employee_id,
         manager_email       = EXCLUDED.manager_email,
         pan                 = EXCLUDED.pan,
         bank_ifsc           = EXCLUDED.bank_ifsc,
         bank_account_number = EXCLUDED.bank_account_number,
         is_active           = EXCLUDED.is_active,
         raw_data            = EXCLUDED.raw_data,
         last_synced_at      = NOW(),
         updated_at          = NOW()
       RETURNING *`,
      [
        String(employee_id),
        emp.name                               ?? null,
        email,
        phoneNumber,
        parseDDMMYYYY(emp['date-of-birth']),
        parseDDMMYYYY(emp['date-of-hiring']),
        emp.title                              ?? null,
        emp.department                         ?? null,
        emp['manager-employee-id'] ? String(emp['manager-employee-id']) : null,
        emp['manager-email']                   ?? null,
        emp.pan                                ?? null,
        emp['bank-ifsc']                       ?? null,
        emp['bank-account-number']             ?? null,
        emp.is_active !== undefined ? emp.is_active : true,
        JSON.stringify(emp),
      ]
    );

    console.log(`[Attendance] Stored employee ${employee_id} (${emp.name})`);

    return res.status(200).json({
      success:  true,
      message:  'Employee stored in database.',
      employee: result.rows[0],
    });

  } catch (error) {
    console.error('[Attendance] storeEmployee error:', error.message);
    return sendError(res, 500, 'DB_ERROR', error.message);
  }
};

// ────────────────────────────────────────────────────────────
// PUT /api/attendance/people/:employee_id
// Call RazorpayX people/edit and update local DB record.
// Body: any subset of editable fields in RazorpayX format.
// ────────────────────────────────────────────────────────────
const editEmployee = async (req, res) => {
  try {
    const { employee_id } = req.params;

    const empId = parseInt(employee_id, 10);
    if (!empId) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'employee_id must be a numeric RazorpayX employee ID.');
    }

    const body = req.body;

    // Build RazorpayX data payload — only include fields the caller provided
    const rpxData = { 'employee-id': empId };
    const fieldMap = [
      'email', 'title', 'department', 'pan', 'state',
      'manager-employee-id', 'manager-employee-type',
      'bank-ifsc', 'bank-account-number',
      'phone-number', 'hiring-date', 'pt-enabled',
      'pastSalary', 'pastExemption', 'pastTds',
      'previousEmployerSalary', 'previousEmployerTds',
    ];
    for (const field of fieldMap) {
      if (body[field] !== undefined) rpxData[field] = body[field];
    }

    console.log(`[Attendance] Calling RazorpayX people/edit for employee-id: ${empId}`);

    const rpxResponse = await razorpayxPeoplePost('people', 'edit', rpxData);

    // Update local DB with only the fields that were sent
    const setClauses = [];
    const dbValues   = [];

    const dbFieldMap = {
      'email':               'email',
      'title':               'title',
      'department':          'department',
      'pan':                 'pan',
      'manager-employee-id': 'manager_employee_id',
      'bank-ifsc':           'bank_ifsc',
      'bank-account-number': 'bank_account_number',
      'phone-number':        'phone_number',
      'hiring-date':         'date_of_hiring',
    };

    for (const [rpxField, dbCol] of Object.entries(dbFieldMap)) {
      if (body[rpxField] !== undefined) {
        const val = rpxField === 'manager-employee-id'
          ? String(body[rpxField])
          : body[rpxField];
        dbValues.push(val);
        setClauses.push(`${dbCol} = $${dbValues.length}`);
      }
    }

    let updatedEmployee = null;
    if (setClauses.length > 0) {
      dbValues.push(String(empId));
      const result = await pool.query(
        `UPDATE razorpayx_employees
         SET ${setClauses.join(', ')}, updated_at = NOW()
         WHERE employee_id = $${dbValues.length}
         RETURNING *`,
        dbValues
      );
      updatedEmployee = result.rows[0] ?? null;
    }

    console.log(`[Attendance] Edited employee ${empId} in RazorpayX and local DB`);

    return res.status(200).json({
      success:            true,
      message:            'Employee updated in RazorpayX and local DB.',
      razorpayx_response: rpxResponse,
      employee:           updatedEmployee,
    });

  } catch (error) {
    console.error('[Attendance] editEmployee error:', error.message);
    return sendError(res, 502, 'RAZORPAYX_ERROR', error.message);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/attendance/people/:employee_id/salary
// Call RazorpayX people/set-salary and store values in local DB
// Body: { "annual-ctc": 600000, "custom-salary-structure": false }
// ────────────────────────────────────────────────────────────
const setEmployeeSalary = async (req, res) => {
  try {
    const { employee_id } = req.params;

    const empId = parseInt(employee_id, 10);
    if (!empId) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'employee_id must be a numeric RazorpayX employee ID.');
    }

    const annualCtc    = req.body['annual-ctc'];
    const customSalary = req.body['custom-salary-structure'] ?? false;

    if (annualCtc === undefined || annualCtc === null) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        '"annual-ctc" is required in the request body.');
    }

    console.log(`[Attendance] Calling RazorpayX people/set-salary for employee-id: ${empId}`);

    const rpxResponse = await razorpayxPeoplePost('people', 'set-salary', {
      'employee-id':             empId,
      'custom-salary-structure': customSalary,
      'annual-ctc':              annualCtc,
    });

    // Mirror salary values into local DB
    const result = await pool.query(
      `UPDATE razorpayx_employees
       SET annual_ctc              = $1,
           custom_salary_structure = $2,
           updated_at              = NOW()
       WHERE employee_id = $3
       RETURNING *`,
      [annualCtc, customSalary, String(empId)]
    );

    console.log(`[Attendance] Salary set for employee ${empId} — annual CTC: ${annualCtc}`);

    return res.status(200).json({
      success:            true,
      message:            'Salary set in RazorpayX and updated in local DB.',
      razorpayx_response: rpxResponse,
      employee:           result.rows[0] ?? null,
    });

  } catch (error) {
    console.error('[Attendance] setEmployeeSalary error:', error.message);
    return sendError(res, 502, 'RAZORPAYX_ERROR', error.message);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/attendance/people
// List all stored employees from local DB
// ────────────────────────────────────────────────────────────
const getAllStoredEmployees = async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, employee_id, name, email, phone_number,
              date_of_birth, date_of_hiring,
              title, department,
              manager_employee_id, manager_email,
              pan, bank_ifsc, bank_account_number,
              annual_ctc, custom_salary_structure,
              is_active, user_id, technician_id,
              last_synced_at, created_at, updated_at
       FROM razorpayx_employees
       ORDER BY name`
    );

    return res.status(200).json({
      success:   true,
      total:     result.rows.length,
      employees: result.rows,
    });

  } catch (error) {
    console.error('[Attendance] getAllStoredEmployees error:', error.message);
    return sendError(res, 500, 'DB_ERROR', error.message);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/attendance/people/:employee_id
// Read stored employee data from local DB
// ────────────────────────────────────────────────────────────
const getStoredEmployee = async (req, res) => {
  try {
    const { employee_id } = req.params;

    const result = await pool.query(
      `SELECT id, employee_id, name, email, phone_number,
              date_of_birth, date_of_hiring,
              title, department,
              manager_employee_id, manager_email,
              pan, bank_ifsc, bank_account_number,
              is_active, user_id, technician_id,
              last_synced_at, created_at, updated_at
       FROM razorpayx_employees
       WHERE employee_id = $1`,
      [String(employee_id)]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'EMPLOYEE_NOT_FOUND',
        `Employee "${employee_id}" not found. Use POST /api/attendance/people to store first.`);
    }

    return res.status(200).json({
      success:  true,
      employee: result.rows[0],
    });

  } catch (error) {
    console.error('[Attendance] getStoredEmployee error:', error.message);
    return sendError(res, 500, 'DB_ERROR', error.message);
  }
};

module.exports = {
  viewEmployeeFromPeople,
  storeEmployee,
  editEmployee,
  setEmployeeSalary,
  getAllStoredEmployees,
  getStoredEmployee,
};
