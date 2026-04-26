// ============================================================
// src/controllers/amcController.js
// ============================================================

const pool = require('../config/db');
const { sendError, Errors } = require('../utils/AppError');
const { notify } = require('./notificationController');
const wsManager  = require('../config/websocketManager');
const { logActivity } = require('./activityController');
const ERROR_CODES = require('../utils/errorCodes');
const { sendNotification } = require('./emailController');

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

// ─── Email: AMC Created ───────────────────────────────────────
const buildAmcCreatedEmail = (contract) => `
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
              Annual Maintenance Contract — Confirmation
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
              We are pleased to confirm that your Annual Maintenance Contract has been successfully
              created. Please find the contract details below.
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

        <!-- Status -->
        <tr>
          <td style="padding:0 40px 20px;">
            <div style="background:#d1fae5;border:1px solid #6ee7b7;border-radius:6px;padding:12px 16px;">
              <span style="color:#065f46;font-size:13px;">
                ✅ <strong>Status: Active</strong> — Your contract is now active.
              </span>
            </div>
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
      services = [], po_number,
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
      'SELECT id, name, email FROM clients WHERE id = $1', [client_id]
    );
    if (clientCheck.rows.length === 0) return Errors.clientNotFound(res);
    const clientRow = clientCheck.rows[0];

    await dbClient.query('BEGIN');

    const amcId = await generateAmcId(dbClient);
    const status = computeAmcStatus(end_date, renewal_reminder_days);

    const result = await dbClient.query(
      `INSERT INTO amc_contracts
         (id, client_id, title, start_date, end_date, value, status,
          next_service_date, renewal_reminder_days, po_number, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        amcId, client_id, title.trim(), start_date, end_date,
        parseFloat(value), status,
        next_service_date || null, renewal_reminder_days,
        po_number || null, req.user.id,
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

    await dbClient.query('COMMIT');

    contract.services    = services;
    contract.client_name = clientRow.name;
    contract.client_email = clientRow.email;
    contract.days_left   = Math.ceil((new Date(end_date) - new Date()) / (1000 * 60 * 60 * 24));

    // ── Send AMC Created email to client ──────────────────────
    if (clientRow.email) {
      const html = buildAmcCreatedEmail(contract);
      await sendNotification('amc_created', {
        to:      clientRow.email,
        subject: `AMC Contract ${amcId} Created — ${title.trim()} | Electromech Engineering`,
        html,
      });
    }

    // ── Fire real-time notification ───────────────────────────
    await notify({
      event:       'amc_created',
      title:       'New AMC Contract Created',
      message:     `${amcId} — ${title.trim()} for ${contract.client_name}`,
      entity_type: 'amc',
      entity_id:   amcId,
      roles:       ['admin', 'manager'],
    }, wsManager);

    await logActivity({
      type:         'amc',
      action:       `AMC ${amcId} created — ${title.trim()} for ${contract.client_name}`,
      entity_type:  'amc',
      entity_id:    amcId,
      performed_by: req.user.id,
    });

    return res.status(201).json({
      success: true,
      message: `AMC contract ${amcId} created for ${contract.client_name}.${clientRow.email ? ` Confirmation sent to ${clientRow.email}.` : ''}`,
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
      services, po_number,
    } = req.body;

    const newTitle           = title                ? title.trim()               : cur.title;
    const newEndDate         = end_date             || cur.end_date;
    const newValue           = value                !== undefined ? parseFloat(value) : cur.value;
    const newNextServiceDate = next_service_date    !== undefined ? next_service_date  : cur.next_service_date;
    const newReminderDays    = renewal_reminder_days !== undefined ? renewal_reminder_days : cur.renewal_reminder_days;
    const newPoNumber        = po_number            !== undefined ? po_number           : cur.po_number;

    if (newReminderDays < 1 || newReminderDays > 365) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'renewal_reminder_days must be between 1 and 365.');
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
           next_service_date=$5, renewal_reminder_days=$6, po_number=$7
       WHERE id=$8
       RETURNING *`,
      [newTitle, newEndDate, newValue, newStatus,
       newNextServiceDate, newReminderDays, newPoNumber || null, id]
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

    await dbClient.query('COMMIT');

    const updated = result.rows[0];
    const svc = await pool.query(
      'SELECT service_name FROM amc_services WHERE amc_id = $1 ORDER BY id', [id]
    );
    updated.services = svc.rows.map(r => r.service_name);

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

module.exports = {
  getAmcContracts,
  createAmcContract,
  getExpiringContracts,
  getAmcById,
  updateAmcContract,
  deleteAmcContract,
  // Email builders exported so amcExpiryJob can use them
  buildAmcRenewalEmail,
  buildServiceReminderEmail,
};