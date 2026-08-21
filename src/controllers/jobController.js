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
const { notifyTechnicianJobAssignment, notifyJobCancellation } = require('./whatsappController');

// ─── Helper: generate next job ID ────────────────────────────
const generateJobId = async (client) => {
  const result = await client.query(
    `SELECT id FROM jobs ORDER BY id DESC LIMIT 1`
  );
  if (result.rows.length === 0) return 'JOB-0001';
  const lastNum = parseInt(result.rows[0].id.replace('JOB-', ''), 10);
  return `JOB-${String(lastNum + 1).padStart(4, '0')}`;
};

// ────────────────────────────────────────────────────────────
// GET /api/jobs
// ────────────────────────────────────────────────────────────
const getJobs = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const { status, priority, category, client_id, technician_id, amc_id, search, from_date, to_date } = req.query;

    if (status   && !isValidJobStatus(status))   return sendError(res, 400, ERROR_CODES.INVALID_JOB_STATUS,   'Invalid status. Allowed: Raised, Assigned, In Progress, Closed.',               { field: 'status' });
    if (priority && !isValidJobPriority(priority)) return sendError(res, 400, ERROR_CODES.INVALID_JOB_PRIORITY, 'Invalid priority. Allowed: Low, Medium, High, Critical.',                       { field: 'priority' });
    if (category && !isValidJobCategory(category)) return sendError(res, 400, ERROR_CODES.INVALID_JOB_CATEGORY, 'Invalid category. Allowed: Service, AMC Visit, Breakdown, Installation & Commissioning, Inspection, Workshop.',     { field: 'category' });

    const conditions = [];
    const values     = [];

    if (status)        { values.push(status);              conditions.push(`j.status = $${values.length}`); }
    if (priority)      { values.push(priority);            conditions.push(`j.priority = $${values.length}`); }
    if (category)      { values.push(category);            conditions.push(`j.category = $${values.length}`); }
    if (client_id)     { values.push(parseInt(client_id)); conditions.push(`j.client_id = $${values.length}`); }
    if (technician_id) { values.push(parseInt(technician_id)); conditions.push(`j.technician_id = $${values.length}`); }
    if (amc_id)        { values.push(amc_id);              conditions.push(`j.amc_id = $${values.length}`); }
    if (from_date)     { values.push(from_date);           conditions.push(`j.raised_date >= $${values.length}`); }
    if (to_date)       { values.push(to_date);             conditions.push(`j.raised_date <= $${values.length}`); }
    if (search) {
      values.push(`%${search.toLowerCase()}%`);
      const idx = values.length;
      conditions.push(`(LOWER(j.id) LIKE $${idx} OR LOWER(j.title) LIKE $${idx})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM jobs j ${where}`, values);
    const total = parseInt(countResult.rows[0].count);

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT
         j.id, j.title, j.description,
         j.client_id, c.name AS client_name,
         j.amc_id,    a.title AS amc_title,
         j.status, j.priority, j.category, j.amount,
         j.raised_date, j.scheduled_date, j.start_date, j.end_date, j.closed_date,
         j.raised_by_user_id,
         (SELECT COUNT(*) FROM job_images ji WHERE ji.job_id = j.id) AS image_count,
         (
           SELECT COALESCE(json_agg(json_build_object('id', t2.id, 'name', t2.name, 'phone', t2.phone) ORDER BY jt.assigned_at), '[]'::json)
           FROM job_technicians jt
           JOIN technicians t2 ON t2.id = jt.technician_id
           WHERE jt.job_id = j.id
         ) AS technicians,
         j.created_at, j.updated_at
       FROM jobs j
       LEFT JOIN clients       c ON c.id = j.client_id
       LEFT JOIN amc_contracts a ON a.id = j.amc_id
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
// GET /api/jobs/by-user/:user_id
// Returns all jobs assigned to the technician linked to this user_id
// ────────────────────────────────────────────────────────────
const getJobsByUser = async (req, res) => {
  try {
    const { user_id } = req.params;
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const { status } = req.query;

    // Resolve technician from user_id
    const techRow = await pool.query(
      'SELECT id, name FROM technicians WHERE user_id = $1', [parseInt(user_id)]
    );
    if (techRow.rows.length === 0) {
      return sendError(res, 404, ERROR_CODES.TECHNICIAN_NOT_FOUND,
        `No technician profile found for user_id ${user_id}.`);
    }
    const technician = techRow.rows[0];

    const conditions = [`EXISTS (SELECT 1 FROM job_technicians jt WHERE jt.job_id = j.id AND jt.technician_id = $1)`];
    const values     = [technician.id];

    if (status) {
      if (!isValidJobStatus(status)) {
        return sendError(res, 400, ERROR_CODES.INVALID_JOB_STATUS,
          'Invalid status. Allowed: Raised, Assigned, In Progress, Closed.', { field: 'status' });
      }
      values.push(status);
      conditions.push(`j.status = $${values.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await pool.query(`SELECT COUNT(*) FROM jobs j ${where}`, values);
    const total = parseInt(countResult.rows[0].count);

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT
         j.id, j.title, j.description,
         j.client_id, c.name AS client_name,
         j.amc_id,    a.title AS amc_title,
         j.status, j.priority, j.category, j.amount,
         j.raised_date, j.scheduled_date, j.start_date, j.end_date, j.closed_date,
         j.raised_by_user_id,
         (SELECT COUNT(*) FROM job_images ji WHERE ji.job_id = j.id) AS image_count,
         (
           SELECT COALESCE(json_agg(json_build_object('id', t2.id, 'name', t2.name, 'phone', t2.phone) ORDER BY jt.assigned_at), '[]'::json)
           FROM job_technicians jt
           JOIN technicians t2 ON t2.id = jt.technician_id
           WHERE jt.job_id = j.id
         ) AS technicians,
         j.created_at, j.updated_at
       FROM jobs j
       LEFT JOIN clients       c ON c.id = j.client_id
       LEFT JOIN amc_contracts a ON a.id = j.amc_id
       ${where}
       ORDER BY j.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
      technician: { id: technician.id, name: technician.name, user_id: parseInt(user_id) },
      pagination: { total, page, limit, total_pages: Math.ceil(total / limit) },
    });

  } catch (error) {
    console.error('Get jobs by user error:', error);
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
      title, description, client_id,
      technician_ids,           // array: [1, 2, 3]
      priority = 'Medium', category = 'Service',
      scheduled_date,           // single-day mode
      start_date, end_date,     // date-range mode
      amount = 0, amc_id,
    } = req.body;

    // Normalise technician_ids — accept array or single value
    const techIds = Array.isArray(technician_ids)
      ? technician_ids.map(Number).filter(Boolean)
      : technician_ids ? [Number(technician_ids)] : [];

    const missing = [];
    if (!title)     missing.push('title');
    if (!client_id) missing.push('client_id');
    if (missing.length > 0) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        `Please fill in all required fields: ${missing.join(', ')}.`,
        { missing_fields: missing });
    }

    // Date validation: use either scheduled_date OR start_date/end_date, not both
    if (scheduled_date && (start_date || end_date)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Use either scheduled_date (single day) OR start_date + end_date (range), not both.',
        { fields: ['scheduled_date', 'start_date', 'end_date'] });
    }
    if ((start_date && !end_date) || (!start_date && end_date)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Provide both start_date and end_date together.',
        { fields: ['start_date', 'end_date'] });
    }
    if (start_date && end_date && new Date(end_date) < new Date(start_date)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'end_date must be on or after start_date.', { field: 'end_date' });
    }

    if (!isValidJobPriority(priority)) {
      return sendError(res, 400, ERROR_CODES.INVALID_JOB_PRIORITY,
        'Invalid priority. Allowed: Low, Medium, High, Critical.', { field: 'priority' });
    }
    if (!isValidJobCategory(category)) {
      return sendError(res, 400, ERROR_CODES.INVALID_JOB_CATEGORY,
        'Invalid category. Allowed: Service, AMC Visit, Breakdown, Installation & Commissioning, Inspection, Workshop, Office, Trial.', { field: 'category' });
    }

    const clientCheck = await dbClient.query('SELECT id, name FROM clients WHERE id = $1', [client_id]);
    if (clientCheck.rows.length === 0) return Errors.clientNotFound(res);

    // Validate all technician IDs
    for (const tid of techIds) {
      const techCheck = await dbClient.query('SELECT id FROM technicians WHERE id = $1', [tid]);
      if (techCheck.rows.length === 0) {
        return sendError(res, 404, ERROR_CODES.TECHNICIAN_NOT_FOUND,
          `Technician with ID ${tid} not found.`, { field: 'technician_ids' });
      }
    }

    if (amc_id) {
      const amcCheck = await dbClient.query('SELECT id FROM amc_contracts WHERE id = $1', [amc_id]);
      if (amcCheck.rows.length === 0) {
        return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
          `AMC contract "${amc_id}" not found.`, { field: 'amc_id' });
      }
    }

    await dbClient.query('BEGIN');

    const jobId          = await generateJobId(dbClient);
    const primaryTechId  = techIds[0] || null;
    const status         = primaryTechId ? 'Assigned' : 'Raised';

    const result = await dbClient.query(
      `INSERT INTO jobs
         (id, title, description, client_id, technician_id, amc_id, status, priority,
          category, amount, raised_date, scheduled_date, start_date, end_date, raised_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_DATE, $11, $12, $13, $14)
       RETURNING *`,
      [
        jobId, title.trim(), description || null,
        client_id, primaryTechId, amc_id || null,
        status, priority, category,
        parseFloat(amount) || 0,
        scheduled_date || null,
        start_date || null, end_date || null,
        req.user.id,
      ]
    );

    // Insert all technicians into junction table
    for (const tid of techIds) {
      await dbClient.query(
        `INSERT INTO job_technicians (job_id, technician_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [jobId, tid]
      );
    }

    await dbClient.query('COMMIT');

    const clientName = clientCheck.rows[0]?.name || 'Unknown Client';
    await notify({
      event: 'job_raised', title: 'New Job Raised',
      message: `${jobId} — ${title.trim()} (${clientName})`,
      entity_type: 'job', entity_id: jobId, roles: ['admin', 'manager', 'engineer'],
    }, wsManager);

    await logActivity({
      type: 'job', action: `Job ${jobId} raised — ${title.trim()} (${clientName})`,
      entity_type: 'job', entity_id: jobId, performed_by: req.user.id,
    });

    for (const tid of techIds) {
      notifyTechnicianJobAssignment(jobId, tid)
        .catch(e => console.error('[WhatsApp] job assign notify', e.message));
    }

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
         j.client_id, c.name AS client_name,
         j.amc_id,    a.title AS amc_title,
         a.status AS amc_status, a.po_number AS amc_po_number,
         j.status, j.priority, j.category, j.amount,
         j.raised_date, j.scheduled_date, j.start_date, j.end_date, j.closed_date,
         j.raised_by_user_id,
         (
           SELECT COALESCE(json_agg(json_build_object('id', t2.id, 'name', t2.name, 'phone', t2.phone) ORDER BY jt.assigned_at), '[]'::json)
           FROM job_technicians jt
           JOIN technicians t2 ON t2.id = jt.technician_id
           WHERE jt.job_id = j.id
         ) AS technicians,
         j.created_at, j.updated_at
       FROM jobs j
       LEFT JOIN clients       c ON c.id = j.client_id
       LEFT JOIN amc_contracts a ON a.id = j.amc_id
       WHERE j.id = $1`,
      [id]
    );

    if (result.rows.length === 0) return Errors.jobNotFound(res);

    const job = result.rows[0];

    const images = await pool.query(
      `SELECT id, file_name, file_url, mime_type, file_size_bytes, uploaded_at
       FROM job_images WHERE job_id = $1 ORDER BY uploaded_at ASC`,
      [id]
    );

    const reports = await pool.query(
      `SELECT id, title, status, report_date FROM reports WHERE job_id = $1 ORDER BY created_at DESC`,
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
// PUT /api/jobs/:id
// ────────────────────────────────────────────────────────────
const updateJob = async (req, res) => {
  try {
    const { id } = req.params;

    const existCheck = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.jobNotFound(res);

    const cur = existCheck.rows[0];
    const {
      title, description, priority, category,
      scheduled_date, start_date, end_date,
      amount, amc_id, technician_ids,
    } = req.body;

    const hasTechIds = technician_ids !== undefined;
    const techIds    = hasTechIds
      ? (Array.isArray(technician_ids) ? technician_ids.map(Number).filter(Boolean) : technician_ids ? [Number(technician_ids)] : [])
      : null;

    if (!title && description === undefined && !priority && !category &&
        scheduled_date === undefined && start_date === undefined && end_date === undefined &&
        amount === undefined && amc_id === undefined && !hasTechIds) {
      return sendError(res, 400, ERROR_CODES.NO_FIELDS_TO_UPDATE, 'No fields provided to update.');
    }

    if (priority && !isValidJobPriority(priority)) {
      return sendError(res, 400, ERROR_CODES.INVALID_JOB_PRIORITY,
        'Invalid priority. Allowed: Low, Medium, High, Critical.', { field: 'priority' });
    }
    if (category && !isValidJobCategory(category)) {
      return sendError(res, 400, ERROR_CODES.INVALID_JOB_CATEGORY,
        'Invalid category.', { field: 'category' });
    }

    // Date mode validation
    if (scheduled_date !== undefined && (start_date !== undefined || end_date !== undefined)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Use either scheduled_date OR start_date + end_date, not both.');
    }

    if (hasTechIds && techIds) {
      for (const tid of techIds) {
        const techCheck = await pool.query('SELECT id FROM technicians WHERE id = $1', [tid]);
        if (techCheck.rows.length === 0) {
          return sendError(res, 404, ERROR_CODES.TECHNICIAN_NOT_FOUND,
            `Technician with ID ${tid} not found.`, { field: 'technician_ids' });
        }
      }
    }

    if (amc_id) {
      const amcCheck = await pool.query('SELECT id FROM amc_contracts WHERE id = $1', [amc_id]);
      if (amcCheck.rows.length === 0) {
        return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
          `AMC contract "${amc_id}" not found.`, { field: 'amc_id' });
      }
    }

    const newTitle         = title          ? title.trim()              : cur.title;
    const newDescription   = description    !== undefined               ? description          : cur.description;
    const newPriority      = priority       || cur.priority;
    const newCategory      = category       || cur.category;
    const newScheduledDate = scheduled_date !== undefined               ? (scheduled_date || null) : cur.scheduled_date;
    const newStartDate     = start_date     !== undefined               ? (start_date     || null) : cur.start_date;
    const newEndDate       = end_date       !== undefined               ? (end_date       || null) : cur.end_date;
    const newAmount        = amount         !== undefined               ? parseFloat(amount)       : cur.amount;
    const newAmcId         = amc_id         !== undefined               ? (amc_id || null)         : cur.amc_id;
    const primaryTechId    = hasTechIds     ? (techIds[0] || null)      : cur.technician_id;

    let newStatus = cur.status;
    if (primaryTechId && !cur.technician_id && cur.status === 'Raised') {
      newStatus = 'Assigned';
    }

    const dbClient = await pool.connect();
    try {
      await dbClient.query('BEGIN');

      const result = await dbClient.query(
        `UPDATE jobs
         SET title=$1, description=$2, technician_id=$3, priority=$4, category=$5,
             scheduled_date=$6, start_date=$7, end_date=$8, amount=$9, status=$10, amc_id=$11
         WHERE id=$12
         RETURNING *`,
        [newTitle, newDescription, primaryTechId, newPriority, newCategory,
         newScheduledDate, newStartDate, newEndDate, newAmount, newStatus, newAmcId, id]
      );

      // Replace technician assignments only if technician_ids was explicitly passed
      if (hasTechIds && techIds !== null) {
        await dbClient.query('DELETE FROM job_technicians WHERE job_id = $1', [id]);
        for (const tid of techIds) {
          await dbClient.query(
            `INSERT INTO job_technicians (job_id, technician_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [id, tid]
          );
        }
      }

      await dbClient.query('COMMIT');

      // Notify newly added technicians
      if (hasTechIds && techIds) {
        for (const tid of techIds) {
          if (tid !== cur.technician_id) {
            notifyTechnicianJobAssignment(id, tid)
              .catch(e => console.error('[WhatsApp] job assign notify', e.message));
          }
        }
      }

      return res.status(200).json({ success: true, message: 'Job updated successfully.', data: result.rows[0] });
    } catch (err) {
      await dbClient.query('ROLLBACK');
      throw err;
    } finally {
      dbClient.release();
    }

  } catch (error) {
    console.error('Update job error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// PATCH /api/jobs/:id/status
// ────────────────────────────────────────────────────────────
const updateJobStatus = async (req, res) => {
  const dbClient = await pool.connect();
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'status is required.', { field: 'status' });
    if (!isValidJobStatus(status)) {
      return sendError(res, 400, ERROR_CODES.INVALID_JOB_STATUS,
        'Invalid status. Allowed: Raised, Assigned, In Progress, Closed, Cancelled.', { field: 'status' });
    }

    const existCheck = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.jobNotFound(res);
    const job = existCheck.rows[0];

    // Technicians cannot cancel jobs
    if (req.user.role === 'technician') {
      if (status === 'Cancelled') return Errors.forbidden(res);
      const techRow = await pool.query('SELECT id FROM technicians WHERE user_id = $1', [req.user.id]);
      if (!techRow.rows.length || techRow.rows[0].id !== job.technician_id) return Errors.forbidden(res);
    }

    // Cancellation — admin/manager only, from any non-terminal status
    if (status === 'Cancelled') {
      if (!['admin', 'manager'].includes(req.user.role)) {
        return sendError(res, 403, ERROR_CODES.FORBIDDEN, 'Only admin or manager can cancel a job.');
      }
      if (!['Raised', 'Assigned'].includes(job.status)) {
        return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
          `Cannot cancel a job that is "${job.status}". Cancellation is only allowed when status is Raised or Assigned.`);
      }
    } else {
      // Normal transition validation for all other statuses
      if (!isValidStatusTransition(job.status, status)) {
        return sendError(res, 400, ERROR_CODES.INVALID_STATUS_TRANSITION,
          `Invalid transition. Job is "${job.status}". Next allowed: "${JOB_STATUS_TRANSITIONS[job.status] || 'none (already Closed)'}"`,
          { current_status: job.status, allowed_next: JOB_STATUS_TRANSITIONS[job.status] || null });
      }
    }

    if (status === 'Closed' && !job.technician_id) {
      return sendError(res, 400, ERROR_CODES.JOB_NEEDS_TECHNICIAN,
        'Cannot close a job that has no assigned technician.');
    }

    const { cancel_reason } = req.body;

    await dbClient.query('BEGIN');

    const result = await dbClient.query(
      `UPDATE jobs
       SET status       = $1,
           closed_date  = ${status === 'Closed'    ? 'CURRENT_DATE' : 'NULL'},
           cancelled_at = ${status === 'Cancelled' ? 'NOW()'        : 'NULL'},
           cancelled_by = ${status === 'Cancelled' ? req.user.id    : 'NULL'},
           cancel_reason = $3
       WHERE id = $2
       RETURNING id, status, closed_date, cancelled_at, cancel_reason, updated_at`,
      [status, id, status === 'Cancelled' ? (cancel_reason || null) : null]
    );

    if (status === 'Closed' && job.technician_id) {
      await dbClient.query(
        `UPDATE technicians SET jobs_completed = jobs_completed + 1 WHERE id = $1`,
        [job.technician_id]
      );
    }

    await dbClient.query('COMMIT');

    const statusTitle = status === 'Closed'    ? 'Job Closed'
                      : status === 'Cancelled'  ? 'Visit Cancelled'
                      : status === 'In Progress' ? 'Job In Progress'
                      : status === 'Assigned'    ? 'Job Assigned'
                      : 'Job Status Updated';

    await notify({
      event: 'job_status', title: statusTitle,
      message: `${id} moved to "${status}"`,
      entity_type: 'job', entity_id: id, roles: ['admin', 'manager', 'engineer'],
    }, wsManager);

    if (status === 'Closed' && job.technician_id) {
      const techUserRes = await pool.query('SELECT user_id FROM technicians WHERE id = $1', [job.technician_id]);
      if (techUserRes.rows[0]?.user_id) {
        await notify({
          event: 'job_status', title: 'Your Job Was Closed',
          message: `${id} has been marked as Closed`,
          entity_type: 'job', entity_id: id, user_id: techUserRes.rows[0].user_id,
        }, wsManager);
      }
    }

    // WhatsApp notification to client on cancellation
    if (status === 'Cancelled') {
      notifyJobCancellation(id, cancel_reason)
        .catch(e => console.error('[WhatsApp] cancellation notify error:', e.message));
    }

    await logActivity({
      type: 'job',
      action: `Job ${id} status changed to "${status}"${cancel_reason ? ` — Reason: ${cancel_reason}` : ''}`,
      entity_type: 'job', entity_id: id, performed_by: req.user.id,
    });

    return res.status(200).json({ success: true, message: `Job status updated to "${status}".`, data: result.rows[0] });

  } catch (error) {
    await dbClient.query('ROLLBACK');
    console.error('Update job status error:', error);
    return Errors.internalError(res);
  } finally {
    dbClient.release();
  }
};

// ────────────────────────────────────────────────────────────
// DELETE /api/jobs/:id
// ────────────────────────────────────────────────────────────
const deleteJob = async (req, res) => {
  try {
    const { id } = req.params;
    const existCheck = await pool.query('SELECT id, status FROM jobs WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.jobNotFound(res);

    const { status } = existCheck.rows[0];
    if (status === 'In Progress') {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Jobs that are In Progress cannot be deleted.');
    }

    const reportsCheck = await pool.query('SELECT id FROM reports WHERE job_id = $1 LIMIT 1', [id]);
    if (reportsCheck.rows.length > 0) {
      return sendError(res, 409, ERROR_CODES.JOB_HAS_REPORTS,
        'Cannot delete this job because it has attached reports. Remove the reports first.');
    }

    await pool.query('DELETE FROM jobs WHERE id = $1', [id]);
    return res.status(200).json({ success: true, message: `Job ${id} deleted successfully.` });

  } catch (error) {
    console.error('Delete job error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/jobs/:id/images
// ────────────────────────────────────────────────────────────
const addJobImage = async (req, res) => {
  try {
    const { id } = req.params;
    const images  = Array.isArray(req.body) ? req.body : [req.body];

    const existCheck = await pool.query('SELECT id FROM jobs WHERE id = $1', [id]);
    if (existCheck.rows.length === 0) return Errors.jobNotFound(res);

    const countCheck = await pool.query('SELECT COUNT(*) FROM job_images WHERE job_id = $1', [id]);
    const current = parseInt(countCheck.rows[0].count);
    if (current + images.length > 20) {
      return sendError(res, 400, ERROR_CODES.TOO_MANY_IMAGES,
        `Cannot add ${images.length} image(s). A job can have a maximum of 20 images (currently has ${current}).`);
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    for (const img of images) {
      if (!img.file_name || !img.file_url) {
        return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
          'Each image must have file_name and file_url.', { missing_fields: ['file_name', 'file_url'] });
      }
      if (img.mime_type && !allowed.includes(img.mime_type)) {
        return sendError(res, 400, ERROR_CODES.INVALID_FILE_TYPE,
          `Invalid file type "${img.mime_type}". Allowed: ${allowed.join(', ')}.`, { field: 'mime_type', allowed });
      }
    }

    const inserted = [];
    for (const img of images) {
      const r = await pool.query(
        `INSERT INTO job_images (job_id, file_name, file_url, mime_type, file_size_bytes, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, job_id, file_name, file_url, mime_type, file_size_bytes, uploaded_at`,
        [id, img.file_name, img.file_url, img.mime_type || 'image/jpeg', img.file_size_bytes || null, req.user.id]
      );
      inserted.push(r.rows[0]);
    }

    return res.status(201).json({ success: true, message: `${inserted.length} image(s) added to job ${id}.`, data: inserted });

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
      'SELECT id FROM job_images WHERE id = $1 AND job_id = $2', [imageId, id]
    );
    if (imageCheck.rows.length === 0) {
      return sendError(res, 404, ERROR_CODES.JOB_IMAGE_NOT_FOUND, 'Image not found for this job.');
    }

    await pool.query('DELETE FROM job_images WHERE id = $1', [imageId]);
    return res.status(200).json({ success: true, message: 'Image deleted successfully.' });

  } catch (error) {
    console.error('Delete job image error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/jobs/technician-availability
// Check whether one or more technicians have jobs on a given date.
// Query params:
//   technician_ids  — comma-separated IDs, e.g. "1,2,5"  (required)
//   date            — ISO date string, e.g. "2026-08-20"  (required)
// ────────────────────────────────────────────────────────────
const checkTechnicianAvailability = async (req, res) => {
  try {
    const { technician_ids, date } = req.query;

    if (!technician_ids || !date) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'Both technician_ids (comma-separated) and date are required.',
        { missing_fields: [...(!technician_ids ? ['technician_ids'] : []), ...(!date ? ['date'] : [])] }
      );
    }

    const ids = technician_ids
      .split(',')
      .map(id => parseInt(id.trim()))
      .filter(id => !isNaN(id));

    if (ids.length === 0) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'technician_ids must contain at least one valid integer ID.');
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'date must be in YYYY-MM-DD format.');
    }

    // Fetch technician names
    const techResult = await pool.query(
      `SELECT id, name FROM technicians WHERE id = ANY($1) ORDER BY id`,
      [ids]
    );

    // Find conflicting jobs — any job where the technician is assigned
    // and the requested date falls on or between the job's scheduled/start/end date
    const conflictsResult = await pool.query(
      `SELECT
         jt.technician_id,
         j.id         AS job_id,
         j.title,
         j.status,
         j.category,
         j.scheduled_date,
         j.start_date,
         j.end_date,
         c.name       AS client_name
       FROM job_technicians jt
       JOIN jobs j    ON j.id  = jt.job_id
       LEFT JOIN clients c ON c.id = j.client_id
       WHERE jt.technician_id = ANY($1)
         AND j.status NOT IN ('Closed', 'Cancelled')
         AND (
           j.scheduled_date = $2
           OR j.start_date  = $2
           OR ($2::date BETWEEN j.start_date AND j.end_date)
         )
       ORDER BY jt.technician_id, j.scheduled_date`,
      [ids, date]
    );

    // Group conflicts by technician_id
    const conflictMap = {};
    for (const row of conflictsResult.rows) {
      if (!conflictMap[row.technician_id]) conflictMap[row.technician_id] = [];
      conflictMap[row.technician_id].push({
        job_id:         row.job_id,
        title:          row.title,
        status:         row.status,
        category:       row.category,
        client_name:    row.client_name,
        scheduled_date: row.scheduled_date,
        start_date:     row.start_date,
        end_date:       row.end_date,
      });
    }

    // Build per-technician result
    const technicians = techResult.rows.map(tech => {
      const conflicts = conflictMap[tech.id] || [];
      return {
        technician_id:    tech.id,
        technician_name:  tech.name,
        is_available:     conflicts.length === 0,
        conflicting_jobs: conflicts,
      };
    });

    // Flag if any requested ID wasn't found in DB
    const foundIds = new Set(techResult.rows.map(t => t.id));
    const notFound = ids.filter(id => !foundIds.has(id));

    return res.status(200).json({
      success:   true,
      date,
      technicians,
      ...(notFound.length > 0 && { not_found_ids: notFound }),
    });

  } catch (error) {
    console.error('Check technician availability error:', error);
    return Errors.internalError(res);
  }
};

module.exports = {
  getJobs,
  getJobsByUser,
  createJob,
  getJobById,
  updateJob,
  updateJobStatus,
  deleteJob,
  addJobImage,
  deleteJobImage,
  checkTechnicianAvailability,
};