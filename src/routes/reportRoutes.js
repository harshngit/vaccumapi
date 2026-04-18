// ============================================================
// src/routes/reportRoutes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const {
  getReports,
  createReport,
  getReportById,
  updateReportStatus,
  addReportImage,
  deleteReportImage,
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Reports
 *   description: Service report management
 */

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports:
 *   get:
 *     summary: List all service reports with optional filters
 *     tags: [Reports]
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
 *           enum: [Pending, Approved, Rejected]
 *       - in: query
 *         name: technician_id
 *         schema: { type: integer }
 *       - in: query
 *         name: job_id
 *         schema: { type: string }
 *         description: e.g. JOB-0001
 *       - in: query
 *         name: from_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to_date
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: List of reports
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedReportsResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/', protect, getReports);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports:
 *   post:
 *     summary: Submit a new service report
 *     description: Typically submitted by a technician after completing a job. Status is always Pending on creation.
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateReportRequest'
 *     responses:
 *       201:
 *         description: Report submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *                 data:
 *                   $ref: '#/components/schemas/ReportResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/', protect, createReport);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/{id}:
 *   get:
 *     summary: Get a single report with images
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         example: RPT-0001
 *     responses:
 *       200:
 *         description: Report found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/ReportDetailResponse'
 *       404:
 *         description: Report not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/:id', protect, getReportById);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/{id}/status:
 *   patch:
 *     summary: Approve or reject a report (admin only)
 *     description: |
 *       Only `Pending` reports can be reviewed.
 *       Once approved or rejected, the status cannot be changed again.
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         example: RPT-0001
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateReportStatusRequest'
 *     responses:
 *       200:
 *         description: Report status updated
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
 *                     id:                    { type: string, example: RPT-0001 }
 *                     status:                { type: string, example: Approved }
 *                     approved_by_user_id:   { type: integer }
 *                     approved_at:           { type: string, format: date-time }
 *       400:
 *         description: Already reviewed or invalid status
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Report not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/:id/status', protect, authorize('admin'), updateReportStatus);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/{id}/images:
 *   post:
 *     summary: Add image(s) to a report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         example: RPT-0001
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
router.post('/:id/images', protect, addReportImage);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/{id}/images/{imageId}:
 *   delete:
 *     summary: Delete a specific image from a report
 *     description: |
 *       Admin can delete any image.
 *       Technicians can only delete images from their own Pending reports.
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         example: RPT-0001
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
 *       403:
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Report or image not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.delete('/:id/images/:imageId', protect, deleteReportImage);

module.exports = router;
