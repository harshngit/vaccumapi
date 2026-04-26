// ============================================================
// src/controllers/reportController.js
// ============================================================

const pool = require('../config/db');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');
const { isValidReportStatus } = require('../utils/validators');
const { notify } = require('./notificationController');
const wsManager  = require('../config/websocketManager');
const { logActivity } = require('./activityController');
const { sendNotification, buildTransporterFromEnv } = require('./emailController');

// ─── Helper: generate next report ID ─────────────────────────
const generateReportId = async (client) => {
  const result = await client.query(
    `SELECT id FROM reports ORDER BY id DESC LIMIT 1`
  );
  if (result.rows.length === 0) return 'RPT-0001';
  const lastNum = parseInt(result.rows[0].id.replace('RPT-', ''), 10);
  return `RPT-${String(lastNum + 1).padStart(4, '0')}`;
};

// ─── Helper: build nice HTML report email ────────────────────
const buildReportEmailHtml = (report, technicalFiles = []) => {
  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const technicalSection = technicalFiles.length > 0 ? `
    <tr>
      <td style="padding:14px 20px;border-bottom:1px solid #f0f0f0;">
        <strong style="color:#374151;">Attached Technical Reports</strong><br/>
        <ul style="margin:8px 0 0 0;padding-left:18px;">
          ${technicalFiles.map(f => `<li><a href="${f.file_url}" style="color:#2563eb;">${f.file_name}</a></li>`).join('')}
        </ul>
      </td>
    </tr>` : '';

  return `
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
          <td style="background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 100%);
                     padding:32px 40px;text-align:center;">
            <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;
                       letter-spacing:0.5px;">
              ⚙️ Electromech Engineering
            </h1>
            <p style="color:#bfdbfe;margin:6px 0 0;font-size:14px;">
              Service Report Notification
            </p>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:28px 40px 10px;">
            <p style="color:#111827;font-size:16px;margin:0;">
              Dear <strong>${report.client_name || 'Valued Client'}</strong>,
            </p>
            <p style="color:#4b5563;font-size:14px;line-height:1.7;margin:12px 0 0;">
              We are pleased to inform you that a service has been completed at your premises.
              Please find the full service report details below.
            </p>
          </td>
        </tr>

        <!-- Report Details Table -->
        <tr>
          <td style="padding:20px 40px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                   style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <tr style="background:#eff6ff;">
                <td colspan="2" style="padding:12px 20px;">
                  <strong style="color:#1e40af;font-size:15px;">
                    📋 Report ID: ${report.id}
                  </strong>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           width:40%;color:#6b7280;font-size:13px;">Report Title</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#111827;font-size:14px;font-weight:600;">${report.title}</td>
              </tr>
              ${report.po_number ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#6b7280;font-size:13px;">PO Number</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#111827;font-size:14px;">${report.po_number}</td>
              </tr>` : ''}
              ${report.location ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#6b7280;font-size:13px;">Location</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#111827;font-size:14px;">${report.location}</td>
              </tr>` : ''}
              ${report.serial_no ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#6b7280;font-size:13px;">Serial No.</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#111827;font-size:14px;">${report.serial_no}</td>
              </tr>` : ''}
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#6b7280;font-size:13px;">Service Date</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#111827;font-size:14px;">${formatDate(report.report_date)}</td>
              </tr>
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#6b7280;font-size:13px;">Technician</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#111827;font-size:14px;">${report.technician_name || '—'}</td>
              </tr>
              ${report.findings ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#6b7280;font-size:13px;vertical-align:top;">Findings</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#374151;font-size:14px;line-height:1.6;">${report.findings.replace(/\n/g, '<br/>')}</td>
              </tr>` : ''}
              ${report.recommendations ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#6b7280;font-size:13px;vertical-align:top;">Recommendations</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#374151;font-size:14px;line-height:1.6;">${report.recommendations.replace(/\n/g, '<br/>')}</td>
              </tr>` : ''}
              ${report.comments ? `
              <tr>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#6b7280;font-size:13px;vertical-align:top;">Comments</td>
                <td style="padding:12px 20px;border-bottom:1px solid #f0f0f0;
                           color:#374151;font-size:14px;line-height:1.6;">${report.comments.replace(/\n/g, '<br/>')}</td>
              </tr>` : ''}
              ${technicalSection}
            </table>
          </td>
        </tr>

        <!-- Status Badge -->
        <tr>
          <td style="padding:0 40px 20px;">
            <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;
                        padding:12px 16px;display:inline-block;">
              <span style="color:#92400e;font-size:13px;">
                ⏳ <strong>Status:</strong> This report is currently under review by our team.
              </span>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
            <p style="color:#6b7280;font-size:13px;margin:0 0 8px;">
              If you have any questions regarding this service report, please contact us.
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
};

// ────────────────────────────────────────────────────────────
// GET /api/reports
// ────────────────────────────────────────────────────────────
const getReports = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const { status, technician_id, job_id, from_date, to_date, client_id, po_number } = req.query;

    if (status && !['Pending', 'Approved', 'Rejected'].includes(status)) {
      return sendError(res, 400, ERROR_CODES.INVALID_REPORT_STATUS,
        'Invalid status. Allowed: Pending, Approved, Rejected.', { field: 'status' });
    }

    const conditions = [];
    const values     = [];

    if (status) {
      values.push(status);
      conditions.push(`r.status = $${values.length}`);
    }
    if (technician_id) {
      values.push(parseInt(technician_id));
      conditions.push(`r.technician_id = $${values.length}`);
    }
    if (job_id) {
      values.push(job_id);
      conditions.push(`r.job_id = $${values.length}`);
    }
    if (client_id) {
      values.push(parseInt(client_id));
      conditions.push(`r.client_id = $${values.length}`);
    }
    if (po_number) {
      values.push(po_number);
      conditions.push(`r.po_number = $${values.length}`);
    }
    if (from_date) {
      values.push(from_date);
      conditions.push(`r.report_date >= $${values.length}`);
    }
    if (to_date) {
      values.push(to_date);
      conditions.push(`r.report_date <= $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM reports r ${where}`, values
    );
    const total = parseInt(countResult.rows[0].count);

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT
         r.id, r.job_id,
         j.title         AS job_title,
         COALESCE(r.client_name, c.name) AS client_name,
         r.client_email, r.client_id,
         r.po_number, r.location, r.serial_no,
         r.title, r.findings, r.recommendations, r.comments,
         r.status,
         r.technician_id, t.name AS technician_name,
         r.approved_by_user_id, r.approved_at,
         r.report_date,
         (SELECT COUNT(*) FROM report_images ri WHERE ri.report_id = r.id)     AS image_count,
         (SELECT COUNT(*) FROM technical_reports tr WHERE tr.report_id = r.id) AS technical_report_count,
         r.created_at, r.updated_at
       FROM reports r
       LEFT JOIN jobs        j ON j.id = r.job_id
       LEFT JOIN clients     c ON c.id = COALESCE(r.client_id, j.client_id)
       LEFT JOIN technicians t ON t.id = r.technician_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: { total, page, limit, total_pages: Math.ceil(total / limit) },
    });

  } catch (error) {
    console.error('Get reports error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/reports
// ────────────────────────────────────────────────────────────
const createReport = async (req, res) => {
  const dbClient = await pool.connect();
  try {
    const {
      job_id, title, findings, recommendations, technician_id,
      po_number, location, serial_no, comments,
      client_id, client_name, client_email,
    } = req.body;

    const missing = [];
    if (!job_id)        missing.push('job_id');
    if (!title)         missing.push('title');
    if (!technician_id) missing.push('technician_id');
    if (missing.length > 0) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        `Please fill in all required fields: ${missing.join(', ')}.`,
        { missing_fields: missing });
    }

    // Validate job exists
    const jobCheck = await dbClient.query(
      `SELECT j.id, j.client_id, c.name AS client_name, c.email AS client_email
       FROM jobs j LEFT JOIN clients c ON c.id = j.client_id WHERE j.id = $1`,
      [job_id]
    );
    if (jobCheck.rows.length === 0) return Errors.jobNotFound(res);
    const jobRow = jobCheck.rows[0];

    // Validate technician exists
    const techCheck = await dbClient.query(
      'SELECT id, name FROM technicians WHERE id = $1', [technician_id]
    );
    if (techCheck.rows.length === 0) return Errors.technicianNotFound(res);

    // ── Validate PO Number against AMC contracts ──────────────
    if (po_number) {
      const amcCheck = await dbClient.query(
        'SELECT id FROM amc_contracts WHERE po_number = $1 LIMIT 1',
        [po_number]
      );
      if (amcCheck.rows.length === 0) {
        return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
          `PO Number "${po_number}" does not match any AMC contract. Please enter a valid AMC PO Number.`,
          { field: 'po_number' });
      }
    }

    // Resolve client info: use explicitly provided, fallback to job's client
    const resolvedClientId    = client_id    || jobRow.client_id    || null;
    const resolvedClientName  = client_name  || jobRow.client_name  || null;
    const resolvedClientEmail = client_email || jobRow.client_email || null;

    await dbClient.query('BEGIN');

    const reportId = await generateReportId(dbClient);

    const result = await dbClient.query(
      `INSERT INTO reports
         (id, job_id, title, findings, recommendations, status, technician_id, report_date,
          po_number, location, serial_no, comments, client_id, client_name, client_email)
       VALUES ($1, $2, $3, $4, $5, 'Pending', $6, CURRENT_DATE, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        reportId, job_id, title.trim(),
        findings || null, recommendations || null, technician_id,
        po_number || null, location || null, serial_no || null, comments || null,
        resolvedClientId, resolvedClientName, resolvedClientEmail,
      ]
    );

    await dbClient.query('COMMIT');

    const createdReport = result.rows[0];
    createdReport.technician_name = techCheck.rows[0].name;

    // ── Send report email to client ───────────────────────────
    if (resolvedClientEmail) {
      const html = buildReportEmailHtml(createdReport);
      await sendNotification('report_submitted', {
        to:      resolvedClientEmail,
        subject: `Service Report ${reportId} — ${title.trim()} | Electromech Engineering`,
        html,
      });
    }

    // ── Fire real-time notification ───────────────────────────
    await notify({
      event:       'report_submitted',
      title:       'New Report Submitted',
      message:     `${reportId} — ${title.trim()} (Job: ${job_id})`,
      entity_type: 'report',
      entity_id:   reportId,
      roles:       ['admin', 'manager'],
    }, wsManager);

    await logActivity({
      type:         'report',
      action:       `Report ${reportId} submitted — ${title.trim()} (Job: ${job_id})`,
      entity_type:  'report',
      entity_id:    reportId,
      performed_by: req.user.id,
    });

    return res.status(201).json({
      success: true,
      message: `Report ${reportId} submitted successfully.${resolvedClientEmail ? ` Notification sent to ${resolvedClientEmail}.` : ''}`,
      data: createdReport,
    });

  } catch (error) {
    await dbClient.query('ROLLBACK');
    console.error('Create report error:', error);
    return Errors.internalError(res);
  } finally {
    dbClient.release();
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/reports/:id
// ────────────────────────────────────────────────────────────
const getReportById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT
         r.id, r.job_id,
         j.title         AS job_title,
         COALESCE(r.client_name, c.name) AS client_name,
         r.client_email, r.client_id,
         r.po_number, r.location, r.serial_no, r.comments,
         r.title, r.findings, r.recommendations, r.status,
         r.technician_id, t.name AS technician_name,
         r.approved_by_user_id, r.approved_at,
         r.report_date, r.created_at, r.updated_at
       FROM reports r
       LEFT JOIN jobs        j ON j.id = r.job_id
       LEFT JOIN clients     c ON c.id = COALESCE(r.client_id, j.client_id)
       LEFT JOIN technicians t ON t.id = r.technician_id
       WHERE r.id = $1`,
      [id]
    );

    if (result.rows.length === 0) return Errors.reportNotFound(res);

    const report = result.rows[0];

    // Fetch images
    const images = await pool.query(
      `SELECT id, file_name, file_url, mime_type, file_size_bytes, uploaded_at
       FROM report_images WHERE report_id = $1 ORDER BY uploaded_at ASC`,
      [id]
    );
    report.images = images.rows;

    // Fetch technical reports
    const techReports = await pool.query(
      `SELECT id, file_name, file_url, mime_type, file_size_bytes, uploaded_at
       FROM technical_reports WHERE report_id = $1 ORDER BY uploaded_at ASC`,
      [id]
    );
    report.technical_reports = techReports.rows;

    return res.status(200).json({ success: true, data: report });

  } catch (error) {
    console.error('Get report by ID error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// PATCH /api/reports/:id/status  — admin only
// ────────────────────────────────────────────────────────────
const updateReportStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejection_note } = req.body;

    if (!status) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'status is required.', { field: 'status' });
    }

    if (!isValidReportStatus(status)) {
      return sendError(res, 400, ERROR_CODES.INVALID_REPORT_STATUS,
        'Invalid status. Allowed values: Approved, Rejected.', { field: 'status' });
    }

    const existCheck = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.reportNotFound(res);

    const report = existCheck.rows[0];

    if (report.status !== 'Pending') {
      return sendError(res, 400, ERROR_CODES.REPORT_ALREADY_REVIEWED,
        `This report has already been ${report.status.toLowerCase()}. Only Pending reports can be reviewed.`);
    }

    const result = await pool.query(
      `UPDATE reports
       SET status = $1, approved_by_user_id = $2, approved_at = NOW()
       WHERE id = $3
       RETURNING id, status, approved_by_user_id, approved_at`,
      [status, req.user.id, id]
    );

    // ── Notify the technician ─────────────────────────────────
    const techUserRes = await pool.query(
      'SELECT t.user_id FROM technicians t JOIN reports r ON r.technician_id = t.id WHERE r.id = $1',
      [id]
    );
    if (techUserRes.rows[0]?.user_id) {
      await notify({
        event:       'report_reviewed',
        title:       `Report ${status}`,
        message:     `Your report ${id} was ${status.toLowerCase()} by admin`,
        entity_type: 'report',
        entity_id:   id,
        user_id:     techUserRes.rows[0].user_id,
      }, wsManager);
    }

    await logActivity({
      type:         'report',
      action:       `Report ${id} ${status.toLowerCase()} by admin`,
      entity_type:  'report',
      entity_id:    id,
      performed_by: req.user.id,
    });

    return res.status(200).json({
      success: true,
      message: `Report ${id} ${status.toLowerCase()} successfully.`,
      data: result.rows[0],
    });

  } catch (error) {
    console.error('Update report status error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/reports/:id/images
// ────────────────────────────────────────────────────────────
const addReportImage = async (req, res) => {
  try {
    const { id } = req.params;
    const images  = Array.isArray(req.body) ? req.body : [req.body];

    const existCheck = await pool.query('SELECT id, status FROM reports WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.reportNotFound(res);

    const countCheck = await pool.query(
      'SELECT COUNT(*) FROM report_images WHERE report_id = $1', [id]
    );
    const current = parseInt(countCheck.rows[0].count);
    if (current + images.length > 20) {
      return sendError(res, 400, ERROR_CODES.TOO_MANY_IMAGES,
        `Cannot add ${images.length} image(s). A report can have a maximum of 20 images (currently has ${current}).`);
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    for (const img of images) {
      if (!img.file_name || !img.file_url) {
        return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
          'Each image must have file_name and file_url.',
          { missing_fields: ['file_name', 'file_url'] });
      }
      if (img.mime_type && !allowed.includes(img.mime_type)) {
        return sendError(res, 400, ERROR_CODES.INVALID_FILE_TYPE,
          `Invalid file type "${img.mime_type}". Allowed: ${allowed.join(', ')}.`,
          { field: 'mime_type', allowed });
      }
    }

    const inserted = [];
    for (const img of images) {
      const r = await pool.query(
        `INSERT INTO report_images (report_id, file_name, file_url, mime_type, file_size_bytes, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, report_id, file_name, file_url, mime_type, file_size_bytes, uploaded_at`,
        [id, img.file_name, img.file_url, img.mime_type || 'image/jpeg', img.file_size_bytes || null, req.user.id]
      );
      inserted.push(r.rows[0]);
    }

    return res.status(201).json({
      success: true,
      message: `${inserted.length} image(s) added to report ${id}.`,
      data: inserted,
    });

  } catch (error) {
    console.error('Add report image error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// DELETE /api/reports/:id/images/:imageId
// ────────────────────────────────────────────────────────────
const deleteReportImage = async (req, res) => {
  try {
    const { id, imageId } = req.params;

    const existCheck = await pool.query(
      'SELECT id, status, technician_id FROM reports WHERE id = $1', [id]
    );
    if (existCheck.rows.length === 0) return Errors.reportNotFound(res);

    const report = existCheck.rows[0];

    if (req.user.role !== 'admin') {
      if (report.status !== 'Pending') {
        return sendError(res, 403, ERROR_CODES.FORBIDDEN,
          'Only admins can delete images from an approved or rejected report.');
      }
      const techCheck = await pool.query(
        'SELECT id FROM technicians WHERE id = $1 AND user_id = $2',
        [report.technician_id, req.user.id]
      );
      if (techCheck.rows.length === 0) {
        return sendError(res, 403, ERROR_CODES.FORBIDDEN,
          'You can only delete images from your own pending reports.');
      }
    }

    const imageCheck = await pool.query(
      'SELECT id FROM report_images WHERE id = $1 AND report_id = $2',
      [imageId, id]
    );
    if (imageCheck.rows.length === 0) {
      return sendError(res, 404, ERROR_CODES.REPORT_IMAGE_NOT_FOUND,
        'Image not found for this report.');
    }

    await pool.query('DELETE FROM report_images WHERE id = $1', [imageId]);

    return res.status(200).json({ success: true, message: 'Image deleted successfully.' });

  } catch (error) {
    console.error('Delete report image error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/reports/:id/technical-reports
// Upload/add technical report documents
// ────────────────────────────────────────────────────────────
const addTechnicalReports = async (req, res) => {
  try {
    const { id } = req.params;
    const docs = Array.isArray(req.body) ? req.body : [req.body];

    const existCheck = await pool.query('SELECT id, status FROM reports WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.reportNotFound(res);

    const allowedTypes = [
      'application/pdf',
      'image/jpeg', 'image/png', 'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    for (const doc of docs) {
      if (!doc.file_name || !doc.file_url) {
        return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
          'Each technical report must have file_name and file_url.',
          { missing_fields: ['file_name', 'file_url'] });
      }
      if (doc.mime_type && !allowedTypes.includes(doc.mime_type)) {
        return sendError(res, 400, ERROR_CODES.INVALID_FILE_TYPE,
          `Invalid file type "${doc.mime_type}". Allowed: PDF, images, Word documents.`,
          { field: 'mime_type', allowed: allowedTypes });
      }
    }

    const inserted = [];
    for (const doc of docs) {
      const r = await pool.query(
        `INSERT INTO technical_reports
           (report_id, file_name, file_url, mime_type, file_size_bytes, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, report_id, file_name, file_url, mime_type, file_size_bytes, uploaded_at`,
        [id, doc.file_name, doc.file_url, doc.mime_type || 'application/pdf',
         doc.file_size_bytes || null, req.user.id]
      );
      inserted.push(r.rows[0]);
    }

    return res.status(201).json({
      success: true,
      message: `${inserted.length} technical report(s) added to report ${id}.`,
      data: inserted,
    });

  } catch (error) {
    console.error('Add technical reports error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/reports/:id/technical-reports
// ────────────────────────────────────────────────────────────
const getTechnicalReports = async (req, res) => {
  try {
    const { id } = req.params;

    const existCheck = await pool.query('SELECT id FROM reports WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.reportNotFound(res);

    const result = await pool.query(
      `SELECT id, report_id, file_name, file_url, mime_type, file_size_bytes, uploaded_at
       FROM technical_reports WHERE report_id = $1 ORDER BY uploaded_at ASC`,
      [id]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
      total: result.rows.length,
    });

  } catch (error) {
    console.error('Get technical reports error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// DELETE /api/reports/:id/technical-reports/:docId
// ────────────────────────────────────────────────────────────
const deleteTechnicalReport = async (req, res) => {
  try {
    const { id, docId } = req.params;

    const existCheck = await pool.query(
      'SELECT id, status, technician_id FROM reports WHERE id = $1', [id]
    );
    if (existCheck.rows.length === 0) return Errors.reportNotFound(res);

    const docCheck = await pool.query(
      'SELECT id FROM technical_reports WHERE id = $1 AND report_id = $2',
      [docId, id]
    );
    if (docCheck.rows.length === 0) {
      return sendError(res, 404, ERROR_CODES.REPORT_IMAGE_NOT_FOUND,
        'Technical report document not found for this report.');
    }

    await pool.query('DELETE FROM technical_reports WHERE id = $1', [docId]);

    return res.status(200).json({ success: true, message: 'Technical report document deleted successfully.' });

  } catch (error) {
    console.error('Delete technical report error:', error);
    return Errors.internalError(res);
  }
};

module.exports = {
  getReports,
  createReport,
  getReportById,
  updateReportStatus,
  addReportImage,
  deleteReportImage,
  addTechnicalReports,
  getTechnicalReports,
  deleteTechnicalReport,
};