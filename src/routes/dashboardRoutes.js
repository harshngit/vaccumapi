// ============================================================
// src/routes/dashboardRoutes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const { getDashboard, getMyDashboard } = require('../controllers/dashboardController');
const { protect, authorize } = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: Dashboard KPIs, charts and recent activity
 */

/**
 * @swagger
 * /api/dashboard:
 *   get:
 *     summary: Admin/Manager dashboard — full platform overview
 *     description: |
 *       Returns everything needed to render the full dashboard UI:
 *
 *       - **stats** — KPI cards (Active Jobs, Total Clients, Technicians, Revenue)
 *       - **job_status_breakdown** — data for the donut chart (Raised / Assigned / In Progress / Closed)
 *       - **monthly_stats** — last 6 months bar chart (jobs raised, jobs completed, revenue)
 *       - **revenue_trend** — last 6 months line chart (revenue only)
 *       - **quick_overview** — progress bar section (Jobs This Month, Jobs Completed, Active Technicians, AMC Active)
 *       - **recent_jobs** — last 10 work orders for the Recent Work Orders table
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/', protect, authorize('admin', 'manager', 'engineer'), getDashboard);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/dashboard/my:
 *   get:
 *     summary: Personalised dashboard for any role
 *     description: |
 *       Returns dashboard data scoped to the logged-in user.
 *
 *       - **admin/manager** → returns the same data as `GET /api/dashboard`
 *       - **technician/engineer/labour** → returns their own KPIs, charts, and schedule
 *
 *       ### Technician/Engineer/Labour response includes:
 *       | Section | Description |
 *       |---|---|
 *       | `technician_profile` | Linked technician record |
 *       | `stats` | total_jobs, open_jobs, closed_jobs, in_progress, today_visits, week_visits, pending_reports |
 *       | `job_status_breakdown` | Donut chart — their jobs by status |
 *       | `monthly_stats` | Bar chart — last 6 months (jobs_assigned, jobs_completed) |
 *       | `today_visits` | Jobs scheduled for today |
 *       | `upcoming_visits` | Jobs scheduled in the next 14 days |
 *       | `recent_jobs` | Last 10 jobs |
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Personalised dashboard data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 role: { type: string }
 *                 technician_profile:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     id: { type: integer }
 *                     name: { type: string }
 *                     specialization: { type: string }
 *                     status: { type: string }
 *                     jobs_completed: { type: integer }
 *                     rating: { type: number }
 *                     avatar: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     stats:
 *                       type: object
 *                       properties:
 *                         total_jobs: { type: integer }
 *                         open_jobs: { type: integer }
 *                         closed_jobs: { type: integer }
 *                         in_progress: { type: integer }
 *                         assigned: { type: integer }
 *                         raised: { type: integer }
 *                         total_revenue: { type: number }
 *                         today_visits: { type: integer }
 *                         week_visits: { type: integer }
 *                         pending_reports: { type: integer }
 *                         total_reports: { type: integer }
 *                         approved_reports: { type: integer }
 *                     job_status_breakdown:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           status: { type: string }
 *                           count: { type: integer }
 *                     monthly_stats:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           month: { type: string, example: Jun 2026 }
 *                           month_key: { type: string, example: '2026-06' }
 *                           jobs_assigned: { type: integer }
 *                           jobs_completed: { type: integer }
 *                     today_visits:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string }
 *                           title: { type: string }
 *                           status: { type: string }
 *                           priority: { type: string }
 *                           category: { type: string }
 *                           scheduled_date: { type: string, format: date }
 *                           client_name: { type: string }
 *                           site_location: { type: string, nullable: true }
 *                     upcoming_visits:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string }
 *                           title: { type: string }
 *                           scheduled_date: { type: string, format: date }
 *                           status: { type: string }
 *                           priority: { type: string }
 *                           category: { type: string }
 *                           client_name: { type: string }
 *                           site_location: { type: string, nullable: true }
 *                           client_phone: { type: string, nullable: true }
 *                     recent_jobs:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string }
 *                           title: { type: string }
 *                           status: { type: string }
 *                           priority: { type: string }
 *                           category: { type: string }
 *                           amount: { type: number }
 *                           raised_date: { type: string, format: date }
 *                           scheduled_date: { type: string, format: date, nullable: true }
 *                           closed_date: { type: string, format: date, nullable: true }
 *                           client_name: { type: string }
 *       401:
 *         description: Unauthorized
 */
router.get('/my', protect, getMyDashboard);

module.exports = router;
