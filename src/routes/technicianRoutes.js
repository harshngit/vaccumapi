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
const {
  addTechnicianDocument,
  getTechnicianDocuments,
  updateTechnicianDocument,
  deleteTechnicianDocument,
  getExpiringDocuments,
} = require('../controllers/technicianDocController');
const {
  addRating,
  getRatings,
  updateRating,
  deleteRating,
} = require('../controllers/technicianRatingController');
const { protect, authorize } = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   - name: Technicians
 *     description: Technician management and login
 *   - name: Technician Documents
 *     description: Upload and manage technician documents (Aadhaar, WC Policy, Insurance, etc.)
 *   - name: Technician Ratings
 *     description: Rate technicians after jobs are completed
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
 *                 documents:
 *                   - document_type: Aadhaar Card
 *                     document_name: Ravi Aadhaar Front
 *                     file_name: aadhaar_front.jpg
 *                     file_url: https://api.vdtil.com/uploads/1714012345678_aadhaar_front.jpg
 *                     mime_type: image/jpeg
 *                     expiry_date: "2030-12-31"
 *                   - document_type: WC Policy
 *                     document_name: WC Policy 2024-25
 *                     file_name: wc_policy.pdf
 *                     file_url: https://api.vdtil.com/uploads/1714012345679_wc_policy.pdf
 *                     mime_type: application/pdf
 *                     expiry_date: "2025-03-31"
 *                     notes: Renewal due March 2025
 *             WithoutLogin:
 *               summary: Create technician without login (no documents)
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
 * /api/technicians/documents/expiring:
 *   get:
 *     summary: List all technician documents that are expired or expiring soon
 *     description: |
 *       Returns documents across ALL technicians whose `expiry_date` falls within
 *       the next N days (default 30). Includes already-expired documents.
 *       Use this for dashboard alerts and notification widgets.
 *     tags: [Technician Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema: { type: integer, default: 30 }
 *         description: Look-ahead window in days (e.g. 30 = expiring within 30 days + already expired)
 *     responses:
 *       200:
 *         description: Expiring and expired documents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 days_window: { type: integer }
 *                 summary:
 *                   type: object
 *                   properties:
 *                     expired: { type: integer }
 *                     expiring_soon: { type: integer }
 *                     total: { type: integer }
 *                 data:
 *                   type: object
 *                   properties:
 *                     expired:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/TechnicianDocumentResponse'
 *                     expiring:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/TechnicianDocumentResponse'
 */
router.get('/documents/expiring', protect, getExpiringDocuments);

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

// ────────────────────────────────────────────────────────────
// TECHNICIAN DOCUMENTS (nested under /:id)
// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/technicians/{id}/documents:
 *   get:
 *     summary: List all documents for a technician
 *     tags: [Technician Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Technician ID
 *       - in: query
 *         name: document_type
 *         schema:
 *           type: string
 *           enum: [Aadhaar Card, Technician Photo, WC Policy, Medical Insurance Policy, Other]
 *         description: Optional filter by document type
 *     responses:
 *       200:
 *         description: List of documents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 total: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TechnicianDocumentResponse'
 *       404:
 *         description: Technician not found
 */
router.get('/:id/documents', protect, getTechnicianDocuments);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/technicians/{id}/documents:
 *   post:
 *     summary: Attach a document to a technician
 *     description: |
 *       Links an uploaded document to the technician's profile.
 *
 *       **Flow:**
 *       1. Upload file via `POST /api/upload/technician-documents` → get `file_name` + `file_url`
 *       2. Call this endpoint with the file metadata + `document_type` + optional `expiry_date`
 *     tags: [Technician Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Technician ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddTechnicianDocumentRequest'
 *     responses:
 *       201:
 *         description: Document attached
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   $ref: '#/components/schemas/TechnicianDocumentResponse'
 *       400:
 *         description: Validation error
 *       404:
 *         description: Technician not found
 */
router.post('/:id/documents', protect, authorize('admin', 'manager', 'engineer'), addTechnicianDocument);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/technicians/{id}/documents/{docId}:
 *   put:
 *     summary: Update document metadata (name, expiry date, notes)
 *     tags: [Technician Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Technician ID
 *       - in: path
 *         name: docId
 *         required: true
 *         schema: { type: integer }
 *         description: Document ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateTechnicianDocumentRequest'
 *     responses:
 *       200:
 *         description: Document updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   $ref: '#/components/schemas/TechnicianDocumentResponse'
 *       404:
 *         description: Document not found
 */
router.put('/:id/documents/:docId', protect, authorize('admin', 'manager', 'engineer'), updateTechnicianDocument);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/technicians/{id}/documents/{docId}:
 *   delete:
 *     summary: Delete a technician document
 *     description: Removes the document record and deletes the physical file from disk.
 *     tags: [Technician Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Technician ID
 *       - in: path
 *         name: docId
 *         required: true
 *         schema: { type: integer }
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Document deleted
 *       404:
 *         description: Document not found
 */
router.delete('/:id/documents/:docId', protect, authorize('admin', 'manager'), deleteTechnicianDocument);

// ────────────────────────────────────────────────────────────
// TECHNICIAN RATINGS
// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/technicians/{id}/ratings:
 *   get:
 *     summary: List all ratings for a technician
 *     tags: [Technician Ratings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Technician ID
 *     responses:
 *       200:
 *         description: Ratings list with average
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 average_rating: { type: number, example: 4.25 }
 *                 total_ratings: { type: integer, example: 8 }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TechnicianRatingResponse'
 *       404:
 *         description: Technician not found
 */
router.get('/:id/ratings', protect, getRatings);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/technicians/{id}/ratings:
 *   post:
 *     summary: Rate a technician (optionally for a specific closed job)
 *     description: |
 *       Adds a rating (1–5) for the technician. If `job_id` is provided,
 *       the job must be closed and assigned to this technician.
 *       Only one rating per technician per job is allowed.
 *
 *       The technician's `rating` field (average) is automatically recalculated.
 *     tags: [Technician Ratings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Technician ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddTechnicianRatingRequest'
 *           examples:
 *             WithJob:
 *               summary: Rate after a specific job
 *               value:
 *                 rating: 4.5
 *                 review: "Excellent work, completed ahead of schedule"
 *                 job_id: JOB-0001
 *             WithoutJob:
 *               summary: General rating (no specific job)
 *               value:
 *                 rating: 4
 *                 review: "Reliable and punctual"
 *     responses:
 *       201:
 *         description: Rating added
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   allOf:
 *                     - $ref: '#/components/schemas/TechnicianRatingResponse'
 *                     - type: object
 *                       properties:
 *                         average_rating: { type: number, example: 4.25, description: Updated average }
 *       400:
 *         description: Invalid rating, job not closed, or job not assigned to technician
 *       404:
 *         description: Technician or job not found
 *       409:
 *         description: Already rated for this job
 */
router.post('/:id/ratings', protect, addRating);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/technicians/{id}/ratings/{ratingId}:
 *   put:
 *     summary: Update an existing rating
 *     tags: [Technician Ratings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Technician ID
 *       - in: path
 *         name: ratingId
 *         required: true
 *         schema: { type: integer }
 *         description: Rating ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateTechnicianRatingRequest'
 *     responses:
 *       200:
 *         description: Rating updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   allOf:
 *                     - $ref: '#/components/schemas/TechnicianRatingResponse'
 *                     - type: object
 *                       properties:
 *                         average_rating: { type: number, description: Updated average }
 *       404:
 *         description: Rating not found
 */
router.put('/:id/ratings/:ratingId', protect, updateRating);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/technicians/{id}/ratings/{ratingId}:
 *   delete:
 *     summary: Delete a rating
 *     tags: [Technician Ratings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         description: Technician ID
 *       - in: path
 *         name: ratingId
 *         required: true
 *         schema: { type: integer }
 *         description: Rating ID
 *     responses:
 *       200:
 *         description: Rating deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 average_rating: { type: number, description: Updated average after deletion }
 *       404:
 *         description: Rating not found
 */
router.delete('/:id/ratings/:ratingId', protect, authorize('admin', 'manager'), deleteRating);

module.exports = router;
