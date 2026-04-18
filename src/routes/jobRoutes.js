// ============================================================
// src/routes/jobRoutes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const {
  getJobs,
  createJob,
  getJobById,
  updateJob,
  updateJobStatus,
  deleteJob,
  addJobImage,
  deleteJobImage,
} = require('../controllers/jobController');
const { protect, authorize } = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Jobs
 *   description: Work order management
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
 *           enum: [Maintenance, Repair, Installation, Inspection]
 *       - in: query
 *         name: client_id
 *         schema: { type: integer }
 *       - in: query
 *         name: technician_id
 *         schema: { type: integer }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by job ID or title
 *       - in: query
 *         name: from_date
 *         schema: { type: string, format: date }
 *         description: Filter raised_date >= from_date
 *       - in: query
 *         name: to_date
 *         schema: { type: string, format: date }
 *         description: Filter raised_date <= to_date
 *     responses:
 *       200:
 *         description: List of jobs
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedJobsResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/', protect, getJobs);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs:
 *   post:
 *     summary: Raise a new work order
 *     description: |
 *       Creates a new job. If `technician_id` is provided at creation,
 *       the status is automatically set to `Assigned`, otherwise it starts as `Raised`.
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateJobRequest'
 *     responses:
 *       201:
 *         description: Job raised successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *                 data:
 *                   $ref: '#/components/schemas/JobResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/', protect, authorize('admin', 'manager', 'engineer'), createJob);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs/{id}:
 *   get:
 *     summary: Get a single job with images and linked reports
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
 *         description: Job found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/JobDetailResponse'
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
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
 *             $ref: '#/components/schemas/UpdateJobRequest'
 *     responses:
 *       200:
 *         description: Job updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   $ref: '#/components/schemas/JobResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put('/:id', protect, authorize('admin', 'manager', 'engineer'), updateJob);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs/{id}/status:
 *   patch:
 *     summary: Advance job status through the pipeline
 *     description: |
 *       Valid forward-only transitions:
 *       - `Raised` → `Assigned`
 *       - `Assigned` → `In Progress`
 *       - `In Progress` → `Closed`
 *
 *       Technicians can only advance their own assigned jobs.
 *       Closing a job auto-sets `closed_date` and increments the technician's `jobs_completed`.
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
 *             $ref: '#/components/schemas/UpdateJobStatusRequest'
 *     responses:
 *       200:
 *         description: Status updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:          { type: string, example: JOB-0001 }
 *                     status:      { type: string, example: In Progress }
 *                     closed_date: { type: string, format: date, nullable: true }
 *                     updated_at:  { type: string, format: date-time }
 *       400:
 *         description: Invalid transition or missing technician
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/:id/status', protect, updateJobStatus);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs/{id}:
 *   delete:
 *     summary: Delete a job (admin only)
 *     description: Cannot delete a job that has attached reports.
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessMessageResponse' }
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Job has attached reports
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.delete('/:id', protect, authorize('admin'), deleteJob);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs/{id}/images:
 *   post:
 *     summary: Add image(s) to a job
 *     description: |
 *       Pass a single image object or an array of image objects.
 *       Actual file upload to S3/storage is handled separately — this endpoint
 *       stores the resulting URL and metadata.
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
 *             $ref: '#/components/schemas/AddImageRequest'
 *     responses:
 *       201:
 *         description: Image(s) added
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/ImageResponse' }
 *       400:
 *         description: Validation error or max images exceeded
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
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
 *         example: JOB-0001
 *       - in: path
 *         name: imageId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Image deleted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessMessageResponse' }
 *       404:
 *         description: Job or image not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.delete('/:id/images/:imageId', protect, authorize('admin', 'manager'), deleteJobImage);

module.exports = router;
