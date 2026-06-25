// ============================================================
// src/controllers/dashboardController.js
// GET /api/dashboard — all KPIs + charts for the dashboard UI
// ============================================================

const pool = require('../config/db');
const { Errors } = require('../utils/AppError');

// ────────────────────────────────────────────────────────────
// GET /api/dashboard
// Returns everything the dashboard needs in one request:
//
// ┌─────────────────────────────────────────────────────┐
// │  stats        — top KPI cards                       │
// │  job_status_breakdown — donut chart data            │
// │  monthly_stats        — bar chart (last 6 months)   │
// │  revenue_trend        — line chart (last 6 months)  │
// │  quick_overview       — progress bars section       │
// │  recent_jobs          — Recent Work Orders table    │
// └─────────────────────────────────────────────────────┘
// ────────────────────────────────────────────────────────────
const getDashboard = async (req, res) => {
  try {

    // ── 1. TOP KPI CARDS ────────────────────────────────────
    // Active Jobs, Total Clients, Technicians, Revenue (Approved)

    const [
      activeJobsRes,
      totalClientsRes,
      techniciansRes,
      revenueRes,
      pendingReportsRes,
      activeAmcRes,
    ] = await Promise.all([
      // Active jobs = not closed
      pool.query(`SELECT COUNT(*) FROM jobs WHERE status != 'Closed'`),

      // Total clients
      pool.query(`SELECT COUNT(*) FROM clients WHERE status = 'Active'`),

      // Active + total technicians
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'Active') AS active,
          COUNT(*)                                   AS total
        FROM technicians
      `),

      // Revenue from closed jobs (approved = closed)
      pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM jobs WHERE status = 'Closed'`),

      // Pending reports
      pool.query(`SELECT COUNT(*) FROM reports WHERE status = 'Pending'`),

      // Active AMC contracts
      pool.query(`SELECT COUNT(*) FROM amc_contracts WHERE status = 'Active'`),
    ]);

    // ── Month-over-month % changes ───────────────────────────
    const momRes = await pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE status != 'Closed'
          AND raised_date >= DATE_TRUNC('month', CURRENT_DATE)
        ) AS active_jobs_this_month,
        COUNT(*) FILTER (
          WHERE status != 'Closed'
          AND raised_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
          AND raised_date <  DATE_TRUNC('month', CURRENT_DATE)
        ) AS active_jobs_last_month,

        COALESCE(SUM(amount) FILTER (
          WHERE status = 'Closed'
          AND closed_date >= DATE_TRUNC('month', CURRENT_DATE)
        ), 0) AS revenue_this_month,
        COALESCE(SUM(amount) FILTER (
          WHERE status = 'Closed'
          AND closed_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
          AND closed_date <  DATE_TRUNC('month', CURRENT_DATE)
        ), 0) AS revenue_last_month
      FROM jobs
    `);

    const mom = momRes.rows[0];

    const calcPct = (curr, prev) => {
      if (!prev || parseFloat(prev) === 0) return null;
      return Math.round(((parseFloat(curr) - parseFloat(prev)) / parseFloat(prev)) * 100);
    };

    // Client count last month (for +5% card)
    const clientMomRes = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE join_date >= DATE_TRUNC('month', CURRENT_DATE))               AS this_month,
        COUNT(*) FILTER (
          WHERE join_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
          AND   join_date <  DATE_TRUNC('month', CURRENT_DATE)
        ) AS last_month
      FROM clients
    `);
    const cMom = clientMomRes.rows[0];

    const stats = {
      active_jobs:       parseInt(activeJobsRes.rows[0].count),
      total_clients:     parseInt(totalClientsRes.rows[0].count),
      active_technicians:parseInt(techniciansRes.rows[0].active),
      total_technicians: parseInt(techniciansRes.rows[0].total),
      revenue_approved:  parseFloat(revenueRes.rows[0].total),
      pending_reports:   parseInt(pendingReportsRes.rows[0].count),
      active_amc_count:  parseInt(activeAmcRes.rows[0].count),
      // Month-over-month changes (null = no prior month data)
      mom_active_jobs:   calcPct(mom.active_jobs_this_month, mom.active_jobs_last_month),
      mom_revenue:       calcPct(mom.revenue_this_month, mom.revenue_last_month),
      mom_clients:       calcPct(cMom.this_month, cMom.last_month),
    };


    // ── 2. JOB STATUS BREAKDOWN (donut chart) ────────────────
    const statusRes = await pool.query(`
      SELECT status, COUNT(*) AS count
      FROM jobs
      GROUP BY status
      ORDER BY CASE status
        WHEN 'Raised'      THEN 1
        WHEN 'Assigned'    THEN 2
        WHEN 'In Progress' THEN 3
        WHEN 'Closed'      THEN 4
      END
    `);

    const job_status_breakdown = statusRes.rows.map(r => ({
      status: r.status,
      count:  parseInt(r.count),
    }));


    // ── 3. MONTHLY STATS (bar chart — last 6 months) ─────────
    const monthlyRes = await pool.query(`
      SELECT
        TO_CHAR(raised_date, 'Mon YYYY')                                AS month,
        TO_CHAR(raised_date, 'YYYY-MM')                                 AS month_key,
        DATE_TRUNC('month', raised_date)                                AS month_start,
        COUNT(*)                                                        AS jobs_raised,
        COUNT(*) FILTER (WHERE status = 'Closed')                      AS jobs_completed,
        COALESCE(SUM(amount) FILTER (WHERE status = 'Closed'), 0)      AS revenue
      FROM jobs
      WHERE raised_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '5 months')
      GROUP BY DATE_TRUNC('month', raised_date),
               TO_CHAR(raised_date, 'Mon YYYY'),
               TO_CHAR(raised_date, 'YYYY-MM')
      ORDER BY month_start ASC
    `);

    const monthly_stats = monthlyRes.rows.map(r => ({
      month:           r.month,
      month_key:       r.month_key,
      jobs_raised:     parseInt(r.jobs_raised),
      jobs_completed:  parseInt(r.jobs_completed),
      revenue:         parseFloat(r.revenue),
    }));


    // ── 4. REVENUE TREND (line chart — last 6 months) ────────
    // Same data as monthly_stats but shaped for line chart
    const revenue_trend = monthly_stats.map(m => ({
      month:   m.month,
      revenue: m.revenue,
    }));


    // ── 5. QUICK OVERVIEW (progress bars) ───────────────────
    // Jobs This Month, Jobs Completed, Active Technicians, AMC Active
    const thisMonthRes = await pool.query(`
      SELECT
        COUNT(*)                                    AS raised_this_month,
        COUNT(*) FILTER (WHERE status = 'Closed')   AS completed_this_month
      FROM jobs
      WHERE raised_date >= DATE_TRUNC('month', CURRENT_DATE)
    `);

    const amcTotalRes = await pool.query(`SELECT COUNT(*) FROM amc_contracts`);

    const tm = thisMonthRes.rows[0];

    const quick_overview = {
      jobs_this_month: {
        value: parseInt(tm.raised_this_month),
        // Use a reasonable monthly target (configurable — defaulting to 30)
        target: 30,
      },
      jobs_completed: {
        value:  parseInt(tm.completed_this_month),
        target: parseInt(tm.raised_this_month) || 1,
      },
      active_technicians: {
        value:  parseInt(techniciansRes.rows[0].active),
        target: parseInt(techniciansRes.rows[0].total),
      },
      amc_active: {
        value:  parseInt(activeAmcRes.rows[0].count),
        target: parseInt(amcTotalRes.rows[0].count),
      },
    };


    // ── 6. RECENT WORK ORDERS (table — last 10) ─────────────
    const recentJobsRes = await pool.query(`
      SELECT
        j.id, j.title,
        c.name AS client_name,
        j.status, j.priority, j.amount,
        j.raised_date, j.scheduled_date, j.closed_date,
        t.name AS technician_name
      FROM jobs j
      LEFT JOIN clients     c ON c.id = j.client_id
      LEFT JOIN technicians t ON t.id = j.technician_id
      ORDER BY j.created_at DESC
      LIMIT 10
    `);

    const recent_jobs = recentJobsRes.rows.map(r => ({
      id:              r.id,
      title:           r.title,
      client_name:     r.client_name,
      technician_name: r.technician_name,
      status:          r.status,
      priority:        r.priority,
      amount:          parseFloat(r.amount),
      raised_date:     r.raised_date,
      scheduled_date:  r.scheduled_date,
      closed_date:     r.closed_date,
    }));


    return res.status(200).json({
      success: true,
      data: {
        stats,
        job_status_breakdown,
        monthly_stats,
        revenue_trend,
        quick_overview,
        recent_jobs,
      },
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/dashboard/my
// Dashboard for technician / engineer / labour roles
// Returns their own KPIs, job status breakdown, monthly stats,
// upcoming schedule, and recent activity.
// ────────────────────────────────────────────────────────────
const getMyDashboard = async (req, res) => {
  try {
    const userId = req.user.id;
    const role   = req.user.role;

    // If admin/manager, redirect to the main dashboard logic
    if (['admin', 'manager'].includes(role)) {
      return getDashboard(req, res);
    }

    // ── Resolve technician profile ─────────────────────────
    const techResult = await pool.query(
      `SELECT id, name, specialization, status, jobs_completed, rating, avatar
       FROM technicians WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    if (techResult.rows.length === 0) {
      return res.status(200).json({
        success: true,
        role,
        technician_profile: null,
        message: 'No technician profile is linked to your account yet. Please contact your administrator.',
        data: {
          stats: { total_jobs: 0, open_jobs: 0, closed_jobs: 0, in_progress: 0, pending_reports: 0 },
          job_status_breakdown: [],
          monthly_stats: [],
          upcoming_visits: [],
          recent_jobs: [],
        },
      });
    }

    const techId = techResult.rows[0].id;

    // ── All queries in parallel ────────────────────────────
    const [
      statsRes,
      statusBreakdownRes,
      monthlyRes,
      upcomingRes,
      recentJobsRes,
      reportStatsRes,
      todayRes,
    ] = await Promise.all([
      // 1. KPI cards
      pool.query(
        `SELECT
           COUNT(*)                                    AS total_jobs,
           COUNT(*) FILTER (WHERE status != 'Closed')  AS open_jobs,
           COUNT(*) FILTER (WHERE status = 'Closed')   AS closed_jobs,
           COUNT(*) FILTER (WHERE status = 'In Progress') AS in_progress,
           COUNT(*) FILTER (WHERE status = 'Assigned')    AS assigned,
           COUNT(*) FILTER (WHERE status = 'Raised')      AS raised,
           COALESCE(SUM(amount) FILTER (WHERE status = 'Closed'), 0) AS total_revenue,
           COUNT(*) FILTER (
             WHERE scheduled_date = CURRENT_DATE AND status != 'Closed'
           ) AS today_visits,
           COUNT(*) FILTER (
             WHERE scheduled_date >= CURRENT_DATE
               AND scheduled_date < CURRENT_DATE + INTERVAL '7 days'
               AND status != 'Closed'
           ) AS week_visits
         FROM jobs WHERE technician_id = $1`,
        [techId]
      ),

      // 2. Job status breakdown (donut chart)
      pool.query(
        `SELECT status, COUNT(*) AS count
         FROM jobs WHERE technician_id = $1
         GROUP BY status
         ORDER BY CASE status
           WHEN 'Raised'      THEN 1
           WHEN 'Assigned'    THEN 2
           WHEN 'In Progress' THEN 3
           WHEN 'Closed'      THEN 4
         END`,
        [techId]
      ),

      // 3. Monthly stats (last 6 months)
      pool.query(
        `SELECT
           TO_CHAR(raised_date, 'Mon YYYY')   AS month,
           TO_CHAR(raised_date, 'YYYY-MM')    AS month_key,
           COUNT(*)                            AS jobs_assigned,
           COUNT(*) FILTER (WHERE status = 'Closed') AS jobs_completed
         FROM jobs
         WHERE technician_id = $1
           AND raised_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '5 months')
         GROUP BY DATE_TRUNC('month', raised_date),
                  TO_CHAR(raised_date, 'Mon YYYY'),
                  TO_CHAR(raised_date, 'YYYY-MM')
         ORDER BY DATE_TRUNC('month', raised_date) ASC`,
        [techId]
      ),

      // 4. Upcoming scheduled visits (next 14 days)
      pool.query(
        `SELECT j.id, j.title, j.scheduled_date, j.status, j.priority, j.category,
                c.name AS client_name, c.address AS site_location, c.phone AS client_phone
         FROM jobs j
         LEFT JOIN clients c ON c.id = j.client_id
         WHERE j.technician_id = $1
           AND j.scheduled_date >= CURRENT_DATE
           AND j.scheduled_date < CURRENT_DATE + INTERVAL '14 days'
           AND j.status != 'Closed'
         ORDER BY j.scheduled_date ASC
         LIMIT 20`,
        [techId]
      ),

      // 5. Recent jobs (last 10)
      pool.query(
        `SELECT j.id, j.title, j.status, j.priority, j.category,
                j.amount, j.raised_date, j.scheduled_date, j.closed_date,
                c.name AS client_name
         FROM jobs j
         LEFT JOIN clients c ON c.id = j.client_id
         WHERE j.technician_id = $1
         ORDER BY j.created_at DESC
         LIMIT 10`,
        [techId]
      ),

      // 6. Report stats
      pool.query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status = 'Pending')  AS pending,
           COUNT(*) FILTER (WHERE status = 'Approved') AS approved,
           COUNT(*) FILTER (WHERE status = 'Rejected') AS rejected
         FROM reports WHERE technician_id = $1`,
        [techId]
      ),

      // 7. Today's visits
      pool.query(
        `SELECT j.id, j.title, j.status, j.priority, j.category,
                j.scheduled_date,
                c.name AS client_name, c.address AS site_location
         FROM jobs j
         LEFT JOIN clients c ON c.id = j.client_id
         WHERE j.technician_id = $1
           AND j.scheduled_date = CURRENT_DATE
           AND j.status != 'Closed'
         ORDER BY j.id ASC`,
        [techId]
      ),
    ]);

    const stats = statsRes.rows[0];

    return res.status(200).json({
      success: true,
      role,
      technician_profile: techResult.rows[0],
      data: {
        stats: {
          total_jobs:      parseInt(stats.total_jobs),
          open_jobs:       parseInt(stats.open_jobs),
          closed_jobs:     parseInt(stats.closed_jobs),
          in_progress:     parseInt(stats.in_progress),
          assigned:        parseInt(stats.assigned),
          raised:          parseInt(stats.raised),
          total_revenue:   parseFloat(stats.total_revenue),
          today_visits:    parseInt(stats.today_visits),
          week_visits:     parseInt(stats.week_visits),
          pending_reports: parseInt(reportStatsRes.rows[0].pending),
          total_reports:   parseInt(reportStatsRes.rows[0].total),
          approved_reports: parseInt(reportStatsRes.rows[0].approved),
        },
        job_status_breakdown: statusBreakdownRes.rows.map(r => ({
          status: r.status,
          count:  parseInt(r.count),
        })),
        monthly_stats: monthlyRes.rows.map(r => ({
          month:          r.month,
          month_key:      r.month_key,
          jobs_assigned:  parseInt(r.jobs_assigned),
          jobs_completed: parseInt(r.jobs_completed),
        })),
        today_visits:    todayRes.rows,
        upcoming_visits: upcomingRes.rows,
        recent_jobs:     recentJobsRes.rows,
      },
    });

  } catch (error) {
    console.error('My dashboard error:', error);
    return Errors.internalError(res);
  }
};

module.exports = { getDashboard, getMyDashboard };
