// ============================================================
// src/routes/emailRoutes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const { getEmailSettings, upsertEmailSettings, testEmail } = require('../controllers/emailController');
const { protect, authorize } = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Email Settings
 *   description: SMTP configuration and notification trigger management (admin only)
 */

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/email-settings:
 *   get:
 *     summary: Get current SMTP settings and notification triggers
 *     description: SMTP password is never returned in the response.
 *     tags: [Email Settings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Email settings found (or null if not configured yet)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/EmailSettingsResponse'
 */
router.get('/', protect, authorize('admin'), getEmailSettings);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/email-settings:
 *   put:
 *     summary: Create or update SMTP settings and notification triggers
 *     description: |
 *       This is an upsert — creates settings on first call, updates on subsequent calls.
 *
 *       - If `smtp_password` is omitted on update, the existing password is kept.
 *       - `notifications` is a map of trigger keys to booleans.
 *       - Available trigger keys: `job_raised`, `job_assigned`, `job_completed`, `report_approved`, `amc_renewal`, `quotation_sent`
 *     tags: [Email Settings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpsertEmailSettingsRequest'
 *     responses:
 *       200:
 *         description: Settings saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   $ref: '#/components/schemas/EmailSettingsResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put('/', protect, authorize('admin'), upsertEmailSettings);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/email-settings/test:
 *   post:
 *     summary: Send a test email using current SMTP settings
 *     tags: [Email Settings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to]
 *             properties:
 *               to:
 *                 type: string
 *                 format: email
 *                 example: admin@vdti.com
 *     responses:
 *       200:
 *         description: Test email sent
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessMessageResponse' }
 *       400:
 *         description: No settings configured or missing password
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: SMTP connection failed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/test', protect, authorize('admin'), testEmail);

module.exports = router;
