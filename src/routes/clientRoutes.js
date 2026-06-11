// ============================================================
// src/routes/clientRoutes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const {
  getClients,
  createClient,
  getClientById,
  updateClient,
  deleteClient,
  linkErpClient,
  bulkImportErpClients,
} = require('../controllers/clientController');
const { protect, authorize } = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Clients
 *   description: Client organisation management
 */

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/clients:
 *   get:
 *     summary: List all clients with optional filters
 *     tags: [Clients]
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
 *         name: type
 *         schema:
 *           type: string
 *           enum: [Corporate, Residential, Commercial, Healthcare, Government]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Active, Inactive]
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by name or contact person
 *     responses:
 *       200:
 *         description: List of clients
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedClientsResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/', protect, getClients);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/clients:
 *   post:
 *     summary: Add a new client
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateClientRequest'
 *     responses:
 *       201:
 *         description: Client created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *                 data:
 *                   $ref: '#/components/schemas/ClientResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/', protect, authorize('admin', 'manager', 'engineer'), createClient);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/clients/from-erp:
 *   post:
 *     summary: Link (mirror) an ERP customer into local clients
 *     description: |
 *       Takes an ERP customer object and creates — or refreshes — a local
 *       mirror in the `clients` table, returning its local `id`. Use that
 *       `id` as `client_id` when creating an AMC contract.
 *       If the ERP customer (by CustId) was linked before, the existing
 *       local client is refreshed and returned instead of duplicating it.
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [CustId, CustName]
 *             properties:
 *               CustId:    { type: integer, example: 90 }
 *               CustCode:  { type: string,  example: B59 }
 *               CustName:  { type: string,  example: Deccan fine chemicals India Pvt Ltd }
 *               CustAdd:   { type: string,  example: Kesavaram(Village), }
 *               CustAdd1:  { type: string, nullable: true }
 *               CustAdd2:  { type: string, nullable: true }
 *               ContactNo: { type: string,  example: +91-4067111102 }
 *               EmailId:   { type: string,  example: mohanchand@deccanchemicals.com }
 *               PinCode:   { type: string,  example: "531127" }
 *               StateCode: { type: string,  example: 37 ANDHRA PRADESH }
 *     responses:
 *       200:
 *         description: ERP customer was already linked; existing client returned
 *       201:
 *         description: ERP customer linked; new local client created
 *       400:
 *         description: Missing CustId or CustName
 */
router.post('/from-erp', protect, authorize('admin', 'manager', 'engineer'), linkErpClient);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/clients/import-erp:
 *   post:
 *     summary: Bulk import ALL ERP customers into local clients
 *     description: |
 *       One-shot import. Fetches every customer from the ERP CustomerAPI and
 *       mirrors them into the local `clients` table automatically. New ERP
 *       customers are created; ones already mirrored (matched on CustId) are
 *       left as-is. No request body needed.
 *
 *       Returns a summary and a mapping of each `erp_customer_id` to its local
 *       `client_id` (use that id as `client_id` when creating an AMC).
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Import complete (summary + erp_customer_id -> client_id mapping)
 *       502:
 *         description: Could not reach the ERP
 */
router.post('/import-erp', protect, authorize('admin', 'manager'), bulkImportErpClients);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/clients/{id}:
 *   get:
 *     summary: Get a single client with job and AMC stats
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Client found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/ClientDetailResponse'
 *       404:
 *         description: Client not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/:id', protect, getClientById);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/clients/{id}:
 *   put:
 *     summary: Update a client record
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateClientRequest'
 *     responses:
 *       200:
 *         description: Client updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   $ref: '#/components/schemas/ClientResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Client not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put('/:id', protect, authorize('admin', 'manager', 'engineer'), updateClient);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/clients/{id}:
 *   delete:
 *     summary: Delete a client (admin or manager only)
 *     description: Cannot delete if client has open jobs or active AMC contracts.
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Client deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *       404:
 *         description: Client not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Client has open jobs or active AMC
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.delete('/:id', protect, authorize('admin', 'manager'), deleteClient);

module.exports = router;