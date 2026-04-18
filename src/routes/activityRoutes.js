// ============================================================
// src/routes/activityRoutes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const { getActivity } = require('../controllers/activityController');
const { protect }     = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Activity
 *   description: System-wide audit/activity log
 */

/**
 * @swagger
 * /api/activity:
 *   get:
 *     summary: Get paginated activity log (optionally filtered by module type)
 *     tags: [Activity]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [job, report, client, technician, amc, user, auth, email_settings]
 *         description: Filter by module type
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 30, maximum: 100 }
 *     responses:
 *       200:
 *         description: Paginated activity log
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:           { type: integer }
 *                       type:         { type: string, example: job }
 *                       action:       { type: string, example: 'Job JOB-0001 raised — HVAC Servicing' }
 *                       entity_type:  { type: string, nullable: true }
 *                       entity_id:    { type: string, nullable: true, example: JOB-0001 }
 *                       performed_at: { type: string, format: date-time }
 *                       performed_by:
 *                         type: object
 *                         properties:
 *                           id:   { type: integer }
 *                           name: { type: string }
 *                           role: { type: string }
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 */
router.get('/', protect, getActivity);

module.exports = router;
