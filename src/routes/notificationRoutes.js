// ============================================================
// src/routes/notificationRoutes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const {
  getNotifications,
  markRead,
  clearNotifications,
} = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: In-app notification history (persisted WebSocket events)
 */

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     summary: Get notifications for the current user
 *     description: |
 *       Returns notifications targeted at this user (by user_id or role).
 *       These are the same events pushed over WebSocket, persisted so they
 *       survive page refreshes.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 30, maximum: 50 }
 *       - in: query
 *         name: unread
 *         schema: { type: boolean }
 *         description: If true, return only unread notifications
 *     responses:
 *       200:
 *         description: List of notifications
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:      { type: boolean }
 *                 unread_count: { type: integer, example: 3 }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:          { type: integer }
 *                       event:       { type: string, example: job_raised }
 *                       title:       { type: string, example: 'New Job Raised' }
 *                       message:     { type: string }
 *                       entity_type: { type: string, nullable: true, example: job }
 *                       entity_id:   { type: string, nullable: true, example: JOB-0001 }
 *                       is_read:     { type: boolean }
 *                       created_at:  { type: string, format: date-time }
 */
router.get('/', protect, getNotifications);

/**
 * @swagger
 * /api/notifications/read:
 *   patch:
 *     summary: Mark notifications as read
 *     description: |
 *       Pass `{ "ids": [1, 2, 3] }` to mark specific ones, or an empty body
 *       to mark **all** as read for the current user.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids:
 *                 type: array
 *                 items: { type: integer }
 *                 example: [1, 2, 3]
 *     responses:
 *       200:
 *         description: Marked as read
 */
router.patch('/read', protect, markRead);

/**
 * @swagger
 * /api/notifications:
 *   delete:
 *     summary: Clear all notifications for the current user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All cleared
 */
router.delete('/', protect, clearNotifications);

module.exports = router;
