// ============================================================
// src/routes/jobRoutes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const {
  getJobs,
  getJobsByUser,
  createJob,
  getJobById,
  updateJob,
  updateJobStatus,
  deleteJob,
  addJobImage,
  deleteJobImage,
  checkTechnicianAvailability,
} = require('../controllers/jobController');
const { protect, authorize } = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Jobs
 *   description: Visit Scheduled / Work order management
 */

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs:
 *   get:
 *     summary: List all jobs with optional filters
 *     tags: [Jobs]
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
 *           enum: [Raised, Assigned, In Progress, Closed]
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [Low, Medium, High, Critical]
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [Service, "AMC Visit", Breakdown, "Installation & Commissioning", Inspection, Workshop]
 *       - in: query
 *         name: client_id
 *         schema: { type: integer }
 *       - in: query
 *         name: technician_id
 *         schema: { type: integer }
 *       - in: query
 *         name: amc_id
 *         schema: { type: string }
 *         description: Filter jobs linked to a specific AMC contract (e.g. AMC-0001)
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by job ID or title
 *       - in: query
 *         name: from_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to_date
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: List of jobs
 */
router.get('/', protect, getJobs);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs/by-user/{user_id}:
 *   get:
 *     summary: Get all jobs assigned to the technician linked to a user_id
 *     description: |
 *       Resolves the technician profile via `user_id`, then returns all jobs
 *       assigned to that technician. Supports optional `status` filter and pagination.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema: { type: integer }
 *         description: The user account ID (not the technician record ID)
 *         example: 5
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Raised, Assigned, In Progress, Closed]
 *         description: Optional status filter
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Jobs for the technician linked to this user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 technician:
 *                   type: object
 *                   properties:
 *                     id:      { type: integer }
 *                     name:    { type: string }
 *                     user_id: { type: integer }
 *                 data:
 *                   type: array
 *                   items: { type: object }
 *                 pagination:
 *                   type: object
 *       404:
 *         description: No technician profile found for this user_id
 */
router.get('/by-user/:user_id', protect, getJobsByUser);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs:
 *   post:
 *     summary: Raise a new visit / work order
 *     description: |
 *       Creates a new job. If `technician_id` is provided, status auto-sets to `Assigned`.
 *       `amc_id` is optional — links the job to an AMC contract.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, client_id]
 *             properties:
 *               title:          { type: string, example: "Quarterly Vacuum Pump Inspection" }
 *               description:    { type: string }
 *               client_id:      { type: integer, example: 3 }
 *               technician_id:  { type: integer, example: 2 }
 *               amc_id:
 *                 type: string
 *                 example: AMC-0001
 *                 description: Optional AMC contract this visit is linked to
 *               priority:
 *                 type: string
 *                 enum: [Low, Medium, High, Critical]
 *                 default: Medium
 *               category:
 *                 type: string
 *                 enum: [Service, "AMC Visit", Breakdown, "Installation & Commissioning", Inspection, Workshop]
 *                 default: Service
 *               scheduled_date: { type: string, format: date }
 *               amount:         { type: number, default: 0 }
 *     responses:
 *       201:
 *         description: Job raised
 *       400:
 *         description: Validation error
 */
router.post('/', protect, authorize('admin', 'manager', 'engineer'), createJob);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs/{id}:
 *   get:
 *     summary: Get a single job with images, reports, and AMC info
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         example: JOB-0001
 *     responses:
 *       200:
 *         description: Job found (includes amc_id, amc_title, amc_status, amc_po_number)
 *       404:
 *         description: Job not found
 */
// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs/technician-availability:
 *   get:
 *     summary: Check if one or more technicians are available on a given date
 *     description: |
 *       Returns each technician's active jobs on the requested date so you can
 *       detect conflicts before assigning them to a new job.
 *
 *       A technician is **unavailable** if they have any non-Closed / non-Cancelled
 *       job whose `scheduled_date`, `start_date`, or date range (`start_date` →
 *       `end_date`) overlaps the requested date.
 *
 *       **Use before creating a job** — pass all candidate technician IDs and the
 *       planned `scheduled_date` to surface conflicts up-front.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: technician_ids
 *         required: true
 *         schema:
 *           type: string
 *           example: "1,2,5"
 *         description: Comma-separated technician IDs to check
 *       - in: query
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-08-20"
 *         description: Date to check availability for (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Availability result per technician
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 date: { type: string, format: date }
 *                 technicians:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       technician_id:   { type: integer }
 *                       technician_name: { type: string }
 *                       is_available:    { type: boolean }
 *                       conflicting_jobs:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             job_id:         { type: string, example: JOB-0014 }
 *                             title:          { type: string }
 *                             status:         { type: string }
 *                             category:       { type: string }
 *                             client_name:    { type: string }
 *                             scheduled_date: { type: string, format: date }
 *                             start_date:     { type: string, format: date }
 *                             end_date:       { type: string, format: date }
 *       400:
 *         description: Missing or invalid parameters
 */
router.get('/technician-availability', protect, checkTechnicianAvailability);

// ────────────────────────────────────────────────────────────

router.get('/:id', protect, getJobById);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs/{id}:
 *   put:
 *     summary: Update job details (not status — use PATCH for status)
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         example: JOB-0001
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:          { type: string }
 *               description:    { type: string }
 *               technician_id:  { type: integer }
 *               amc_id:
 *                 type: string
 *                 description: Pass null to unlink, or an AMC ID to link
 *               priority:       { type: string }
 *               category:
 *                 type: string
 *                 enum: [Service, "AMC Visit", Breakdown, "Installation & Commissioning", Inspection, Workshop]
 *               scheduled_date: { type: string, format: date }
 *               amount:         { type: number }
 *     responses:
 *       200:
 *         description: Job updated
 *       404:
 *         description: Job not found
 */
router.put('/:id', protect, authorize('admin', 'manager', 'engineer'), updateJob);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs/{id}/status:
 *   patch:
 *     summary: Advance job status through the pipeline
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         example: JOB-0001
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [Raised, Assigned, In Progress, Closed]
 *     responses:
 *       200:
 *         description: Status updated
 *       400:
 *         description: Invalid transition
 *       404:
 *         description: Job not found
 */
router.patch('/:id/status', protect, updateJobStatus);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs/{id}:
 *   delete:
 *     summary: Delete a job (admin only)
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         example: JOB-0001
 *     responses:
 *       200:
 *         description: Job deleted
 *       409:
 *         description: Job has attached reports
 */
router.delete('/:id', protect, authorize('admin'), deleteJob);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs/{id}/images:
 *   post:
 *     summary: Add image(s) to a job
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [file_name, file_url]
 *             properties:
 *               file_name:       { type: string }
 *               file_url:        { type: string }
 *               mime_type:       { type: string }
 *               file_size_bytes: { type: integer }
 *     responses:
 *       201:
 *         description: Image(s) added
 */
router.post('/:id/images', protect, addJobImage);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs/{id}/images/{imageId}:
 *   delete:
 *     summary: Delete a specific image from a job
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: imageId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Image deleted
 */
router.delete('/:id/images/:imageId', protect, authorize('admin', 'manager'), deleteJobImage);

module.exports = router;        