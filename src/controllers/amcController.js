// ============================================================
// src/controllers/amcController.js
// ============================================================

const pool    = require('../config/db');
const ExcelJS = require('exceljs');
const { sendError, Errors } = require('../utils/AppError');
const { notify } = require('./notificationController');
const wsManager  = require('../config/websocketManager');
const { logActivity } = require('./activityController');
const ERROR_CODES = require('../utils/errorCodes');
const { sendWhatsAppTemplateMessage, formatWhatsAppNumber } = require('./whatsappController');
const { sendNotification } = require('./emailController');
const { isValidEmail } = require('../utils/validators');

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

// ─── Helper: format date nicely ──────────────────────────────
const formatDate = (d) => d
  ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  : '—';

// ─── Helper: the 6 individual service date fields ────────────
const SERVICE_DATE_FIELDS = [
  'service_date_1', 'service_date_2', 'service_date_3',
  'service_date_4', 'service_date_5', 'service_date_6',
];

// ─── Helper: validate service_date_1..6 against visit_count ──
// If visit_count is N, service_date_1 through service_date_N must all be present.
const validateServiceDates = (visitCount, serviceDates) => {
  if (!visitCount) return null;
  if (visitCount > SERVICE_DATE_FIELDS.length) {
    return { error: `visit_count cannot exceed ${SERVICE_DATE_FIELDS.length} — only ${SERVICE_DATE_FIELDS.length} service date fields are supported.` };
  }
  const missing = [];
  for (let i = 1; i <= visitCount; i++) {
    const field = `service_date_${i}`;
    if (!serviceDates[field]) missing.push(field);
  }
  return missing.length ? { missing } : null;
};

// ─── Email: AMC Contract Details (manual send) ────────────────
const buildAmcContractEmail = (contract) => `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:30px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0"
             style="background:#ffffff;border-radius:10px;overflow:hidden;
                    box-shadow:0 4px 20px rgba(0,0,0,0.08);max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#065f46 0%,#059669 100%);
                     padding:32px 40px;text-align:center;">
            <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;">
              ⚙️ Electromech Engineering
            </h1>
            <p style="color:#a7f3d0;margin:6px 0 0;font-size:14px;">
              Annual Maintenance Contract — Details
            </p>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:28px 40px 10px;">
            <p style="color:#111827;font-size:16px;margin:0;">
              Dear <strong>${contract.client_name}</strong>,
            </p>
            <p style="color:#4b5563;font-size:14px;line-height:1.7;margin:12px 0 0;">
              Please find the details of your Annual Maintenance Contract below.
            </p>
          </td>
        </tr>

        <!-- Contract Details -->
        <tr>
          <td style="padding:20px 40px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                   style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <tr style="background:#ecfdf5;">
                <td colspan="2" style="padding:12px 20px;">
                  <strong style="color:#065f46;font-size:15px;">
                    📄 Contract ID: ${contract.id}
                  </strong>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           width:40%;color:#6b7280;font-size:13px;">Contract Title</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#111827;font-size:14px;font-weight:600;">${contract.title}</td>
              </tr>
              ${contract.po_number ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#6b7280;font-size:13px;">PO Number</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#111827;font-size:14px;">${contract.po_number}</td>
              </tr>` : ''}
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#6b7280;font-size:13px;">Start Date</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#111827;font-size:14px;">${formatDate(contract.start_date)}</td>
              </tr>
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#6b7280;font-size:13px;">End Date</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#111827;font-size:14px;">${formatDate(contract.end_date)}</td>
              </tr>
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#6b7280;font-size:13px;">Contract Value</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#111827;font-size:14px;font-weight:600;">
                  ₹${parseFloat(contract.value).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
              </tr>
              ${contract.next_service_date ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#6b7280;font-size:13px;">Next Service Date</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#111827;font-size:14px;">${formatDate(contract.next_service_date)}</td>
              </tr>` : ''}
              ${contract.services && contract.services.length > 0 ? `
              <tr>
                <td style="padding:12px 20px;color:#6b7280;font-size:13px;vertical-align:top;">
                  Services Covered
                </td>
                <td style="padding:12px 20px;color:#111827;font-size:14px;">
                  <ul style="margin:0;padding-left:18px;">
                    ${contract.services.map(s => `<li style="margin-bottom:4px;">${s}</li>`).join('')}
                  </ul>
                </td>
              </tr>` : ''}
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
            <p style="color:#6b7280;font-size:13px;margin:0 0 8px;">
              For any queries regarding your AMC contract, please contact us.
            </p>
            <p style="color:#374151;font-size:13px;margin:0;font-weight:600;">
              Electromech Engineering Team
            </p>
            <p style="color:#9ca3af;font-size:11px;margin:12px 0 0;">
              This is an automated notification. Please do not reply directly to this email.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ─── Email: AMC Renewal Reminder ─────────────────────────────
const buildAmcRenewalEmail = (contract) => `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:30px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0"
             style="background:#ffffff;border-radius:10px;overflow:hidden;
                    box-shadow:0 4px 20px rgba(0,0,0,0.08);max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#92400e 0%,#d97706 100%);
                     padding:32px 40px;text-align:center;">
            <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;">
              ⚙️ Electromech Engineering
            </h1>
            <p style="color:#fde68a;margin:6px 0 0;font-size:14px;">
              AMC Renewal Reminder
            </p>
          </td>
        </tr>

        <!-- Alert Banner -->
        <tr>
          <td style="padding:0;">
            <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:16px 40px;">
              <p style="color:#92400e;font-size:14px;margin:0;font-weight:600;">
                ⚠️ Your AMC contract expires in <strong>${contract.days_left} day${contract.days_left !== 1 ? 's' : ''}</strong>
                on ${formatDate(contract.end_date)}.
              </p>
            </div>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:24px 40px 10px;">
            <p style="color:#111827;font-size:16px;margin:0;">
              Dear <strong>${contract.client_name}</strong>,
            </p>
            <p style="color:#4b5563;font-size:14px;line-height:1.7;margin:12px 0 0;">
              This is a friendly reminder that your Annual Maintenance Contract is approaching
              its expiry date. To ensure uninterrupted service coverage, we recommend renewing
              your contract before it expires.
            </p>
          </td>
        </tr>

        <!-- Contract Details -->
        <tr>
          <td style="padding:20px 40px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                   style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <tr style="background:#fffbeb;">
                <td colspan="2" style="padding:12px 20px;">
                  <strong style="color:#92400e;font-size:15px;">
                    📄 Contract ID: ${contract.id}
                  </strong>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           width:40%;color:#6b7280;font-size:13px;">Contract Title</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#111827;font-size:14px;font-weight:600;">${contract.title}</td>
              </tr>
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#6b7280;font-size:13px;">Expiry Date</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#dc2626;font-size:14px;font-weight:700;">${formatDate(contract.end_date)}</td>
              </tr>
              <tr>
                <td style="padding:12px 20px;color:#6b7280;font-size:13px;">Days Remaining</td>
                <td style="padding:12px 20px;color:#dc2626;font-size:14px;font-weight:700;">
                  ${contract.days_left} day${contract.days_left !== 1 ? 's' : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding:10px 40px 24px;text-align:center;">
            <p style="color:#374151;font-size:14px;margin:0 0 16px;">
              Please contact us to renew your contract and continue enjoying uninterrupted maintenance services.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
            <p style="color:#374151;font-size:13px;margin:0;font-weight:600;">
              Electromech Engineering Team
            </p>
            <p style="color:#9ca3af;font-size:11px;margin:8px 0 0;">
              This is an automated renewal reminder. Please do not reply directly to this email.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ─── Email: 10-Day Service Reminder ──────────────────────────
const buildServiceReminderEmail = (contract) => `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:30px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0"
             style="background:#ffffff;border-radius:10px;overflow:hidden;
                    box-shadow:0 4px 20px rgba(0,0,0,0.08);max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);
                     padding:32px 40px;text-align:center;">
            <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;">
              ⚙️ Electromech Engineering
            </h1>
            <p style="color:#bfdbfe;margin:6px 0 0;font-size:14px;">
              Upcoming Service Reminder
            </p>
          </td>
        </tr>

        <!-- Info Banner -->
        <tr>
          <td style="padding:0;">
            <div style="background:#dbeafe;border-left:4px solid #3b82f6;padding:16px 40px;">
              <p style="color:#1e40af;font-size:14px;margin:0;font-weight:600;">
                🔔 Your scheduled service is in <strong>10 days</strong>
                on ${formatDate(contract.next_service_date)}.
              </p>
            </div>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:24px 40px 10px;">
            <p style="color:#111827;font-size:16px;margin:0;">
              Dear <strong>${contract.client_name}</strong>,
            </p>
            <p style="color:#4b5563;font-size:14px;line-height:1.7;margin:12px 0 0;">
              This is a reminder that your next scheduled maintenance service under your
              AMC contract is coming up in <strong>10 days</strong>. Our team will be visiting
              your premises as per the schedule below.
            </p>
          </td>
        </tr>

        <!-- Service Details -->
        <tr>
          <td style="padding:20px 40px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                   style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <tr style="background:#eff6ff;">
                <td colspan="2" style="padding:12px 20px;">
                  <strong style="color:#1e40af;font-size:15px;">
                    📅 Service Appointment Details
                  </strong>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           width:40%;color:#6b7280;font-size:13px;">AMC Contract</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#111827;font-size:14px;font-weight:600;">${contract.id} — ${contract.title}</td>
              </tr>
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#6b7280;font-size:13px;">Scheduled Service Date</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#1d4ed8;font-size:14px;font-weight:700;">${formatDate(contract.next_service_date)}</td>
              </tr>
              ${contract.po_number ? `
              <tr>
                <td style="padding:12px 20px;color:#6b7280;font-size:13px;">PO Number</td>
                <td style="padding:12px 20px;color:#111827;font-size:14px;">${contract.po_number}</td>
              </tr>` : ''}
            </table>
          </td>
        </tr>

        <!-- Instructions -->
        <tr>
          <td style="padding:0 40px 24px;">
            <p style="color:#374151;font-size:14px;margin:0;line-height:1.7;">
              Please ensure that access to the relevant equipment is available on the scheduled date.
              If you need to reschedule or have any questions, please contact us as soon as possible.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
            <p style="color:#374151;font-size:13px;margin:0;font-weight:600;">
              Electromech Engineering Team
            </p>
            <p style="color:#9ca3af;font-size:11px;margin:8px 0 0;">
              This is an automated service reminder. Please do not reply directly to this email.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ────────────────────────────────────────────────────────────
// GET /api/amc
// ────────────────────────────────────────────────────────────
const getAmcContracts = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const { status, client_id, po_number } = req.query;

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
    if (po_number) {
      values.push(po_number);
      conditions.push(`a.po_number = $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM amc_contracts a ${where}`, values
    );
    const total = parseInt(countResult.rows[0].count);

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT
         a.id, a.client_id, c.name AS client_name, c.email AS client_email,
         a.title, a.po_number, a.start_date, a.end_date, a.value,
         a.status, a.next_service_date, a.renewal_reminder_days,
         a.visit_count, a.pumps_count, a.per_pump_price, a.total_price, a.gst_percent,
         a.last_service_date, a.breakdown_visit_count,
         a.service_date_1, a.service_date_2, a.service_date_3,
         a.service_date_4, a.service_date_5, a.service_date_6,
         (a.end_date - CURRENT_DATE) AS days_left,
         a.created_by_user_id, a.created_at, a.updated_at
       FROM amc_contracts a
       LEFT JOIN clients c ON c.id = a.client_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    const contracts = result.rows;
    for (const contract of contracts) {
      const [svc, pumpsRes] = await Promise.all([
        pool.query('SELECT service_name FROM amc_services WHERE amc_id = $1 ORDER BY id', [contract.id]),
        pool.query('SELECT id, serial_number, model_number FROM amc_pumps WHERE amc_id = $1 ORDER BY id', [contract.id]),
      ]);
      contract.services = svc.rows.map(r => r.service_name);
      contract.pumps    = pumpsRes.rows;
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
      services = [], pumps = [], po_number,
      visit_count, pumps_count, per_pump_price, total_price, gst_percent,
      last_service_date, breakdown_visit_count,
      service_date_1, service_date_2, service_date_3,
      service_date_4, service_date_5, service_date_6,
    } = req.body;
    const serviceDates = { service_date_1, service_date_2, service_date_3, service_date_4, service_date_5, service_date_6 };

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

    if (visit_count !== undefined && visit_count !== null && visit_count !== '') {
      const serviceDateCheck = validateServiceDates(parseInt(visit_count), serviceDates);
      if (serviceDateCheck) {
        if (serviceDateCheck.error) {
          return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, serviceDateCheck.error);
        }
        return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
          `visit_count is ${visit_count}, so the following service dates are required: ${serviceDateCheck.missing.join(', ')}.`,
          { missing_fields: serviceDateCheck.missing });
      }
    }

    // ── Validate po_number uniqueness if provided ─────────────
    if (po_number) {
      const poCheck = await dbClient.query(
        'SELECT id FROM amc_contracts WHERE po_number = $1 LIMIT 1',
        [po_number]
      );
      if (poCheck.rows.length > 0) {
        return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
          `PO Number "${po_number}" is already in use by another AMC contract.`,
          { field: 'po_number' });
      }
    }

    // Validate client exists + get email
    const clientCheck = await dbClient.query(
      'SELECT id, name, email, phone FROM clients WHERE id = $1', [client_id]
    );
    if (clientCheck.rows.length === 0) return Errors.clientNotFound(res);
    const clientRow = clientCheck.rows[0];

    await dbClient.query('BEGIN');

    const amcId = await generateAmcId(dbClient);
    const status = computeAmcStatus(end_date, renewal_reminder_days);

    const result = await dbClient.query(
      `INSERT INTO amc_contracts
         (id, client_id, title, start_date, end_date, value, status,
          next_service_date, renewal_reminder_days, po_number, created_by_user_id,
          visit_count, pumps_count, per_pump_price, total_price, gst_percent,
          last_service_date,
          service_date_1, service_date_2, service_date_3,
          service_date_4, service_date_5, service_date_6,
          breakdown_visit_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
       RETURNING *`,
      [
        amcId, client_id, title.trim(), start_date, end_date,
        parseFloat(value), status,
        next_service_date || null, renewal_reminder_days,
        po_number || null, req.user.id,
        visit_count    !== undefined && visit_count    !== null && visit_count    !== '' ? parseInt(visit_count)      : null,
        pumps_count    !== undefined && pumps_count    !== null && pumps_count    !== '' ? parseInt(pumps_count)      : null,
        per_pump_price !== undefined && per_pump_price !== null && per_pump_price !== '' ? parseFloat(per_pump_price) : null,
        total_price    !== undefined && total_price    !== null && total_price    !== '' ? parseFloat(total_price)    : null,
        gst_percent    !== undefined && gst_percent    !== null && gst_percent    !== '' ? parseFloat(gst_percent)    : null,
        last_service_date || null,
        service_date_1 || null, service_date_2 || null, service_date_3 || null,
        service_date_4 || null, service_date_5 || null, service_date_6 || null,
        breakdown_visit_count !== undefined && breakdown_visit_count !== null && breakdown_visit_count !== '' ? parseInt(breakdown_visit_count) : null,
      ]
    );

    const contract = result.rows[0];

    if (services.length > 0) {
      for (const svc of services) {
        await dbClient.query(
          'INSERT INTO amc_services (amc_id, service_name) VALUES ($1, $2)',
          [amcId, svc.trim()]
        );
      }
    }

    if (pumps.length > 0) {
      for (const pump of pumps) {
        if (!pump.serial_number || !pump.model_number) continue;
        await dbClient.query(
          'INSERT INTO amc_pumps (amc_id, serial_number, model_number) VALUES ($1, $2, $3)',
          [amcId, pump.serial_number.trim(), pump.model_number.trim()]
        );
      }
    }

    await dbClient.query('COMMIT');

    const pumpsRows = await pool.query(
      'SELECT id, serial_number, model_number FROM amc_pumps WHERE amc_id = $1 ORDER BY id',
      [amcId]
    );
    contract.services    = services;
    contract.pumps       = pumpsRows.rows;
    contract.client_name = clientRow.name;
    contract.client_email = clientRow.email;
    contract.days_left   = Math.ceil((new Date(end_date) - new Date()) / (1000 * 60 * 60 * 24));

    // ── Respond IMMEDIATELY — never block on notifications ──
    res.status(201).json({
      success: true,
      message: `AMC contract ${amcId} created for ${contract.client_name}.`,
      data: contract,
    });

    // ── WhatsApp: fire-and-forget — client confirmation ──────
    const whatsappTo = formatWhatsAppNumber(clientRow.phone);
    if (!whatsappTo) {
      console.warn(`[WhatsApp] Skipped amc_created for ${amcId} — client "${clientRow.name}" (id=${client_id}) has no phone number on file.`);
    } else {
      sendWhatsAppTemplateMessage({
        to: whatsappTo,
        templateName: 'amc_created',
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: clientRow.name },
            { type: 'text', text: amcId },
            { type: 'text', text: title.trim() },
            { type: 'text', text: formatDate(start_date) },
            { type: 'text', text: formatDate(end_date) },
            { type: 'text', text: `₹${parseFloat(value).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
          ],
        }],
      }).catch(e => console.error('[WhatsApp] amc_created notify', e.message));
    }

    // ── WS notification + activity log: .catch so they never throw ──
    notify({
      event:       'amc_created',
      title:       'New AMC Contract Created',
      message:     `${amcId} — ${title.trim()} for ${contract.client_name}`,
      entity_type: 'amc',
      entity_id:   amcId,
      roles:       ['admin', 'manager'],
    }, wsManager).catch(e => console.error('[amc notify]', e.message));

    logActivity({
      type:         'amc',
      action:       `AMC ${amcId} created — ${title.trim()} for ${contract.client_name}`,
      entity_type:  'amc',
      entity_id:    amcId,
      performed_by: req.user.id,
    }).catch(e => console.error('[amc activity]', e.message));

  } catch (error) {
    await dbClient.query('ROLLBACK');
    console.error('Create AMC error:', error);
    if (!res.headersSent) return Errors.internalError(res);
  } finally {
    dbClient.release();
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/amc/expiring — used by cron job
// ────────────────────────────────────────────────────────────
const getExpiringContracts = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         a.id, a.client_id, c.name AS client_name,
         c.email AS client_email, c.contact_person,
         a.title, a.po_number, a.end_date, a.renewal_reminder_days,
         a.next_service_date,
         (a.end_date - CURRENT_DATE) AS days_left
       FROM amc_contracts a
       LEFT JOIN clients c ON c.id = a.client_id
       WHERE (a.end_date - a.renewal_reminder_days) <= CURRENT_DATE
         AND a.end_date >= CURRENT_DATE
       ORDER BY a.end_date ASC`
    );

    return res.status(200).json({ success: true, data: result.rows });

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
         a.id, a.client_id, c.name AS client_name, c.email AS client_email,
         a.title, a.po_number, a.start_date, a.end_date, a.value,
         a.status, a.next_service_date, a.renewal_reminder_days,
         a.visit_count, a.pumps_count, a.per_pump_price, a.total_price, a.gst_percent,
         a.last_service_date, a.breakdown_visit_count,
         a.service_date_1, a.service_date_2, a.service_date_3,
         a.service_date_4, a.service_date_5, a.service_date_6,
         (a.end_date - CURRENT_DATE) AS days_left,
         a.created_by_user_id, a.created_at, a.updated_at
       FROM amc_contracts a
       LEFT JOIN clients c ON c.id = a.client_id
       WHERE a.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, ERROR_CODES.CLIENT_NOT_FOUND, 'AMC contract not found.');
    }

    const contract = result.rows[0];
    const [svc, pumpsRes] = await Promise.all([
      pool.query('SELECT service_name FROM amc_services WHERE amc_id = $1 ORDER BY id', [id]),
      pool.query('SELECT id, serial_number, model_number FROM amc_pumps WHERE amc_id = $1 ORDER BY id', [id]),
    ]);
    contract.services = svc.rows.map(r => r.service_name);
    contract.pumps    = pumpsRes.rows;

    return res.status(200).json({ success: true, data: contract });

  } catch (error) {
    console.error('Get AMC by ID error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/amc/:id/send-email
// Manually send the AMC contract details to an email address
// supplied by the caller (not necessarily the client's stored email).
// ────────────────────────────────────────────────────────────
const sendAmcEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;

    if (!email) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'email is required.', { field: 'email' });
    }
    if (!isValidEmail(email)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'A valid email address is required.', { field: 'email' });
    }

    const result = await pool.query(
      `SELECT
         a.id, a.client_id, c.name AS client_name,
         a.title, a.po_number, a.start_date, a.end_date, a.value,
         a.next_service_date
       FROM amc_contracts a
       LEFT JOIN clients c ON c.id = a.client_id
       WHERE a.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, ERROR_CODES.CLIENT_NOT_FOUND, 'AMC contract not found.');
    }

    const contract = result.rows[0];
    const svc = await pool.query(
      'SELECT service_name FROM amc_services WHERE amc_id = $1 ORDER BY id', [id]
    );
    contract.services = svc.rows.map(r => r.service_name);

    const html = buildAmcContractEmail(contract);
    sendNotification('amc_manual_email', {
      to:      email,
      subject: `AMC Contract ${id} Details — ${contract.title} | Electromech Engineering`,
      html,
    });

    logActivity({
      type:         'amc',
      action:       `AMC ${id} details emailed to ${email}`,
      entity_type:  'amc',
      entity_id:    id,
      performed_by: req.user.id,
    }).catch(e => console.error('[amc activity]', e.message));

    return res.status(200).json({
      success: true,
      message: `AMC contract ${id} details sent to ${email}.`,
    });

  } catch (error) {
    console.error('Send AMC email error:', error);
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
      services, pumps, po_number,
      visit_count, pumps_count, per_pump_price, total_price, gst_percent,
      last_service_date, breakdown_visit_count,
      service_date_1, service_date_2, service_date_3,
      service_date_4, service_date_5, service_date_6,
    } = req.body;

    const newTitle           = title                ? title.trim()               : cur.title;
    const newEndDate         = end_date             || cur.end_date;
    const newValue           = value                !== undefined ? parseFloat(value) : cur.value;
    const newNextServiceDate = next_service_date    !== undefined ? next_service_date  : cur.next_service_date;
    const newReminderDays    = renewal_reminder_days !== undefined ? renewal_reminder_days : cur.renewal_reminder_days;
    const newPoNumber        = po_number            !== undefined ? po_number           : cur.po_number;
    const newLastServiceDate = last_service_date    !== undefined ? (last_service_date || null) : cur.last_service_date;

    const numOrNull = (v) => (v === '' || v === null ? null : v);
    const newVisitCount    = visit_count    !== undefined ? (numOrNull(visit_count)    === null ? null : parseInt(visit_count))      : cur.visit_count;
    const newPumpsCount    = pumps_count    !== undefined ? (numOrNull(pumps_count)    === null ? null : parseInt(pumps_count))      : cur.pumps_count;
    const newPerPumpPrice  = per_pump_price !== undefined ? (numOrNull(per_pump_price) === null ? null : parseFloat(per_pump_price)) : cur.per_pump_price;
    const newTotalPrice    = total_price    !== undefined ? (numOrNull(total_price)    === null ? null : parseFloat(total_price))    : cur.total_price;
    const newGstPercent    = gst_percent    !== undefined ? (numOrNull(gst_percent)    === null ? null : parseFloat(gst_percent))    : cur.gst_percent;
    const newBreakdownVisitCount = breakdown_visit_count !== undefined ? (numOrNull(breakdown_visit_count) === null ? null : parseInt(breakdown_visit_count)) : cur.breakdown_visit_count;

    const newServiceDate1 = service_date_1 !== undefined ? (service_date_1 || null) : cur.service_date_1;
    const newServiceDate2 = service_date_2 !== undefined ? (service_date_2 || null) : cur.service_date_2;
    const newServiceDate3 = service_date_3 !== undefined ? (service_date_3 || null) : cur.service_date_3;
    const newServiceDate4 = service_date_4 !== undefined ? (service_date_4 || null) : cur.service_date_4;
    const newServiceDate5 = service_date_5 !== undefined ? (service_date_5 || null) : cur.service_date_5;
    const newServiceDate6 = service_date_6 !== undefined ? (service_date_6 || null) : cur.service_date_6;

    if (newReminderDays < 1 || newReminderDays > 365) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'renewal_reminder_days must be between 1 and 365.');
    }

    if (newVisitCount !== undefined && newVisitCount !== null) {
      const serviceDateCheck = validateServiceDates(newVisitCount, {
        service_date_1: newServiceDate1, service_date_2: newServiceDate2, service_date_3: newServiceDate3,
        service_date_4: newServiceDate4, service_date_5: newServiceDate5, service_date_6: newServiceDate6,
      });
      if (serviceDateCheck) {
        if (serviceDateCheck.error) {
          return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, serviceDateCheck.error);
        }
        return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
          `visit_count is ${newVisitCount}, so the following service dates are required: ${serviceDateCheck.missing.join(', ')}.`,
          { missing_fields: serviceDateCheck.missing });
      }
    }

    // Check PO uniqueness if changing
    if (newPoNumber && newPoNumber !== cur.po_number) {
      const poCheck = await dbClient.query(
        'SELECT id FROM amc_contracts WHERE po_number = $1 AND id != $2 LIMIT 1',
        [newPoNumber, id]
      );
      if (poCheck.rows.length > 0) {
        return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
          `PO Number "${newPoNumber}" is already in use by another AMC contract.`,
          { field: 'po_number' });
      }
    }

    const newStatus = computeAmcStatus(newEndDate, newReminderDays);

    await dbClient.query('BEGIN');

    const result = await dbClient.query(
      `UPDATE amc_contracts
       SET title=$1, end_date=$2, value=$3, status=$4,
           next_service_date=$5, renewal_reminder_days=$6, po_number=$7,
           visit_count=$8, pumps_count=$9, per_pump_price=$10,
           total_price=$11, gst_percent=$12, last_service_date=$13,
           service_date_1=$14, service_date_2=$15, service_date_3=$16,
           service_date_4=$17, service_date_5=$18, service_date_6=$19,
           breakdown_visit_count=$20
       WHERE id=$21
       RETURNING *`,
      [newTitle, newEndDate, newValue, newStatus,
       newNextServiceDate, newReminderDays, newPoNumber || null,
       newVisitCount, newPumpsCount, newPerPumpPrice, newTotalPrice, newGstPercent,
       newLastServiceDate,
       newServiceDate1, newServiceDate2, newServiceDate3,
       newServiceDate4, newServiceDate5, newServiceDate6,
       newBreakdownVisitCount,
       id]
    );

    if (Array.isArray(services)) {
      await dbClient.query('DELETE FROM amc_services WHERE amc_id = $1', [id]);
      for (const svc of services) {
        await dbClient.query(
          'INSERT INTO amc_services (amc_id, service_name) VALUES ($1, $2)',
          [id, svc.trim()]
        );
      }
    }

    if (Array.isArray(pumps)) {
      await dbClient.query('DELETE FROM amc_pumps WHERE amc_id = $1', [id]);
      for (const pump of pumps) {
        if (!pump.serial_number || !pump.model_number) continue;
        await dbClient.query(
          'INSERT INTO amc_pumps (amc_id, serial_number, model_number) VALUES ($1, $2, $3)',
          [id, pump.serial_number.trim(), pump.model_number.trim()]
        );
      }
    }

    await dbClient.query('COMMIT');

    const updated = result.rows[0];
    const [svc, pumpsRes] = await Promise.all([
      pool.query('SELECT service_name FROM amc_services WHERE amc_id = $1 ORDER BY id', [id]),
      pool.query('SELECT id, serial_number, model_number FROM amc_pumps WHERE amc_id = $1 ORDER BY id', [id]),
    ]);
    updated.services = svc.rows.map(r => r.service_name);
    updated.pumps    = pumpsRes.rows;

    await logActivity({
      type:         'amc',
      action:       `AMC ${id} updated`,
      entity_type:  'amc',
      entity_id:    id,
      performed_by: req.user.id,
    });

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

    await pool.query('DELETE FROM amc_contracts WHERE id = $1', [id]);

    await logActivity({
      type:         'amc',
      action:       `AMC ${id} deleted — ${existCheck.rows[0].title}`,
      entity_type:  'amc',
      entity_id:    id,
      performed_by: req.user.id,
    });

    return res.status(200).json({
      success: true,
      message: `AMC contract "${existCheck.rows[0].title}" deleted successfully.`,
    });

  } catch (error) {
    console.error('Delete AMC error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/amc/export/excel
// AMC Excel export — 14 columns per AMC contract
// Optional: ?status=Active &client_id=5 &year=2026
// ────────────────────────────────────────────────────────────
const fmtDate = (d) => d
  ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
  : '—';

const getAmcExcel = async (req, res) => {
  try {
    const { status, client_id, year } = req.query;

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
    if (year) {
      values.push(parseInt(year));
      conditions.push(`EXTRACT(YEAR FROM a.start_date) = $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
         a.id                                                                          AS amc_id,
         EXTRACT(YEAR FROM COALESCE(a.next_service_date, a.start_date))::int          AS year,
         COALESCE(a.next_service_date, a.start_date)                                  AS visit_date,
         -- Technician names from the most recent job for this client
         (
           SELECT string_agg(t.name, ', ' ORDER BY jt.assigned_at)
           FROM jobs lj
           JOIN job_technicians jt ON jt.job_id = lj.id
           JOIN technicians t     ON t.id = jt.technician_id
           WHERE lj.client_id = a.client_id
             AND lj.id = (
               SELECT id FROM jobs WHERE client_id = a.client_id
               ORDER BY created_at DESC LIMIT 1
             )
         )                                                                             AS technician_names,
         c.name                                                                        AS client_name,
         -- Visit category from the most recent job
         (
           SELECT j2.category FROM jobs j2
           WHERE j2.client_id = a.client_id
           ORDER BY j2.created_at DESC LIMIT 1
         )                                                                             AS visit_category,
         -- Service report: any report received for any job of this client
         CASE WHEN EXISTS (
           SELECT 1 FROM reports r
           JOIN jobs j3 ON j3.id = r.job_id
           WHERE j3.client_id = a.client_id
         ) THEN 'Received' ELSE 'Not Received' END                                    AS service_report_status,
         -- Pending visit: any open job for this client
         CASE WHEN EXISTS (
           SELECT 1 FROM jobs j4
           WHERE j4.client_id = a.client_id
             AND j4.status NOT IN ('Closed', 'Cancelled')
         ) THEN 'Yes' ELSE 'No' END                                                   AS pending_visit,
         a.status                                                                      AS amc_po_status,
         a.service_date_1,
         a.service_date_2,
         a.service_date_3,
         a.service_date_4,
         a.service_date_5,
         a.service_date_6
       FROM amc_contracts a
       LEFT JOIN clients c ON c.id = a.client_id
       ${where}
       ORDER BY a.created_at DESC`,
      values
    );

    const rows = result.rows;

    // ── Build workbook ───────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = 'VDTI Service Hub';
    wb.created = new Date();

    const ws = wb.addWorksheet('AMC Contracts');

    // ── Title ────────────────────────────────────────────────
    ws.mergeCells('A1:N1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `AMC Contract Report${year ? ` — ${year}` : ''}${status ? ` (${status})` : ''}`;
    titleCell.font      = { bold: true, size: 16, color: { argb: 'FF1F2937' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 35;

    // ── Info row ─────────────────────────────────────────────
    ws.mergeCells('A2:N2');
    const infoCell = ws.getCell('A2');
    infoCell.value = `Generated on: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}  |  Total Contracts: ${rows.length}`;
    infoCell.font      = { size: 10, italic: true, color: { argb: 'FF6B7280' } };
    infoCell.alignment = { horizontal: 'center' };

    ws.addRow([]);

    // ── Headers ──────────────────────────────────────────────
    const headers = [
      'Year', 'Date', 'Technician Name', 'Client Name',
      'Visit Category', 'Service Report', 'Pending Visit', 'AMC PO Status',
      '1st Visit Date', '2nd Visit Date', '3rd Visit Date',
      '4th Visit Date', '5th Visit Date', '6th Visit Date',
    ];

    const headerRow = ws.addRow(headers);
    headerRow.height = 30;
    headerRow.eachCell((cell) => {
      cell.font      = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border    = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    const amcStatusColors = {
      'Active':        'FF065F46',
      'Expiring Soon': 'FFB45309',
      'Expired':       'FFB91C1C',
    };

    // ── Data rows ────────────────────────────────────────────
    rows.forEach((v, i) => {
      const row = ws.addRow([
        v.year || '—',
        v.visit_date ? fmtDate(v.visit_date) : '—',
        v.technician_names || 'Not Assigned',
        v.client_name      || '—',
        v.visit_category   || '—',
        v.service_report_status,
        v.pending_visit,
        v.amc_po_status,
        fmtDate(v.service_date_1),
        fmtDate(v.service_date_2),
        fmtDate(v.service_date_3),
        fmtDate(v.service_date_4),
        fmtDate(v.service_date_5),
        fmtDate(v.service_date_6),
      ]);

      row.eachCell((cell) => {
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border    = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        };
      });

      // Alternate row shading
      if (i % 2 === 1) {
        row.eachCell((cell) => {
          if (!cell.fill || !cell.fill.fgColor || cell.fill.fgColor.argb === 'FF000000') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
          }
        });
      }

      // Service Report (col 6)
      const srCell = row.getCell(6);
      srCell.font      = { bold: true, color: { argb: v.service_report_status === 'Received' ? 'FF065F46' : 'FFB91C1C' } };
      srCell.alignment = { horizontal: 'center', vertical: 'middle' };

      // Pending Visit (col 7)
      const pvCell = row.getCell(7);
      pvCell.font      = { bold: true, color: { argb: v.pending_visit === 'Yes' ? 'FFB45309' : 'FF065F46' } };
      pvCell.alignment = { horizontal: 'center', vertical: 'middle' };

      // AMC PO Status (col 8)
      const amcCell = row.getCell(8);
      amcCell.font      = { bold: true, color: { argb: amcStatusColors[v.amc_po_status] || 'FF6B7280' } };
      amcCell.alignment = { horizontal: 'center', vertical: 'middle' };

      // Year (col 1)
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // ── Column widths ────────────────────────────────────────
    ws.columns = [
      { width: 8  },  // Year
      { width: 16 },  // Date
      { width: 26 },  // Technician Name
      { width: 26 },  // Client Name
      { width: 22 },  // Visit Category
      { width: 20 },  // Service Report
      { width: 14 },  // Pending Visit
      { width: 16 },  // AMC PO Status
      { width: 15 },  // 1st Visit Date
      { width: 15 },  // 2nd Visit Date
      { width: 15 },  // 3rd Visit Date
      { width: 15 },  // 4th Visit Date
      { width: 15 },  // 5th Visit Date
      { width: 15 },  // 6th Visit Date
    ];

    // ── Summary section ──────────────────────────────────────
    ws.addRow([]);
    ws.addRow([]);
    ws.addRow(['Summary']).getCell(1).font = { bold: true, size: 13 };

    const statusCounts = {};
    let receivedCount  = 0;
    let pendingCount   = 0;
    for (const v of rows) {
      statusCounts[v.amc_po_status] = (statusCounts[v.amc_po_status] || 0) + 1;
      if (v.service_report_status === 'Received') receivedCount++;
      if (v.pending_visit === 'Yes')              pendingCount++;
    }

    ws.addRow(['AMC Status Breakdown']).getCell(1).font = { bold: true, size: 11 };
    for (const [stat, count] of Object.entries(statusCounts)) {
      ws.addRow(['', stat, count]);
    }
    ws.addRow(['', 'Total', rows.length]).getCell(3).font = { bold: true };

    ws.addRow([]);
    ws.addRow(['Service Report Summary']).getCell(1).font = { bold: true, size: 11 };
    ws.addRow(['', 'Received',     receivedCount]);
    ws.addRow(['', 'Not Received', rows.length - receivedCount]);
    ws.addRow(['', 'Pending Visits', pendingCount]);

    // ── Send file ─────────────────────────────────────────────
    const filename = `AMC_Report${year ? `_${year}` : ''}${status ? `_${status}` : ''}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await wb.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('AMC Excel export error:', error);
    if (!res.headersSent) return Errors.internalError(res);
  }
};

module.exports = {
  getAmcContracts,
  createAmcContract,
  getExpiringContracts,
  getAmcById,
  updateAmcContract,
  deleteAmcContract,
  sendAmcEmail,
  getAmcExcel,
  // Email builders exported so amcExpiryJob can use them
  buildAmcRenewalEmail,
  buildServiceReminderEmail,
};