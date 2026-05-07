// ============================================================
// src/controllers/myDataController.js
// GET /api/my-data
// ============================================================

const pool = require('../config/db');
const { Errors } = require('../utils/AppError');

const getMyData = async (req, res) => {
  try {
    const userId = req.user.id;
    const role   = req.user.role;
    const isAdminOrManager = ['admin', 'manager'].includes(role);

    const profileResult = await pool.query(
      `SELECT id, first_name, last_name, email, phone_number,
              role, is_active, last_login_at, created_at, updated_at
       FROM users WHERE id = $1`,
      [userId]
    );
    if (profileResult.rows.length === 0) return Errors.userNotFound(res);
    const profile = profileResult.rows[0];

    if (isAdminOrManager) {
      const [
        jobsRes, reportsRes, amcRes,
        techniciansRes, clientsRes, activityRes,
        jobStatsRes, reportStatsRes, amcStatsRes,
      ] = await Promise.all([
        pool.query(
          `SELECT j.id, j.title, j.status, j.priority, j.category,
                  j.amount, j.raised_date, j.scheduled_date, j.closed_date,
                  c.name AS client_name, t.name AS technician_name
           FROM jobs j
           LEFT JOIN clients     c ON c.id = j.client_id
           LEFT JOIN technicians t ON t.id = j.technician_id
           ORDER BY j.created_at DESC LIMIT 20`
        ),
        pool.query(
          `SELECT r.id, r.title, r.status, r.report_date, r.po_number, r.location,
                  COALESCE(r.company_name, r.client_name, c.name) AS company_name,
                  t.name AS technician_name
           FROM reports r
           LEFT JOIN jobs        j ON j.id = r.job_id
           LEFT JOIN clients     c ON c.id = COALESCE(r.client_id, j.client_id)
           LEFT JOIN technicians t ON t.id = r.technician_id
           ORDER BY r.created_at DESC LIMIT 20`
        ),
        pool.query(
          `SELECT a.id, a.title, a.status, a.start_date, a.end_date,
                  a.value, a.po_number, a.next_service_date, c.name AS client_name
           FROM amc_contracts a
           LEFT JOIN clients c ON c.id = a.client_id
           ORDER BY a.created_at DESC LIMIT 20`
        ),
        pool.query(
          `SELECT COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE status = 'Active')   AS active,
                  COUNT(*) FILTER (WHERE status = 'On Leave') AS on_leave,
                  COUNT(*) FILTER (WHERE status = 'Inactive') AS inactive
           FROM technicians`
        ),
        pool.query(
          `SELECT COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE status = 'Active') AS active
           FROM clients`
        ),
        pool.query(
          `SELECT a.id, a.type, a.action, a.entity_type, a.entity_id, a.created_at,
                  u.first_name || ' ' || u.last_name AS performed_by_name
           FROM activity_log a
           LEFT JOIN users u ON u.id = a.performed_by
           ORDER BY a.created_at DESC LIMIT 10`
        ),
        pool.query(
          `SELECT COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE status = 'Raised')      AS raised,
                  COUNT(*) FILTER (WHERE status = 'Assigned')    AS assigned,
                  COUNT(*) FILTER (WHERE status = 'In Progress') AS in_progress,
                  COUNT(*) FILTER (WHERE status = 'Closed')      AS closed,
                  COUNT(*) FILTER (WHERE status != 'Closed')     AS open,
                  COALESCE(SUM(amount) FILTER (WHERE status = 'Closed'), 0) AS total_revenue
           FROM jobs`
        ),
        pool.query(
          `SELECT COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE status = 'Pending')  AS pending,
                  COUNT(*) FILTER (WHERE status = 'Approved') AS approved,
                  COUNT(*) FILTER (WHERE status = 'Rejected') AS rejected
           FROM reports`
        ),
        pool.query(
          `SELECT COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE status = 'Active')        AS active,
                  COUNT(*) FILTER (WHERE status = 'Expiring Soon') AS expiring_soon,
                  COUNT(*) FILTER (WHERE status = 'Expired')       AS expired
           FROM amc_contracts`
        ),
      ]);

      return res.status(200).json({
        success: true,
        role,
        profile,
        stats: {
          jobs:        jobStatsRes.rows[0],
          reports:     reportStatsRes.rows[0],
          amc:         amcStatsRes.rows[0],
          technicians: techniciansRes.rows[0],
          clients:     clientsRes.rows[0],
        },
        recent: {
          jobs:     jobsRes.rows,
          reports:  reportsRes.rows,
          amc:      amcRes.rows,
          activity: activityRes.rows,
        },
      });
    }

    // ── Technician / Engineer / Labour ─────────────────────────
    const techResult = await pool.query(
      `SELECT id, name, email, phone, specialization, status, join_date, jobs_completed, rating, avatar
       FROM technicians WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    const technicianProfile = techResult.rows[0] || null;

    if (!technicianProfile) {
      return res.status(200).json({
        success:            true,
        role,
        profile,
        technician_profile: null,
        message:            'No technician profile is linked to your account yet. Please contact your administrator.',
        stats:   { jobs: { total: 0, open: 0, closed: 0, in_progress: 0 }, reports: { total: 0, pending: 0, approved: 0, rejected: 0 } },
        recent:  { jobs: [], reports: [] },
      });
    }

    const techId = technicianProfile.id;

    const [jobsRes, reportsRes, jobStatsRes, reportStatsRes] = await Promise.all([
      pool.query(
        `SELECT j.id, j.title, j.status, j.priority, j.category,
                j.amount, j.raised_date, j.scheduled_date, j.closed_date,
                c.name AS client_name, a.title AS amc_title
         FROM jobs j
         LEFT JOIN clients       c ON c.id = j.client_id
         LEFT JOIN amc_contracts a ON a.id = j.amc_id
         WHERE j.technician_id = $1
         ORDER BY j.created_at DESC LIMIT 50`,
        [techId]
      ),
      pool.query(
        `SELECT r.id, r.title, r.status, r.report_date, r.po_number, r.location,
                COALESCE(r.company_name, r.client_name, c.name) AS company_name,
                r.job_id, j.title AS job_title
         FROM reports r
         LEFT JOIN jobs    j ON j.id = r.job_id
         LEFT JOIN clients c ON c.id = COALESCE(r.client_id, j.client_id)
         WHERE r.technician_id = $1
         ORDER BY r.created_at DESC LIMIT 50`,
        [techId]
      ),
      pool.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'Raised')      AS raised,
                COUNT(*) FILTER (WHERE status = 'Assigned')    AS assigned,
                COUNT(*) FILTER (WHERE status = 'In Progress') AS in_progress,
                COUNT(*) FILTER (WHERE status = 'Closed')      AS closed,
                COUNT(*) FILTER (WHERE status != 'Closed')     AS open
         FROM jobs WHERE technician_id = $1`,
        [techId]
      ),
      pool.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'Pending')  AS pending,
                COUNT(*) FILTER (WHERE status = 'Approved') AS approved,
                COUNT(*) FILTER (WHERE status = 'Rejected') AS rejected
         FROM reports WHERE technician_id = $1`,
        [techId]
      ),
    ]);

    return res.status(200).json({
      success:            true,
      role,
      profile,
      technician_profile: technicianProfile,
      stats:  { jobs: jobStatsRes.rows[0], reports: reportStatsRes.rows[0] },
      recent: { jobs: jobsRes.rows, reports: reportsRes.rows },
    });

  } catch (error) {
    console.error('getMyData error:', error);
    return Errors.internalError(res);
  }
};

module.exports = { getMyData };
