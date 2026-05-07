// ============================================================
// src/controllers/dataController.js
// Specialized list and dashboard APIs for Jobs and Reports
// ============================================================

const pool = require('../config/db');
const { Errors } = require('../utils/AppError');

// ────────────────────────────────────────────────────────────
// GET /api/data/visit-schedule
// Simplified list of jobs (visit schedule)
// ────────────────────────────────────────────────────────────
const getVisitScheduleList = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const { status, technician_id, client_id, from_date, to_date } = req.query;

    const conditions = [];
    const values     = [];

    if (status)        { values.push(status);              conditions.push(`j.status = $${values.length}`); }
    if (technician_id) { values.push(parseInt(technician_id)); conditions.push(`j.technician_id = $${values.length}`); }
    if (client_id)     { values.push(parseInt(client_id));     conditions.push(`j.client_id = $${values.length}`); }
    if (from_date)     { values.push(from_date);           conditions.push(`j.raised_date >= $${values.length}`); }
    if (to_date)       { values.push(to_date);             conditions.push(`j.raised_date <= $${values.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM jobs j ${where}`, values);
    const total = parseInt(countResult.rows[0].count);

    const sqlValues = [...values, limit, offset];
    const result = await pool.query(
      `SELECT
         j.id, j.title,
         c.name  AS client_name,
         t.name  AS technician_name,
         j.status, j.priority, j.category,
         j.raised_date, j.scheduled_date, j.closed_date
       FROM jobs j
       LEFT JOIN clients     c ON c.id = j.client_id
       LEFT JOIN technicians t ON t.id = j.technician_id
       ${where}
       ORDER BY j.created_at DESC
       LIMIT $${sqlValues.length - 1} OFFSET $${sqlValues.length}`,
      sqlValues
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: { total, page, limit, total_pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Get visit schedule list error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/data/reports
// Simplified list of reports
// ────────────────────────────────────────────────────────────
const getReportsList = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const { status, technician_id, client_id, from_date, to_date } = req.query;

    const conditions = [];
    const values     = [];

    if (status)        { values.push(status);                 conditions.push(`r.status = $${values.length}`); }
    if (technician_id) { values.push(parseInt(technician_id)); conditions.push(`r.technician_id = $${values.length}`); }
    if (client_id)     { values.push(parseInt(client_id));    conditions.push(`r.client_id = $${values.length}`); }
    if (from_date)     { values.push(from_date);              conditions.push(`r.report_date >= $${values.length}`); }
    if (to_date)       { values.push(to_date);                conditions.push(`r.report_date <= $${values.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM reports r ${where}`, values);
    const total = parseInt(countResult.rows[0].count);

    const sqlValues = [...values, limit, offset];
    const result = await pool.query(
      `SELECT
         r.id, r.title, r.job_id,
         COALESCE(r.client_name, c.name) AS client_name,
         t.name AS technician_name,
         r.status, r.report_date
       FROM reports r
       LEFT JOIN jobs j ON j.id = r.job_id
       LEFT JOIN clients c ON c.id = COALESCE(r.client_id, j.client_id)
       LEFT JOIN technicians t ON t.id = r.technician_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${sqlValues.length - 1} OFFSET $${sqlValues.length}`,
      sqlValues
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: { total, page, limit, total_pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Get reports list error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/data/dashboard-user-wise
// Stats for Jobs and Reports grouped by Technician
// ────────────────────────────────────────────────────────────
const getUserWiseDashboard = async (req, res) => {
  try {
    // We aggregate stats per technician
    const result = await pool.query(`
      WITH job_stats AS (
        SELECT
          technician_id,
          COUNT(*) AS total_jobs,
          COUNT(*) FILTER (WHERE status = 'Raised') AS raised,
          COUNT(*) FILTER (WHERE status = 'Assigned') AS assigned,
          COUNT(*) FILTER (WHERE status = 'In Progress') AS in_progress,
          COUNT(*) FILTER (WHERE status = 'Closed') AS closed
        FROM jobs
        WHERE technician_id IS NOT NULL
        GROUP BY technician_id
      ),
      report_stats AS (
        SELECT
          technician_id,
          COUNT(*) AS total_reports,
          COUNT(*) FILTER (WHERE status = 'Pending') AS pending,
          COUNT(*) FILTER (WHERE status = 'Approved') AS approved,
          COUNT(*) FILTER (WHERE status = 'Rejected') AS rejected
        FROM reports
        WHERE technician_id IS NOT NULL
        GROUP BY technician_id
      )
      SELECT
        t.id AS technician_id,
        t.name AS technician_name,
        COALESCE(js.total_jobs, 0) AS total_jobs,
        COALESCE(js.raised, 0) AS jobs_raised,
        COALESCE(js.assigned, 0) AS jobs_assigned,
        COALESCE(js.in_progress, 0) AS jobs_in_progress,
        COALESCE(js.closed, 0) AS jobs_closed,
        COALESCE(rs.total_reports, 0) AS total_reports,
        COALESCE(rs.pending, 0) AS reports_pending,
        COALESCE(rs.approved, 0) AS reports_approved,
        COALESCE(rs.rejected, 0) AS reports_rejected
      FROM technicians t
      LEFT JOIN job_stats js ON js.technician_id = t.id
      LEFT JOIN report_stats rs ON rs.technician_id = t.id
      WHERE t.status = 'Active'
      ORDER BY t.name ASC
    `);

    // Format the data into a cleaner structure
    const formattedData = result.rows.map(row => ({
      technician_id: row.technician_id,
      technician_name: row.technician_name,
      jobs: {
        total: parseInt(row.total_jobs),
        raised: parseInt(row.jobs_raised),
        assigned: parseInt(row.jobs_assigned),
        in_progress: parseInt(row.jobs_in_progress),
        closed: parseInt(row.jobs_closed)
      },
      reports: {
        total: parseInt(row.total_reports),
        pending: parseInt(row.reports_pending),
        approved: parseInt(row.reports_approved),
        rejected: parseInt(row.reports_rejected)
      }
    }));

    return res.status(200).json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    console.error('Get user-wise dashboard error:', error);
    return Errors.internalError(res);
  }
};

module.exports = {
  getVisitScheduleList,
  getReportsList,
  getUserWiseDashboard
};
