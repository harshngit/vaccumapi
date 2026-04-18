// ============================================================
// src/routes/technicianRoutes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const {
  getTechnicians,
  createTechnician,
  getTechnicianById,
  updateTechnician,
  deleteTechnician,
  technicianLogin,
} = require('../controllers/technicianController');
const { protect, authorize } = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Technicians
 *   description: Technician management and login
 */

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/technicians/login:
 *   post:
 *     summary: Technician login (email or phone + password)
 *     description: |
 *       Technicians log in using the user account linked to their technician profile.
 *       A user account with `role = technician` must exist (created when the technician
 *       profile was added with a password).
 *     tags: [Technicians]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *           examples:
 *             LoginWithEmail:
 *               summary: Login with email
 *               value:
 *                 email: ravi@ism.com
 *                 password: password123
 *             LoginWithPhone:
 *               summary: Login with phone
 *               value:
 *                 phone_number: "+919876543210"
 *                 password: password123
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TechnicianLoginResponse'
 *       400:
 *         description: Missing credentials
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Account inactive
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/login', technicianLogin);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/technicians:
 *   get:
 *     summary: List all technicians with optional filters
 *     tags: [Technicians]
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
 *           enum: [Active, On Leave, Inactive]
 *       - in: query
 *         name: specialization
 *         schema: { type: string }
 *         description: Filter by specialization (partial match)
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by name or specialization
 *     responses:
 *       200:
 *         description: List of technicians
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedTechniciansResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/', protect, getTechnicians);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/technicians:
 *   post:
 *     summary: Add a new technician
 *     description: |
 *       Creates a technician profile. If `password` is provided, a linked
 *       `users` account with `role = technician` is also created so the
 *       technician can log in via `/api/technicians/login`.
 *
 *       If a `users` row with `role = technician` already exists for the
 *       given email/phone, it will be linked automatically without creating
 *       a duplicate user.
 *     tags: [Technicians]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTechnicianRequest'
 *           examples:
 *             WithLogin:
 *               summary: Create technician with login account
 *               value:
 *                 name: Ravi Kumar
 *                 email: ravi@ism.com
 *                 phone: "9876543210"
 *                 specialization: HVAC
 *                 status: Active
 *                 join_date: "2024-01-20"
 *                 password: techpass123
 *             WithoutLogin:
 *               summary: Create technician (admin-managed, no login)
 *               value:
 *                 name: Suresh Patel
 *                 phone: "9876500001"
 *                 specialization: Plumbing
 *     responses:
 *       201:
 *         description: Technician added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *                 data:
 *                   $ref: '#/components/schemas/TechnicianResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Email or phone already in use
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/', protect, authorize('admin', 'manager', 'engineer'), createTechnician);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/technicians/{id}:
 *   get:
 *     summary: Get a single technician with recent job history
 *     tags: [Technicians]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Technician found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/TechnicianDetailResponse'
 *       404:
 *         description: Technician not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/:id', protect, getTechnicianById);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/technicians/{id}:
 *   put:
 *     summary: Update a technician's profile
 *     tags: [Technicians]
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
 *             $ref: '#/components/schemas/UpdateTechnicianRequest'
 *     responses:
 *       200:
 *         description: Technician updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   $ref: '#/components/schemas/TechnicianResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put('/:id', protect, authorize('admin', 'manager', 'engineer'), updateTechnician);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/technicians/{id}:
 *   delete:
 *     summary: Delete a technician (admin or manager only)
 *     description: Cannot delete if the technician has open (non-closed) jobs.
 *     tags: [Technicians]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Technician deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *       404:
 *         description: Not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Technician has open jobs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 error_code: { type: string, example: TECHNICIAN_HAS_OPEN_JOBS }
 *                 message: { type: string }
 *                 details:
 *                   type: object
 *                   properties:
 *                     open_job_ids:
 *                       type: array
 *                       items: { type: string }
 *                       example: [JOB-0001, JOB-0003]
 */
router.delete('/:id', protect, authorize('admin', 'manager'), deleteTechnician);

module.exports = router;
