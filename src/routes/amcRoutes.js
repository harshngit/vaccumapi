// ============================================================
// src/routes/amcRoutes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const {
  getAmcContracts,
  createAmcContract,
  getExpiringContracts,
  getAmcById,
  updateAmcContract,
  deleteAmcContract,
} = require('../controllers/amcController');
const { protect, authorize } = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: AMC Contracts
 *   description: Annual Maintenance Contract management
 */

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/amc/expiring:
 *   get:
 *     summary: Get AMC contracts whose renewal reminder fires today
 *     description: Used by a scheduled cron job. Returns contracts where `end_date - renewal_reminder_days <= today` and `end_date >= today`.
 *     tags: [AMC Contracts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of expiring contracts with client contact info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/AmcExpiringResponse' }
 */
router.get('/expiring', protect, authorize('admin', 'manager'), getExpiringContracts);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/amc:
 *   get:
 *     summary: List all AMC contracts with optional filters
 *     tags: [AMC Contracts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Active, Expiring Soon, Expired]
 *       - in: query
 *         name: client_id
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: List of AMC contracts
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedAmcResponse'
 */
router.get('/', protect, getAmcContracts);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/amc:
 *   post:
 *     summary: Create a new AMC contract
 *     tags: [AMC Contracts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAmcRequest'
 *     responses:
 *       201:
 *         description: AMC contract created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data: { $ref: '#/components/schemas/AmcResponse' }
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/', protect, authorize('admin', 'manager'), createAmcContract);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/amc/{id}:
 *   get:
 *     summary: Get a single AMC contract with services list
 *     tags: [AMC Contracts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         example: AMC-0001
 *     responses:
 *       200:
 *         description: AMC contract found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/AmcResponse' }
 *       404:
 *         description: Not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/:id', protect, getAmcById);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/amc/{id}:
 *   put:
 *     summary: Update an AMC contract
 *     description: If `services` array is provided, it fully replaces the existing services list.
 *     tags: [AMC Contracts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         example: AMC-0001
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateAmcRequest'
 *     responses:
 *       200:
 *         description: AMC updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data: { $ref: '#/components/schemas/AmcResponse' }
 *       404:
 *         description: Not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put('/:id', protect, authorize('admin', 'manager'), updateAmcContract);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/amc/{id}:
 *   delete:
 *     summary: Delete an AMC contract (admin only)
 *     description: Also deletes all associated services (cascade).
 *     tags: [AMC Contracts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         example: AMC-0001
 *     responses:
 *       200:
 *         description: Deleted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessMessageResponse' }
 *       404:
 *         description: Not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.delete('/:id', protect, authorize('admin'), deleteAmcContract);

module.exports = router;
