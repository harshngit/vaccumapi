// ============================================================
// src/controllers/reportController.js
// ============================================================

const pool = require('../config/db');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');
const { isValidReportStatus } = require('../utils/validators');
const { notify } = require('./notificationController');
const wsManager  = require('../config/websocketManager');

// ─── Helper: generate next report ID ─────────────────────────
const generateReportId = async (client) => {
  const result = await client.query(
    `SELECT id FROM reports ORDER BY id DESC LIMIT 1`
  );
  if (result.rows.length === 0) return 'RPT-0001';
  const lastNum = parseInt(result.rows[0].id.replace('RPT-', ''), 10);
  return `RPT-${String(lastNum + 1).padStart(4, '0')}`;
};

// ────────────────────────────────────────────────────────────
// GET /api/reports
// ────────────────────────────────────────────────────────────
const getReports = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const { status, technician_id, job_id, from_date, to_date } = req.query;

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
         c.name          AS client_name,
         r.title, r.findings, r.recommendations, r.status,
         r.technician_id, t.name AS technician_name,
         r.approved_by_user_id, r.approved_at,
         r.report_date,
         (SELECT COUNT(*) FROM report_images ri WHERE ri.report_id = r.id) AS image_count,
         r.created_at, r.updated_at
       FROM reports r
       LEFT JOIN jobs        j ON j.id = r.job_id
       LEFT JOIN clients     c ON c.id = j.client_id
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
    const { job_id, title, findings, recommendations, technician_id } = req.body;

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
    const jobCheck = await dbClient.query('SELECT id FROM jobs WHERE id = $1', [job_id]);
    if (jobCheck.rows.length === 0) return Errors.jobNotFound(res);

    // Validate technician exists
    const techCheck = await dbClient.query(
      'SELECT id FROM technicians WHERE id = $1', [technician_id]
    );
    if (techCheck.rows.length === 0) return Errors.technicianNotFound(res);

    await dbClient.query('BEGIN');

    const reportId = await generateReportId(dbClient);

    const result = await dbClient.query(
      `INSERT INTO reports
         (id, job_id, title, findings, recommendations, status, technician_id, report_date)
       VALUES ($1, $2, $3, $4, $5, 'Pending', $6, CURRENT_DATE)
       RETURNING *`,
      [reportId, job_id, title.trim(), findings || null, recommendations || null, technician_id]
    );

    await dbClient.query('COMMIT');

    // ── Fire real-time notification: report_submitted ─────
    await notify({
      event:       'report_submitted',
      title:       'New Report Submitted',
      message:     `${reportId} — ${title.trim()} (Job: ${job_id})`,
      entity_type: 'report',
      entity_id:   reportId,
      roles:       ['admin', 'manager'],
    }, wsManager);

    return res.status(201).json({
      success: true,
      message: `Report ${reportId} submitted successfully.`,
      data: result.rows[0],
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
         c.name          AS client_name,
         r.title, r.findings, r.recommendations, r.status,
         r.technician_id, t.name AS technician_name,
         r.approved_by_user_id, r.approved_at,
         r.report_date, r.created_at, r.updated_at
       FROM reports r
       LEFT JOIN jobs        j ON j.id = r.job_id
       LEFT JOIN clients     c ON c.id = j.client_id
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

    return res.status(200).json({ success: true, data: report });

  } catch (error) {
    console.error('Get report by ID error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// PATCH /api/reports/:id/status  — admin only: approve or reject
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

    // ── Fire real-time notification: report_reviewed ────────
    // Notify the technician who submitted the report
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

    // Max 20 images per report
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
        [
          id,
          img.file_name,
          img.file_url,
          img.mime_type || 'image/jpeg',
          img.file_size_bytes || null,
          req.user.id,
        ]
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

    // Only the submitting technician (while Pending) or admin can delete
    if (req.user.role !== 'admin') {
      if (report.status !== 'Pending') {
        return sendError(res, 403, ERROR_CODES.FORBIDDEN,
          'Only admins can delete images from an approved or rejected report.');
      }
      // Check if this user is the linked technician
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

    return res.status(200).json({
      success: true,
      message: 'Image deleted successfully.',
    });

  } catch (error) {
    console.error('Delete report image error:', error);
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
};