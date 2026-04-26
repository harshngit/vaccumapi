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
 *     tags: [AMC Contracts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of expiring contracts
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
 *       - in: query
 *         name: po_number
 *         schema: { type: string }
 *         description: Filter by PO Number
 *     responses:
 *       200:
 *         description: List of AMC contracts
 */
router.get('/', protect, getAmcContracts);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/amc:
 *   post:
 *     summary: Create a new AMC contract
 *     description: |
 *       Creates the contract and sends a confirmation email to the client.
 *       The cron job will send a renewal reminder email when expiry is within
 *       renewal_reminder_days, and a 10-day service reminder based on next_service_date.
 *     tags: [AMC Contracts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [client_id, title, start_date, end_date, value]
 *             properties:
 *               client_id:
 *                 type: integer
 *                 example: 5
 *               title:
 *                 type: string
 *                 example: Annual Vacuum System Maintenance 2025
 *               po_number:
 *                 type: string
 *                 example: PO-2025-001
 *                 description: Purchase Order number (must be unique across all AMC contracts)
 *               start_date:
 *                 type: string
 *                 format: date
 *                 example: "2025-01-01"
 *               end_date:
 *                 type: string
 *                 format: date
 *                 example: "2025-12-31"
 *               value:
 *                 type: number
 *                 example: 75000.00
 *               next_service_date:
 *                 type: string
 *                 format: date
 *                 example: "2025-04-15"
 *                 description: A 10-day reminder email will be sent to client before this date
 *               renewal_reminder_days:
 *                 type: integer
 *                 default: 30
 *                 example: 30
 *               services:
 *                 type: array
 *                 items: { type: string }
 *                 example: ["Preventive Maintenance", "Emergency Repairs", "Spare Parts"]
 *     responses:
 *       201:
 *         description: AMC contract created and confirmation email sent
 *       400:
 *         description: Validation error
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
 *       404:
 *         description: Not found
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
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               po_number:
 *                 type: string
 *                 description: Must be unique — will reject if already used by another contract
 *               end_date:
 *                 type: string
 *                 format: date
 *               value:
 *                 type: number
 *               next_service_date:
 *                 type: string
 *                 format: date
 *               renewal_reminder_days:
 *                 type: integer
 *               services:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: AMC updated
 *       404:
 *         description: Not found
 */
router.put('/:id', protect, authorize('admin', 'manager'), updateAmcContract);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/amc/{id}:
 *   delete:
 *     summary: Delete an AMC contract (admin only)
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
 *       404:
 *         description: Not found
 */
router.delete('/:id', protect, authorize('admin'), deleteAmcContract);

module.exports = router;