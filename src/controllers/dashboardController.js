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

module.exports = { getDashboard };
