// ============================================================
// src/routes/myDataRoutes.js
// ============================================================

const express   = require('express');
const router    = express.Router();
const { getMyData } = require('../controllers/myDataController');
const { protect }   = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: My Data
 *   description: Personalised data for the logged-in user
 */

/**
 * @swagger
 * /api/my-data:
 *   get:
 *     summary: Get personalised data for the currently logged-in user
 *     description: |
 *       Returns data scoped to the calling user's role. No query parameters needed —
 *       everything is resolved automatically from the JWT token.
 *
 *       ---
 *
 *       ### admin / manager
 *       | Field | Description |
 *       |---|---|
 *       | `profile` | Own user record |
 *       | `stats.jobs` | total, raised, assigned, in_progress, closed, open, total_revenue |
 *       | `stats.reports` | total, pending, approved, rejected |
 *       | `stats.amc` | total, active, expiring_soon, expired |
 *       | `stats.technicians` | total, active, on_leave, inactive |
 *       | `stats.clients` | total, active |
 *       | `recent.jobs` | Last 20 jobs (all technicians) |
 *       | `recent.reports` | Last 20 reports (all technicians) |
 *       | `recent.amc` | Last 20 AMC contracts |
 *       | `recent.activity` | Last 10 activity log entries |
 *
 *       ---
 *
 *       ### technician / engineer / labour
 *       | Field | Description |
 *       |---|---|
 *       | `profile` | Own user record |
 *       | `technician_profile` | Linked technician record (`null` if not yet linked) |
 *       | `stats.jobs` | Their assigned jobs only |
 *       | `stats.reports` | Their submitted reports only |
 *       | `recent.jobs` | Up to 50 jobs assigned to them |
 *       | `recent.reports` | Up to 50 reports submitted by them |
 *
 *       If the user has no linked technician profile, `technician_profile` will be `null`
 *       and a `message` field will explain why.
 *     tags: [My Data]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Personalised data for the logged-in user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MyDataResponse'
 *             examples:
 *               AdminResponse:
 *                 summary: Admin / Manager — full platform overview
 *                 value:
 *                   success: true
 *                   role: admin
 *                   profile:
 *                     id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                     first_name: John
 *                     last_name: Doe
 *                     email: john@vdti.com
 *                     phone_number: "+919876543210"
 *                     role: admin
 *                     is_active: true
 *                     last_login_at: "2026-05-06T08:30:00Z"
 *                     created_at: "2024-01-15T10:00:00Z"
 *                   stats:
 *                     jobs:
 *                       total: 42
 *                       raised: 5
 *                       assigned: 10
 *                       in_progress: 8
 *                       closed: 19
 *                       open: 23
 *                       total_revenue: 875000
 *                     reports:
 *                       total: 31
 *                       pending: 4
 *                       approved: 25
 *                       rejected: 2
 *                     amc:
 *                       total: 12
 *                       active: 9
 *                       expiring_soon: 2
 *                       expired: 1
 *                     technicians:
 *                       total: 8
 *                       active: 6
 *                       on_leave: 1
 *                       inactive: 1
 *                     clients:
 *                       total: 15
 *                       active: 13
 *                   recent:
 *                     jobs: []
 *                     reports: []
 *                     amc: []
 *                     activity: []
 *               TechnicianResponse:
 *                 summary: Technician — own jobs and reports only
 *                 value:
 *                   success: true
 *                   role: technician
 *                   profile:
 *                     id: "b2c3d4e5-f6a7-8901-bcde-f12345678901"
 *                     first_name: Ravi
 *                     last_name: Kumar
 *                     email: ravi@vdti.com
 *                     role: technician
 *                     is_active: true
 *                   technician_profile:
 *                     id: 3
 *                     name: Ravi Kumar
 *                     specialization: Pump Maintenance
 *                     status: Active
 *                     jobs_completed: 24
 *                     rating: 4.5
 *                   stats:
 *                     jobs:
 *                       total: 12
 *                       raised: 1
 *                       assigned: 3
 *                       in_progress: 2
 *                       closed: 6
 *                       open: 6
 *                     reports:
 *                       total: 8
 *                       pending: 1
 *                       approved: 6
 *                       rejected: 1
 *                   recent:
 *                     jobs: []
 *                     reports: []
 *               NoTechnicianProfile:
 *                 summary: User with no linked technician profile
 *                 value:
 *                   success: true
 *                   role: technician
 *                   profile:
 *                     id: "c3d4e5f6-a7b8-9012-cdef-123456789012"
 *                     first_name: Amit
 *                     last_name: Shah
 *                     role: technician
 *                     is_active: true
 *                   technician_profile: null
 *                   message: "No technician profile is linked to your account yet. Please contact your administrator."
 *                   stats:
 *                     jobs:    { total: 0, raised: 0, assigned: 0, in_progress: 0, closed: 0, open: 0 }
 *                     reports: { total: 0, pending: 0, approved: 0, rejected: 0 }
 *                   recent:
 *                     jobs: []
 *                     reports: []
 *       401:
 *         description: Unauthorized — missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error_code: TOKEN_MISSING
 *               message: "Access denied. No token provided. Please log in."
 */
router.get('/', protect, getMyData);

module.exports = router;