// ============================================================
// src/routes/directoryRoutes.js
// Combined client directory routes (local clients + ERP customers).
// Mount in app.js:  app.use('/api/directory', directoryRoutes);
// ============================================================

const express = require('express');
const router  = express.Router();
const {
  getDirectory,
  getDirectoryById,
} = require('../controllers/directoryController');
const { protect } = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Directory
 *   description: Combined client directory (local + ERP) for AMC linking
 */

/**
 * @swagger
 * /api/directory:
 *   get:
 *     summary: Combined list of local clients and ERP customers (no pagination)
 *     description: |
 *       Returns LOCAL clients and live ERP customers together in one array.
 *       Pagination is intentionally omitted — handle it on the frontend.
 *
 *       Every item shares a common shape and exposes:
 *         - `source`          'local' | 'erp'
 *         - `client_id`       the LOCAL clients.id to use as the AMC client_id
 *         - `erp_customer_id` the ERP CustId (null for pure-local clients)
 *
 *       ERP customers are auto-mirrored into local clients, so each ERP item
 *       carries a usable `client_id`. If the ERP is unreachable, local clients
 *       are still returned and `erp_available` is false.
 *     tags: [Directory]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Forwarded to the ERP search (name / phone / email)
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [Active, Inactive] }
 *     responses:
 *       200:
 *         description: Combined directory list
 */
router.get('/', protect, getDirectory);

/**
 * @swagger
 * /api/directory/{id}:
 *   get:
 *     summary: Get a single record from either source
 *     description: |
 *       Fetch one record by id from local clients or the ERP.
 *       Use `?source=erp` when the id is an ERP CustId; otherwise the id is
 *       treated as a local clients.id.
 *     tags: [Directory]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Local clients.id, or ERP CustId when source=erp
 *       - in: query
 *         name: source
 *         schema: { type: string, enum: [local, erp], default: local }
 *     responses:
 *       200:
 *         description: Record found
 *       404:
 *         description: Not found
 */
router.get('/:id', protect, getDirectoryById);

module.exports = router;
