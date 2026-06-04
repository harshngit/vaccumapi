// ============================================================
// src/controllers/attendanceController.js
// Module: Attendance — RazorpayX Payroll Integration
//
// RazorpayX Payroll API facts (from official docs):
//   - Single endpoint: POST https://payroll.razorpay.com/api/payroll
//   - Auth goes in BOTH headers AND request body
//   - Body structure: { auth: {id, key}, request: {type, sub-type}, data: {...} }
//   - NO bulk employee fetch — must loop per employee ID
// ============================================================

const pool        = require('../config/db');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');

const RPX_API_ID  = process.env.RAZORPAYX_API_ID;
const RPX_API_KEY = process.env.RAZORPAYX_API_KEY;
const RPX_URL     = 'https://payroll.razorpay.com/api/payroll';

// ─── Helper: single RazorpayX POST ───────────────────────────
async function razorpayxPost(type, subType, data = {}) {
  const payload = {
    auth:    { id: RPX_API_ID, key: RPX_API_KEY },
    request: { type, 'sub-type': subType },
    data,
  };

  console.log(`[RazorpayX] → type: ${type} | sub-type: ${subType}`);
  console.log(`[RazorpayX] → API_ID: "${RPX_API_ID}" | KEY: "${RPX_API_KEY ? RPX_API_KEY.slice(0, 8) + '...' : 'MISSING'}"`);

  const resp = await fetch(RPX_URL, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-id':     RPX_API_ID,
      'x-api-key':    RPX_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const text = await resp.text();

  // Guard: if HTML comes back the URL/creds are wrong
  if (text.trim().startsWith('<')) {
    console.error('[RazorpayX] Received HTML — check API credentials and endpoint');
    throw new Error('RazorpayX returned HTML. Verify RAZORPAYX_API_ID and RAZORPAYX_API_KEY in .env');
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error('[RazorpayX] Non-JSON response:', text.slice(0, 200));
    throw new Error('RazorpayX returned unexpected response format');
  }

  if (!resp.ok) {
    console.error('[RazorpayX] Error response:', json);
    throw new Error(json.message || json.error || `RazorpayX error (HTTP ${resp.status})`);
  }

  return json;
}

// ────────────────────────────────────────────────────────────
// GET /api/attendance/employees/sync
//
// RazorpayX has NO bulk employee list endpoint.
// We sync from our local technicians + users tables and
// map them to RazorpayX employee IDs which the admin provides.
//
// Flow:
//   1. Pull all technicians from local DB
//   2. Upsert them into razorpayx_employees
//   3. Admin then sets razorpayx_employee_id via PATCH /api/attendance/employees/:id
// ────────────────────────────────────────────────────────────
const syncEmployees = async (req, res) => {
  try {
    console.log('[Attendance] Syncing employee list from local DB (technicians + users)...');

    // Pull all technicians
    const techResult = await pool.query(
      `SELECT t.id, t.user_id, t.name, t.email, t.phone, t.specialization, t.status
       FROM technicians t
       ORDER BY t.name`
    );

    // Pull all non-technician users (admins, managers, engineers, labour, etc.)
    const userResult = await pool.query(
      `SELECT u.id, u.first_name || ' ' || u.last_name AS name, u.email, u.phone_number, u.role
       FROM users u
       WHERE u.is_active = TRUE
         AND u.role != 'technician'
       ORDER BY u.first_name`
    );

    let synced = 0;

    for (const tech of techResult.rows) {
      await pool.query(
        `INSERT INTO razorpayx_employees
           (employee_id, name, email, user_id, technician_id, raw_data, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (employee_id) DO UPDATE SET
           name           = EXCLUDED.name,
           email          = EXCLUDED.email,
           user_id        = EXCLUDED.user_id,
           technician_id  = EXCLUDED.technician_id,
           raw_data       = EXCLUDED.raw_data,
           last_synced_at = NOW()`,
        [
          `TECH-${tech.id}`,
          tech.name,
          tech.email || null,
          tech.user_id || null,
          tech.id,
          JSON.stringify(tech),
        ]
      );
      synced++;
    }

    for (const user of userResult.rows) {
      await pool.query(
        `INSERT INTO razorpayx_employees
           (employee_id, name, email, user_id, technician_id, raw_data, last_synced_at)
         VALUES ($1, $2, $3, $4, NULL, $5, NOW())
         ON CONFLICT (employee_id) DO UPDATE SET
           name           = EXCLUDED.name,
           email          = EXCLUDED.email,
           user_id        = EXCLUDED.user_id,
           raw_data       = EXCLUDED.raw_data,
           last_synced_at = NOW()`,
        [
          `USER-${user.id}`,
          user.name,
          user.email || null,
          user.id,
          JSON.stringify(user),
        ]
      );
      synced++;
    }

    console.log(`[Attendance] Employee sync complete. Synced: ${synced} (technicians + users)`);
    console.log('[Attendance] ⚠️  Set RazorpayX Employee IDs via PATCH /api/attendance/employees/:id');

    return res.status(200).json({
      success: true,
      message: `Synced ${synced} employees from local DB (technicians + users). Use PATCH /api/attendance/employees/:id to set each employee's RazorpayX employee_id (found in RazorpayX → My Profile).`,
      total:   synced,
    });

  } catch (error) {
    console.error('[Attendance] syncEmployees error:', error.message);
    return sendError(res, 500, 'SYNC_ERROR', error.message);
  }
};

// ────────────────────────────────────────────────────────────
// PATCH /api/attendance/employees/:id
// Set the RazorpayX employee_id for a cached employee
// Body: { razorpayx_employee_id: "123" }
// ────────────────────────────────────────────────────────────
const setEmployeeRazorpayId = async (req, res) => {
  try {
    const { id } = req.params;
    const { razorpayx_employee_id } = req.body;

    if (!razorpayx_employee_id) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'razorpayx_employee_id is required.');
    }

    // Check it's not already taken
    const existing = await pool.query(
      'SELECT id FROM razorpayx_employees WHERE employee_id = $1 AND id != $2',
      [String(razorpayx_employee_id), id]
    );
    if (existing.rows.length > 0) {
      return sendError(res, 409, 'DUPLICATE_EMPLOYEE_ID',
        `RazorpayX employee ID "${razorpayx_employee_id}" is already assigned to another employee.`);
    }

    const result = await pool.query(
      `UPDATE razorpayx_employees
       SET employee_id = $1, last_synced_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [String(razorpayx_employee_id), id]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
    }

    console.log(`[Attendance] Set RazorpayX ID "${razorpayx_employee_id}" for employee row ${id}`);

    return res.status(200).json({
      success:  true,
      message:  'RazorpayX employee ID updated.',
      employee: result.rows[0],
    });

  } catch (error) {
    console.error('[Attendance] setEmployeeRazorpayId error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/attendance/sync
// Pull attendance from RazorpayX for each mapped employee
// Body: { from_date: "YYYY-MM", to_date: "YYYY-MM" }
// RazorpayX uses payroll-month format: "YYYY-MM"
// ────────────────────────────────────────────────────────────
const syncAttendance = async (req, res) => {
  try {
    const { payroll_month } = req.body;   // e.g. "2025-06"

    if (!payroll_month) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'payroll_month is required (format: YYYY-MM e.g. "2025-06").',
        { missing_fields: ['payroll_month'] });
    }

    if (!/^\d{4}-\d{2}$/.test(payroll_month)) {
      return sendError(res, 400, 'INVALID_DATE_FORMAT',
        'payroll_month must be in YYYY-MM format (e.g. "2025-06").');
    }

    // Only sync employees that have a real RazorpayX ID (numeric / non-TECH- prefix)
    const empResult = await pool.query(
      `SELECT id, employee_id, name, user_id, technician_id
       FROM razorpayx_employees
       WHERE is_active = TRUE
         AND employee_id NOT LIKE 'TECH-%'`
    );

    if (empResult.rows.length === 0) {
      return sendError(res, 400, 'NO_RPX_EMPLOYEES',
        'No employees have a RazorpayX ID set yet. Use PATCH /api/attendance/employees/:id to assign them first.');
    }

    console.log(`[Attendance] Syncing payroll for ${empResult.rows.length} employees — month: ${payroll_month}`);

    let totalSynced = 0;
    const errors    = [];

    for (const emp of empResult.rows) {
      try {
        const data = await razorpayxPost('payroll', 'view-payroll', {
          'employee-id':   parseInt(emp.employee_id, 10) || emp.employee_id,
          'payroll-month': payroll_month,
        });

        // Extract attendance from payroll response
        const payrollData  = data?.data || data;
        const attendance   = payrollData?.attendance || payrollData?.attendance_details || [];
        const payrollInfo  = payrollData?.payroll || payrollData;

        // If direct attendance array exists, upsert each day
        if (Array.isArray(attendance) && attendance.length > 0) {
          for (const record of attendance) {
            const date      = record.date || record.attendance_date;
            const checkIn   = record.check_in  || record.in_time  || null;
            const checkOut  = record.check_out || record.out_time || null;
            const status    = mapStatus(record.status || record.attendance_status || 'present');
            const workHours = calculateWorkHours(checkIn, checkOut);

            await pool.query(
              `INSERT INTO attendance
                 (employee_id, user_id, technician_id, name, date,
                  check_in, check_out, status, working_hours, source, razorpayx_raw, synced_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'razorpayx',$10,NOW())
               ON CONFLICT (employee_id, date) DO UPDATE SET
                 check_in      = EXCLUDED.check_in,
                 check_out     = EXCLUDED.check_out,
                 status        = EXCLUDED.status,
                 working_hours = EXCLUDED.working_hours,
                 razorpayx_raw = EXCLUDED.razorpayx_raw,
                 synced_at     = NOW(),
                 updated_at    = NOW()`,
              [emp.employee_id, emp.user_id, emp.technician_id, emp.name,
               date, checkIn, checkOut, status, workHours, JSON.stringify(record)]
            );
            totalSynced++;
          }
        } else {
          // No daily breakdown — store payroll summary as single record
          const workingDays = payrollInfo?.working_days || payrollInfo?.days_present || null;
          await pool.query(
            `INSERT INTO attendance
               (employee_id, user_id, technician_id, name, date,
                status, working_hours, source, razorpayx_raw, synced_at)
             VALUES ($1,$2,$3,$4,$5,'present',$6,'razorpayx',$7,NOW())
             ON CONFLICT (employee_id, date) DO UPDATE SET
               working_hours = EXCLUDED.working_hours,
               razorpayx_raw = EXCLUDED.razorpayx_raw,
               synced_at     = NOW(),
               updated_at    = NOW()`,
            [
              emp.employee_id, emp.user_id, emp.technician_id, emp.name,
              `${payroll_month}-01`,
              workingDays,
              JSON.stringify(payrollData),
            ]
          );
          totalSynced++;
        }

        console.log(`[Attendance] ✅ ${emp.name} (${emp.employee_id}) — synced`);

      } catch (empError) {
        console.error(`[Attendance] ❌ ${emp.name} (${emp.employee_id}): ${empError.message}`);
        errors.push({ employee_id: emp.employee_id, name: emp.name, error: empError.message });
      }
    }

    console.log(`[Attendance] Sync done. Records: ${totalSynced}, Errors: ${errors.length}`);

    return res.status(200).json({
      success:        true,
      message:        'Attendance sync complete.',
      records_synced: totalSynced,
      errors_count:   errors.length,
      errors:         errors.length > 0 ? errors : undefined,
    });

  } catch (error) {
    console.error('[Attendance] syncAttendance error:', error.message);
    return sendError(res, 502, 'RAZORPAYX_ERROR', error.message);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/attendance
// ────────────────────────────────────────────────────────────
const getAttendance = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const { from_date, to_date, employee_id, status } = req.query;

    const conditions = [];
    const values     = [];

    if (from_date) { values.push(from_date); conditions.push(`a.date >= $${values.length}`); }
    if (to_date)   { values.push(to_date);   conditions.push(`a.date <= $${values.length}`); }
    if (employee_id) { values.push(employee_id); conditions.push(`a.employee_id = $${values.length}`); }
    if (status)    { values.push(status);    conditions.push(`a.status = $${values.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await pool.query(`SELECT COUNT(*) FROM attendance a ${where}`, values);
    const total    = parseInt(countRes.rows[0].count);

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT a.id, a.employee_id, a.name, a.date,
              a.check_in, a.check_out, a.status, a.working_hours,
              a.source, a.synced_at,
              u.first_name || ' ' || u.last_name AS user_name,
              t.specialization
       FROM attendance a
       LEFT JOIN users u       ON u.id = a.user_id
       LEFT JOIN technicians t ON t.id = a.technician_id
       ${where}
       ORDER BY a.date DESC, a.name
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return res.status(200).json({
      success:     true,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
      attendance:  result.rows,
    });

  } catch (error) {
    console.error('[Attendance] getAttendance error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/attendance/summary
// ────────────────────────────────────────────────────────────
const getAttendanceSummary = async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const conditions = [];
    const values     = [];

    if (from_date) { values.push(from_date); conditions.push(`date >= $${values.length}`); }
    if (to_date)   { values.push(to_date);   conditions.push(`date <= $${values.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT employee_id, name,
              COUNT(*)                                          AS total_days,
              COUNT(*) FILTER (WHERE status = 'present')       AS present,
              COUNT(*) FILTER (WHERE status = 'absent')        AS absent,
              COUNT(*) FILTER (WHERE status = 'half_day')      AS half_day,
              COUNT(*) FILTER (WHERE status = 'on_leave')      AS on_leave,
              COUNT(*) FILTER (WHERE status = 'holiday')       AS holidays,
              ROUND(AVG(working_hours)::NUMERIC, 2)            AS avg_hours,
              ROUND(SUM(working_hours)::NUMERIC, 2)            AS total_hours
       FROM attendance ${where}
       GROUP BY employee_id, name
       ORDER BY name`,
      values
    );

    return res.status(200).json({
      success:   true,
      from_date: from_date || null,
      to_date:   to_date   || null,
      summary:   result.rows,
    });

  } catch (error) {
    console.error('[Attendance] getAttendanceSummary error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/attendance/employees/list
// ────────────────────────────────────────────────────────────
const getEmployeeList = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, employee_id, name, email, user_id, technician_id, is_active, last_synced_at,
              CASE WHEN employee_id LIKE 'TECH-%' THEN false ELSE true END AS razorpayx_id_set
       FROM razorpayx_employees
       ORDER BY name`
    );

    return res.status(200).json({
      success:   true,
      total:     result.rows.length,
      employees: result.rows,
    });

  } catch (error) {
    console.error('[Attendance] getEmployeeList error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/attendance/mark  (manual)
// ────────────────────────────────────────────────────────────
const markAttendance = async (req, res) => {
  try {
    const { employee_id, date, check_in, check_out, status } = req.body;

    if (!employee_id || !date || !status) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'employee_id, date, and status are required.',
        { missing_fields: ['employee_id', 'date', 'status'] });
    }

    const empRes  = await pool.query(
      'SELECT name, user_id, technician_id FROM razorpayx_employees WHERE employee_id = $1',
      [employee_id]
    );
    const emp       = empRes.rows[0] || {};
    const workHours = calculateWorkHours(check_in, check_out);

    const result = await pool.query(
      `INSERT INTO attendance
         (employee_id, user_id, technician_id, name, date,
          check_in, check_out, status, working_hours, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual')
       ON CONFLICT (employee_id, date) DO UPDATE SET
         check_in      = EXCLUDED.check_in,
         check_out     = EXCLUDED.check_out,
         status        = EXCLUDED.status,
         working_hours = EXCLUDED.working_hours,
         source        = 'manual',
         updated_at    = NOW()
       RETURNING *`,
      [employee_id, emp.user_id || null, emp.technician_id || null,
       emp.name || null, date, check_in || null, check_out || null,
       mapStatus(status), workHours]
    );

    return res.status(200).json({
      success:    true,
      message:    'Attendance marked successfully.',
      attendance: result.rows[0],
    });

  } catch (error) {
    console.error('[Attendance] markAttendance error:', error);
    return Errors.internalError(res);
  }
};

// ─── Helpers ─────────────────────────────────────────────────
function mapStatus(raw = '') {
  const s = String(raw).toLowerCase().trim();
  if (['present', 'p'].includes(s))                         return 'present';
  if (['absent', 'a'].includes(s))                          return 'absent';
  if (['half_day', 'halfday', 'half day', 'h'].includes(s)) return 'half_day';
  if (['leave', 'on_leave', 'on leave', 'l'].includes(s))   return 'on_leave';
  if (['holiday', 'public_holiday'].includes(s))             return 'holiday';
  return 'present';
}

function calculateWorkHours(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  try {
    const diff = new Date(checkOut) - new Date(checkIn);
    return diff > 0 ? parseFloat((diff / 3600000).toFixed(2)) : 0;
  } catch { return 0; }
}

// ────────────────────────────────────────────────────────────
// GET /api/attendance/employees/fetch-from-razorpayx
// Fetch employee list directly from RazorpayX.
// Requires payroll_month (YYYY-MM) — RazorpayX always needs it.
// Query param: payroll_month e.g. 2025-06
// ────────────────────────────────────────────────────────────
const fetchEmployeesFromRazorpayX = async (req, res) => {
  try {
    const { payroll_month } = req.query;

    if (!payroll_month) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'payroll_month is required (format: YYYY-MM e.g. "2025-06").');
    }

    if (!/^\d{4}-\d{2}$/.test(payroll_month)) {
      return sendError(res, 400, 'INVALID_DATE_FORMAT',
        'payroll_month must be in YYYY-MM format.');
    }

    console.log(`[Attendance] Fetching employee list from RazorpayX for month: ${payroll_month}`);

    // RazorpayX has no dedicated employee-list endpoint.
    // Fetching all payroll records for the month returns every employee.
    const data = await razorpayxPost('payroll', 'list-payroll', {
      'payroll-month': payroll_month,
    });

    console.log('[Attendance] RazorpayX raw response:', JSON.stringify(data).slice(0, 500));

    // Normalise — the list may be nested differently
    const raw       = data?.data ?? data;
    const employees = raw?.employees
                   ?? raw?.payrolls
                   ?? raw?.payroll_list
                   ?? raw?.data
                   ?? (Array.isArray(raw) ? raw : null);

    // If we couldn't find an array, return the raw response so the caller
    // can inspect the actual structure and we can adjust field names.
    if (!Array.isArray(employees)) {
      return res.status(200).json({
        success:      false,
        message:      'Received a response from RazorpayX but could not find employee array. See raw_response to inspect the structure.',
        raw_response: data,
      });
    }

    if (employees.length === 0) {
      return res.status(200).json({
        success:      true,
        message:      'RazorpayX returned 0 employees for this month.',
        total:        0,
        raw_response: data,
      });
    }

    let synced = 0;
    const saved = [];

    for (const emp of employees) {
      // Cover all known RazorpayX field name variants
      const empId = String(
        emp.id ?? emp.employee_id ?? emp.employeeId
        ?? emp['employee-id'] ?? emp.emp_id ?? ''
      );
      const name  = emp.name
                 ?? emp.employee_name
                 ?? (`${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || null);
      const email = emp.email ?? emp.work_email ?? emp.employee_email ?? null;

      if (!empId) continue;

      await pool.query(
        `INSERT INTO razorpayx_employees
           (employee_id, name, email, raw_data, last_synced_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (employee_id) DO UPDATE SET
           name           = EXCLUDED.name,
           email          = EXCLUDED.email,
           raw_data       = EXCLUDED.raw_data,
           last_synced_at = NOW()`,
        [empId, name, email, JSON.stringify(emp)]
      );

      saved.push({ employee_id: empId, name, email });
      synced++;
    }

    console.log(`[Attendance] Fetched & cached ${synced} employees from RazorpayX`);

    return res.status(200).json({
      success:   true,
      message:   `${synced} employees fetched from RazorpayX and cached locally.`,
      total:     synced,
      employees: saved,
    });

  } catch (error) {
    console.error('[Attendance] fetchEmployeesFromRazorpayX error:', error.message);
    return sendError(res, 502, 'RAZORPAYX_ERROR', error.message);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/attendance/employees/with-summary
// All employees from razorpayx_employees joined with their
// attendance summary for an optional date range.
// Query params: from_date, to_date, payroll_month (YYYY-MM)
// ────────────────────────────────────────────────────────────
const getEmployeesWithAttendanceSummary = async (req, res) => {
  try {
    let { from_date, to_date, payroll_month } = req.query;

    // Support payroll_month shorthand: "2025-06" → first/last of month
    if (payroll_month && /^\d{4}-\d{2}$/.test(payroll_month)) {
      const [yr, mo] = payroll_month.split('-').map(Number);
      const last = new Date(yr, mo, 0).getDate();
      from_date = `${payroll_month}-01`;
      to_date   = `${payroll_month}-${String(last).padStart(2, '0')}`;
    }

    const dateConditions = [];
    const dateValues     = [];

    if (from_date) { dateValues.push(from_date); dateConditions.push(`a.date >= $${dateValues.length}`); }
    if (to_date)   { dateValues.push(to_date);   dateConditions.push(`a.date <= $${dateValues.length}`); }

    const whereDate = dateConditions.length ? `AND ${dateConditions.join(' AND ')}` : '';

    // All employees from cache with their attendance aggregated
    const result = await pool.query(
      `SELECT
         e.id,
         e.employee_id,
         e.name,
         e.email,
         e.is_active,
         CASE WHEN e.employee_id LIKE 'TECH-%' OR e.employee_id LIKE 'USER-%'
              THEN false ELSE true END                         AS razorpayx_id_set,
         COUNT(a.id)                                          AS total_days,
         COUNT(a.id) FILTER (WHERE a.status = 'present')     AS present,
         COUNT(a.id) FILTER (WHERE a.status = 'absent')      AS absent,
         COUNT(a.id) FILTER (WHERE a.status = 'half_day')    AS half_day,
         COUNT(a.id) FILTER (WHERE a.status = 'on_leave')    AS on_leave,
         COUNT(a.id) FILTER (WHERE a.status = 'holiday')     AS holidays,
         ROUND(COALESCE(SUM(a.working_hours), 0)::NUMERIC, 2) AS total_hours,
         ROUND(COALESCE(AVG(a.working_hours), 0)::NUMERIC, 2) AS avg_hours,
         MAX(a.date)                                          AS last_attendance_date
       FROM razorpayx_employees e
       LEFT JOIN attendance a
         ON a.employee_id = e.employee_id
         ${whereDate}
       GROUP BY e.id, e.employee_id, e.name, e.email, e.is_active
       ORDER BY e.name`,
      dateValues
    );

    return res.status(200).json({
      success:     true,
      total:       result.rows.length,
      from_date:   from_date || null,
      to_date:     to_date   || null,
      employees:   result.rows,
    });

  } catch (error) {
    console.error('[Attendance] getEmployeesWithAttendanceSummary error:', error);
    return Errors.internalError(res);
  }
};

module.exports = {
  syncEmployees,
  fetchEmployeesFromRazorpayX,
  setEmployeeRazorpayId,
  syncAttendance,
  getAttendance,
  getAttendanceSummary,
  getEmployeesWithAttendanceSummary,
  getEmployeeList,
  markAttendance,
};