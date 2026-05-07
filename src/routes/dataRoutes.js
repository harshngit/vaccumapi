// ============================================================
// src/routes/dataRoutes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const {
  getVisitScheduleList,
  getReportsList,
  getUserWiseDashboard
} = require('../controllers/dataController');
const { protect, authorize } = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Data
 *   description: Specialized data listing and dashboard APIs
 */

/**
 * @swagger
 * /api/data/visit-schedule:
 *   get:
 *     summary: List simplified visit schedule (jobs)
 *     tags: [Data]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/visit-schedule', protect, getVisitScheduleList);

/**
 * @swagger
 * /api/data/reports:
 *   get:
 *     summary: List simplified service reports
 *     tags: [Data]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/reports', protect, getReportsList);

/**
 * @swagger
 * /api/data/dashboard-user-wise:
 *   get:
 *     summary: Get user-wise dashboard stats for Jobs and Reports
 *     tags: [Data]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/dashboard-user-wise', protect, authorize('admin', 'manager'), getUserWiseDashboard);

module.exports = router;
