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
  addTechnicalReports,
  getTechnicalReports,
  deleteTechnicalReport,
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
 *         name: client_id
 *         schema: { type: integer }
 *       - in: query
 *         name: po_number
 *         schema: { type: string }
 *         description: Filter by PO Number
 *       - in: query
 *         name: from_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to_date
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: List of reports
 */
router.get('/', protect, getReports);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports:
 *   post:
 *     summary: Submit a new service report
 *     description: |
 *       Submits a report. Status defaults to Pending.
 *       An email with full report details is automatically sent to the client_email.
 *       The po_number field, if provided, must match an existing AMC contract PO Number.
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [job_id, title, technician_id]
 *             properties:
 *               job_id:
 *                 type: string
 *                 example: JOB-0001
 *               title:
 *                 type: string
 *                 example: Quarterly Vacuum Pump Inspection
 *               findings:
 *                 type: string
 *                 example: Pump pressure within normal range. Minor seal wear noted.
 *               recommendations:
 *                 type: string
 *                 example: Replace main seal within 30 days.
 *               technician_id:
 *                 type: integer
 *                 example: 3
 *               po_number:
 *                 type: string
 *                 example: PO-2024-001
 *                 description: Must match an existing AMC contract po_number
 *               location:
 *                 type: string
 *                 example: Building B, Floor 2 - Plant Room
 *               serial_no:
 *                 type: string
 *                 example: VCP-2023-7842
 *               comments:
 *                 type: string
 *                 example: Customer requested additional lubrication check.
 *               client_id:
 *                 type: integer
 *                 example: 5
 *                 description: Optional — overrides the job's client
 *               client_name:
 *                 type: string
 *                 example: Acme Industries Pvt Ltd
 *               client_email:
 *                 type: string
 *                 example: facilities@acme.com
 *                 description: Report notification email will be sent here
 *     responses:
 *       201:
 *         description: Report submitted and email sent to client
 *       400:
 *         description: Validation error (including invalid po_number)
 */
router.post('/', protect, createReport);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/{id}:
 *   get:
 *     summary: Get a single report with images and technical reports
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
 *       404:
 *         description: Report not found
 */
router.get('/:id', protect, getReportById);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/{id}/status:
 *   patch:
 *     summary: Approve or reject a report (admin only)
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
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [Approved, Rejected]
 *               rejection_note:
 *                 type: string
 *     responses:
 *       200:
 *         description: Status updated
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
 *             oneOf:
 *               - $ref: '#/components/schemas/AddImageRequest'
 *               - type: array
 *                 items: { $ref: '#/components/schemas/AddImageRequest' }
 *     responses:
 *       201:
 *         description: Image(s) added
 */
router.post('/:id/images', protect, addReportImage);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/{id}/images/{imageId}:
 *   delete:
 *     summary: Delete a specific image from a report
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
 */
router.delete('/:id/images/:imageId', protect, deleteReportImage);

// ────────────────────────────────────────────────────────────
// Technical Reports (PDFs / documents)
// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/{id}/technical-reports:
 *   post:
 *     summary: Upload/attach technical report documents to a report
 *     description: |
 *       Attach PDF, Word, or image documents as technical reports.
 *       Pass an array (or single object) with file_name, file_url, mime_type, file_size_bytes.
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
 *             oneOf:
 *               - type: object
 *                 required: [file_name, file_url]
 *                 properties:
 *                   file_name:
 *                     type: string
 *                     example: technical_inspection_report.pdf
 *                   file_url:
 *                     type: string
 *                     example: https://yourserver.com/uploads/technical_inspection_report.pdf
 *                   mime_type:
 *                     type: string
 *                     example: application/pdf
 *                   file_size_bytes:
 *                     type: integer
 *                     example: 204800
 *               - type: array
 *                 items:
 *                   type: object
 *                   required: [file_name, file_url]
 *                   properties:
 *                     file_name:
 *                       type: string
 *                     file_url:
 *                       type: string
 *                     mime_type:
 *                       type: string
 *                     file_size_bytes:
 *                       type: integer
 *     responses:
 *       201:
 *         description: Technical report(s) added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: integer }
 *                       report_id: { type: string }
 *                       file_name: { type: string }
 *                       file_url: { type: string }
 *                       mime_type: { type: string }
 *                       file_size_bytes: { type: integer }
 *                       uploaded_at: { type: string, format: date-time }
 *       400:
 *         description: Validation error
 *       404:
 *         description: Report not found
 */
router.post('/:id/technical-reports', protect, addTechnicalReports);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/{id}/technical-reports:
 *   get:
 *     summary: Get all technical report documents for a report
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
 *         description: List of technical report documents
 *       404:
 *         description: Report not found
 */
router.get('/:id/technical-reports', protect, getTechnicalReports);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/{id}/technical-reports/{docId}:
 *   delete:
 *     summary: Delete a specific technical report document
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
 *         name: docId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Technical report document deleted
 *       404:
 *         description: Document not found
 */
router.delete('/:id/technical-reports/:docId', protect, deleteTechnicalReport);

module.exports = router;