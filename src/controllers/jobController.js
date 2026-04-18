// ============================================================
// src/controllers/jobController.js
// ============================================================

const pool = require('../config/db');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');
const {
  isValidJobStatus,
  isValidJobPriority,
  isValidJobCategory,
  isValidStatusTransition,
  JOB_STATUS_TRANSITIONS,
} = require('../utils/validators');
const { notify } = require('./notificationController');
const wsManager  = require('../config/websocketManager');
const { logActivity } = require('./activityController');

// ─── Helper: generate next job ID ────────────────────────────
const generateJobId = async (client) => {
  const result = await client.query(
    `SELECT id FROM jobs ORDER BY id DESC LIMIT 1`
  );
  if (result.rows.length === 0) return 'JOB-0001';
  const lastNum = parseInt(result.rows[0].id.replace('JOB-', ''), 10);
  return `JOB-${String(lastNum + 1).padStart(4, '0')}`;
};

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
// GET /api/jobs
// ────────────────────────────────────────────────────────────
const getJobs = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const { status, priority, category, client_id, technician_id, search, from_date, to_date } = req.query;

    if (status && !isValidJobStatus(status)) {
      return sendError(res, 400, ERROR_CODES.INVALID_JOB_STATUS,
        'Invalid status. Allowed: Raised, Assigned, In Progress, Closed.',
        { field: 'status' });
    }
    if (priority && !isValidJobPriority(priority)) {
      return sendError(res, 400, ERROR_CODES.INVALID_JOB_PRIORITY,
        'Invalid priority. Allowed: Low, Medium, High, Critical.',
        { field: 'priority' });
    }
    if (category && !isValidJobCategory(category)) {
      return sendError(res, 400, ERROR_CODES.INVALID_JOB_CATEGORY,
        'Invalid category. Allowed: Maintenance, Repair, Installation, Inspection.',
        { field: 'category' });
    }

    const conditions = [];
    const values     = [];

    if (status) {
      values.push(status);
      conditions.push(`j.status = $${values.length}`);
    }
    if (priority) {
      values.push(priority);
      conditions.push(`j.priority = $${values.length}`);
    }
    if (category) {
      values.push(category);
      conditions.push(`j.category = $${values.length}`);
    }
    if (client_id) {
      values.push(parseInt(client_id));
      conditions.push(`j.client_id = $${values.length}`);
    }
    if (technician_id) {
      values.push(parseInt(technician_id));
      conditions.push(`j.technician_id = $${values.length}`);
    }
    if (from_date) {
      values.push(from_date);
      conditions.push(`j.raised_date >= $${values.length}`);
    }
    if (to_date) {
      values.push(to_date);
      conditions.push(`j.raised_date <= $${values.length}`);
    }
    if (search) {
      values.push(`%${search.toLowerCase()}%`);
      const idx = values.length;
      conditions.push(`(LOWER(j.id) LIKE $${idx} OR LOWER(j.title) LIKE $${idx})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM jobs j ${where}`, values
    );
    const total = parseInt(countResult.rows[0].count);

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT
         j.id, j.title, j.description,
         j.client_id,     c.name  AS client_name,
         j.technician_id, t.name  AS technician_name,
         j.status, j.priority, j.category, j.amount,
         j.raised_date, j.scheduled_date, j.closed_date,
         j.raised_by_user_id,
         (SELECT COUNT(*) FROM job_images ji WHERE ji.job_id = j.id) AS image_count,
         j.created_at, j.updated_at
       FROM jobs j
       LEFT JOIN clients     c ON c.id = j.client_id
       LEFT JOIN technicians t ON t.id = j.technician_id
       ${where}
       ORDER BY j.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: { total, page, limit, total_pages: Math.ceil(total / limit) },
    });

  } catch (error) {
    console.error('Get jobs error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/jobs
// ────────────────────────────────────────────────────────────
const createJob = async (req, res) => {
  const dbClient = await pool.connect();
  try {
    const {
      title, description, client_id, technician_id,
      priority = 'Medium', category = 'Maintenance',
      scheduled_date, amount = 0,
    } = req.body;

    const missing = [];
    if (!title)     missing.push('title');
    if (!client_id) missing.push('client_id');
    if (missing.length > 0) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        `Please fill in all required fields: ${missing.join(', ')}.`,
        { missing_fields: missing });
    }

    if (!isValidJobPriority(priority)) {
      return sendError(res, 400, ERROR_CODES.INVALID_JOB_PRIORITY,
        'Invalid priority. Allowed: Low, Medium, High, Critical.', { field: 'priority' });
    }
    if (!isValidJobCategory(category)) {
      return sendError(res, 400, ERROR_CODES.INVALID_JOB_CATEGORY,
        'Invalid category. Allowed: Maintenance, Repair, Installation, Inspection.', { field: 'category' });
    }

    // Validate client exists
    const clientCheck = await dbClient.query('SELECT id FROM clients WHERE id = $1', [client_id]);
    if (clientCheck.rows.length === 0) return Errors.clientNotFound(res);

    // Validate technician if provided
    if (technician_id) {
      const techCheck = await dbClient.query(
        'SELECT id FROM technicians WHERE id = $1', [technician_id]
      );
      if (techCheck.rows.length === 0) return Errors.technicianNotFound(res);
    }

    await dbClient.query('BEGIN');

    const jobId = await generateJobId(dbClient);
    // If technician is assigned at creation, status becomes Assigned
    const status = technician_id ? 'Assigned' : 'Raised';

    const result = await dbClient.query(
      `INSERT INTO jobs
         (id, title, description, client_id, technician_id, status, priority,
          category, amount, raised_date, scheduled_date, raised_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, $10, $11)
       RETURNING *`,
      [
        jobId, title.trim(), description || null,
        client_id, technician_id || null,
        status, priority, category,
        parseFloat(amount) || 0,
        scheduled_date || null,
        req.user.id,
      ]
    );

    await dbClient.query('COMMIT');

    // ── Fire real-time notification: job_raised ───────────
    const clientName = clientCheck.rows[0]?.name || 'Unknown Client';
    await notify({
      event:       'job_raised',
      title:       'New Job Raised',
      message:     `${jobId} — ${title.trim()} (${clientName})`,
      entity_type: 'job',
      entity_id:   jobId,
      roles:       ['admin', 'manager', 'engineer'],
    }, wsManager);

    // ── Activity log ──────────────────────────────────────
    await logActivity({
      type:         'job',
      action:       `Job ${jobId} raised — ${title.trim()} (${clientName})`,
      entity_type:  'job',
      entity_id:    jobId,
      performed_by: req.user.id,
    });

    return res.status(201).json({
      success: true,
      message: `Job ${jobId} raised successfully.`,
      data: result.rows[0],
    });

  } catch (error) {
    await dbClient.query('ROLLBACK');
    console.error('Create job error:', error);
    return Errors.internalError(res);
  } finally {
    dbClient.release();
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/jobs/:id
// ────────────────────────────────────────────────────────────
const getJobById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT
         j.id, j.title, j.description,
         j.client_id,     c.name AS client_name,
         j.technician_id, t.name AS technician_name,
         j.status, j.priority, j.category, j.amount,
         j.raised_date, j.scheduled_date, j.closed_date,
         j.raised_by_user_id,
         j.created_at, j.updated_at
       FROM jobs j
       LEFT JOIN clients     c ON c.id = j.client_id
       LEFT JOIN technicians t ON t.id = j.technician_id
       WHERE j.id = $1`,
      [id]
    );

    if (result.rows.length === 0) return Errors.jobNotFound(res);

    const job = result.rows[0];

    // Fetch images
    const images = await pool.query(
      `SELECT id, file_name, file_url, mime_type, file_size_bytes, uploaded_at
       FROM job_images WHERE job_id = $1 ORDER BY uploaded_at ASC`,
      [id]
    );

    // Fetch linked reports (summary)
    const reports = await pool.query(
      `SELECT id, title, status, report_date
       FROM reports WHERE job_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    job.images  = images.rows;
    job.reports = reports.rows;

    return res.status(200).json({ success: true, data: job });

  } catch (error) {
    console.error('Get job by ID error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// PUT /api/jobs/:id  — update details (NOT status)
// ────────────────────────────────────────────────────────────
const updateJob = async (req, res) => {
  try {
    const { id } = req.params;

    const existCheck = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.jobNotFound(res);

    const cur = existCheck.rows[0];
    const { title, description, technician_id, priority, category, scheduled_date, amount } = req.body;

    if (!title && description === undefined && technician_id === undefined &&
        !priority && !category && scheduled_date === undefined && amount === undefined) {
      return sendError(res, 400, ERROR_CODES.NO_FIELDS_TO_UPDATE,
        'No fields provided to update.');
    }

    if (priority && !isValidJobPriority(priority)) {
      return sendError(res, 400, ERROR_CODES.INVALID_JOB_PRIORITY,
        'Invalid priority. Allowed: Low, Medium, High, Critical.', { field: 'priority' });
    }
    if (category && !isValidJobCategory(category)) {
      return sendError(res, 400, ERROR_CODES.INVALID_JOB_CATEGORY,
        'Invalid category. Allowed: Maintenance, Repair, Installation, Inspection.', { field: 'category' });
    }

    if (technician_id) {
      const techCheck = await pool.query(
        'SELECT id FROM technicians WHERE id = $1', [technician_id]
      );
      if (techCheck.rows.length === 0) return Errors.technicianNotFound(res);
    }

    const newTitle         = title          ? title.trim()      : cur.title;
    const newDescription   = description    !== undefined       ? description   : cur.description;
    const newTechnicianId  = technician_id  !== undefined       ? technician_id : cur.technician_id;
    const newPriority      = priority       || cur.priority;
    const newCategory      = category       || cur.category;
    const newScheduledDate = scheduled_date !== undefined       ? scheduled_date : cur.scheduled_date;
    const newAmount        = amount         !== undefined       ? parseFloat(amount) : cur.amount;

    // If technician being assigned for first time and job is still Raised → auto-advance to Assigned
    let newStatus = cur.status;
    if (newTechnicianId && !cur.technician_id && cur.status === 'Raised') {
      newStatus = 'Assigned';
    }

    const result = await pool.query(
      `UPDATE jobs
       SET title=$1, description=$2, technician_id=$3, priority=$4,
           category=$5, scheduled_date=$6, amount=$7, status=$8
       WHERE id=$9
       RETURNING *`,
      [newTitle, newDescription, newTechnicianId, newPriority,
       newCategory, newScheduledDate, newAmount, newStatus, id]
    );

    return res.status(200).json({
      success: true,
      message: 'Job updated successfully.',
      data: result.rows[0],
    });

  } catch (error) {
    console.error('Update job error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// PATCH /api/jobs/:id/status  — advance pipeline status
// ────────────────────────────────────────────────────────────
const updateJobStatus = async (req, res) => {
  const dbClient = await pool.connect();
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'status is required.', { field: 'status' });
    }

    if (!isValidJobStatus(status)) {
      return sendError(res, 400, ERROR_CODES.INVALID_JOB_STATUS,
        'Invalid status. Allowed: Raised, Assigned, In Progress, Closed.',
        { field: 'status' });
    }

    const existCheck = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.jobNotFound(res);

    const job = existCheck.rows[0];

    // Technicians can only advance their own assigned jobs
    if (req.user.role === 'technician') {
      const techRow = await pool.query(
        'SELECT id FROM technicians WHERE user_id = $1', [req.user.id]
      );
      if (!techRow.rows.length || techRow.rows[0].id !== job.technician_id) {
        return Errors.forbidden(res);
      }
    }

    // Validate forward-only transition
    if (!isValidStatusTransition(job.status, status)) {
      return sendError(res, 400, ERROR_CODES.INVALID_STATUS_TRANSITION,
        `Invalid transition. Job is currently "${job.status}". Next allowed status is "${JOB_STATUS_TRANSITIONS[job.status] || 'none (already Closed)'}".`,
        { current_status: job.status, allowed_next: JOB_STATUS_TRANSITIONS[job.status] || null });
    }

    // Cannot close without a technician
    if (status === 'Closed' && !job.technician_id) {
      return sendError(res, 400, ERROR_CODES.JOB_NEEDS_TECHNICIAN,
        'Cannot close a job that has no assigned technician.');
    }

    await dbClient.query('BEGIN');

    // Set closed_date when closing
    const closedDate = status === 'Closed' ? 'CURRENT_DATE' : 'NULL';
    const result = await dbClient.query(
      `UPDATE jobs
       SET status = $1,
           closed_date = ${closedDate === 'CURRENT_DATE' ? 'CURRENT_DATE' : 'NULL'}
       WHERE id = $2
       RETURNING id, status, closed_date, updated_at`,
      [status, id]
    );

    // Increment technician jobs_completed when closing
    if (status === 'Closed' && job.technician_id) {
      await dbClient.query(
        `UPDATE technicians SET jobs_completed = jobs_completed + 1 WHERE id = $1`,
        [job.technician_id]
      );
    }

    await dbClient.query('COMMIT');

    // ── Fire real-time notification: job_status ───────────
    const statusTitle =
      status === 'Closed' ? 'Job Closed' :
      status === 'In Progress' ? 'Job In Progress' :
      status === 'Assigned' ? 'Job Assigned' : 'Job Status Updated';
    await notify({
      event:       'job_status',
      title:       statusTitle,
      message:     `${id} moved to "${status}"`,
      entity_type: 'job',
      entity_id:   id,
      roles:       ['admin', 'manager', 'engineer'],
    }, wsManager);

    // Also notify the assigned technician if closing
    if (status === 'Closed' && job.technician_id) {
      const techUserRes = await pool.query(
        'SELECT user_id FROM technicians WHERE id = $1', [job.technician_id]
      );
      if (techUserRes.rows[0]?.user_id) {
        await notify({
          event:       'job_status',
          title:       'Your Job Was Closed',
          message:     `${id} has been marked as Closed`,
          entity_type: 'job',
          entity_id:   id,
          user_id:     techUserRes.rows[0].user_id,
        }, wsManager);
      }
    }

    // ── Activity log ──────────────────────────────────────
    await logActivity({
      type:         'job',
      action:       `Job ${id} status changed to "${status}"`,
      entity_type:  'job',
      entity_id:    id,
      performed_by: req.user.id,
    });

    return res.status(200).json({
      success: true,
      message: `Job status updated to "${status}".`,
      data: result.rows[0],
    });

  } catch (error) {
    await dbClient.query('ROLLBACK');
    console.error('Update job status error:', error);
    return Errors.internalError(res);
  } finally {
    dbClient.release();
  }
};

// ────────────────────────────────────────────────────────────
// DELETE /api/jobs/:id  — admin only
// ────────────────────────────────────────────────────────────
const deleteJob = async (req, res) => {
  try {
    const { id } = req.params;

    const existCheck = await pool.query('SELECT id FROM jobs WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.jobNotFound(res);

    // Cannot delete if reports exist
    const reportsCheck = await pool.query(
      'SELECT id FROM reports WHERE job_id = $1 LIMIT 1', [id]
    );
    if (reportsCheck.rows.length > 0) {
      return sendError(res, 409, ERROR_CODES.JOB_HAS_REPORTS,
        'Cannot delete this job because it has attached reports. Remove the reports first.');
    }

    await pool.query('DELETE FROM jobs WHERE id = $1', [id]);

    return res.status(200).json({
      success: true,
      message: `Job ${id} deleted successfully.`,
    });

  } catch (error) {
    console.error('Delete job error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/jobs/:id/images
// Accepts: JSON body with { file_name, file_url, mime_type, file_size_bytes }
// (Actual S3 upload handled by frontend/separate upload service)
// ────────────────────────────────────────────────────────────
const addJobImage = async (req, res) => {
  try {
    const { id } = req.params;
    const images  = Array.isArray(req.body) ? req.body : [req.body];

    const existCheck = await pool.query('SELECT id FROM jobs WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.jobNotFound(res);

    // Max 20 images per job
    const countCheck = await pool.query(
      'SELECT COUNT(*) FROM job_images WHERE job_id = $1', [id]
    );
    const current = parseInt(countCheck.rows[0].count);
    if (current + images.length > 20) {
      return sendError(res, 400, ERROR_CODES.TOO_MANY_IMAGES,
        `Cannot add ${images.length} image(s). A job can have a maximum of 20 images (currently has ${current}).`);
    }

    // Validate each image entry
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
        `INSERT INTO job_images (job_id, file_name, file_url, mime_type, file_size_bytes, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, job_id, file_name, file_url, mime_type, file_size_bytes, uploaded_at`,
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
      message: `${inserted.length} image(s) added to job ${id}.`,
      data: inserted,
    });

  } catch (error) {
    console.error('Add job image error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// DELETE /api/jobs/:id/images/:imageId
// ────────────────────────────────────────────────────────────
const deleteJobImage = async (req, res) => {
  try {
    const { id, imageId } = req.params;

    const existCheck = await pool.query('SELECT id FROM jobs WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.jobNotFound(res);

    const imageCheck = await pool.query(
      'SELECT id FROM job_images WHERE id = $1 AND job_id = $2',
      [imageId, id]
    );
    if (imageCheck.rows.length === 0) {
      return sendError(res, 404, ERROR_CODES.JOB_IMAGE_NOT_FOUND,
        'Image not found for this job.');
    }

    await pool.query('DELETE FROM job_images WHERE id = $1', [imageId]);

    return res.status(200).json({
      success: true,
      message: 'Image deleted successfully.',
    });

  } catch (error) {
    console.error('Delete job image error:', error);
    return Errors.internalError(res);
  }
};

module.exports = {
  getJobs,
  createJob,
  getJobById,
  updateJob,
  updateJobStatus,
  deleteJob,
  addJobImage,
  deleteJobImage,
};