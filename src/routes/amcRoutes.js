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
 *       renewal_reminder_days, and a 10-day service reminder based on next_service_date
 *       as well as each of service_date_1..service_date_6 that is set.
 *       If visit_count is provided, service_date_1 through service_date_<visit_count>
 *       are required (e.g. visit_count=1 requires service_date_1; visit_count=3 requires
 *       service_date_1, service_date_2 and service_date_3).
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
 *               visit_count:
 *                 type: integer
 *                 example: 4
 *                 description: Number of service visits covered by the AMC
 *               pumps_count:
 *                 type: integer
 *                 example: 3
 *                 description: Number of pumps covered by the AMC
 *               per_pump_price:
 *                 type: number
 *                 example: 25000.00
 *                 description: Price charged per pump (INR)
 *               total_price:
 *                 type: number
 *                 example: 75000.00
 *                 description: Total price before GST (INR)
 *               gst_percent:
 *                 type: number
 *                 example: 18
 *                 description: GST percentage applied to the contract
 *               services:
 *                 type: array
 *                 items: { type: string }
 *                 example: ["Preventive Maintenance", "Emergency Repairs", "Spare Parts"]
 *               last_service_date:
 *                 type: string
 *                 format: date
 *                 example: "2025-03-15"
 *                 description: Date of the most recent completed service visit
 *               service_date_1:
 *                 type: string
 *                 format: date
 *                 description: Scheduled date for service visit 1 (required when visit_count >= 1)
 *               service_date_2:
 *                 type: string
 *                 format: date
 *                 description: Scheduled date for service visit 2 (required when visit_count >= 2)
 *               service_date_3:
 *                 type: string
 *                 format: date
 *                 description: Scheduled date for service visit 3 (required when visit_count >= 3)
 *               service_date_4:
 *                 type: string
 *                 format: date
 *                 description: Scheduled date for service visit 4 (required when visit_count >= 4)
 *               service_date_5:
 *                 type: string
 *                 format: date
 *                 description: Scheduled date for service visit 5 (required when visit_count >= 5)
 *               service_date_6:
 *                 type: string
 *                 format: date
 *                 description: Scheduled date for service visit 6 (required when visit_count >= 6)
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
 *               visit_count:
 *                 type: integer
 *                 description: Number of service visits covered by the AMC
 *               pumps_count:
 *                 type: integer
 *                 description: Number of pumps covered by the AMC
 *               per_pump_price:
 *                 type: number
 *                 description: Price charged per pump (INR)
 *               total_price:
 *                 type: number
 *                 description: Total price before GST (INR)
 *               gst_percent:
 *                 type: number
 *                 description: GST percentage applied to the contract
 *               services:
 *                 type: array
 *                 items: { type: string }
 *               last_service_date:
 *                 type: string
 *                 format: date
 *                 description: Date of the most recent completed service visit (pass null to clear)
 *               service_date_1:
 *                 type: string
 *                 format: date
 *                 description: Scheduled date for service visit 1 (required when visit_count >= 1)
 *               service_date_2:
 *                 type: string
 *                 format: date
 *                 description: Scheduled date for service visit 2 (required when visit_count >= 2)
 *               service_date_3:
 *                 type: string
 *                 format: date
 *                 description: Scheduled date for service visit 3 (required when visit_count >= 3)
 *               service_date_4:
 *                 type: string
 *                 format: date
 *                 description: Scheduled date for service visit 4 (required when visit_count >= 4)
 *               service_date_5:
 *                 type: string
 *                 format: date
 *                 description: Scheduled date for service visit 5 (required when visit_count >= 5)
 *               service_date_6:
 *                 type: string
 *                 format: date
 *                 description: Scheduled date for service visit 6 (required when visit_count >= 6)
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