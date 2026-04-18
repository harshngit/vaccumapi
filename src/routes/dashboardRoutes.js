// ============================================================
// src/routes/dashboardRoutes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const { getDashboard } = require('../controllers/dashboardController');
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
 *     summary: Get all dashboard data in one request
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

module.exports = router;
