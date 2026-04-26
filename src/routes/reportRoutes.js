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
 *       Submits a new service report. Status is always **Pending** on creation.
 *
 *       **technical_reports flow (2 steps):**
 *       1. Upload files first via `POST /api/upload/technical-reports` (multipart) — get back URLs.
 *       2. Pass those URLs in the `technical_reports` array here. They are saved to the DB
 *          inline during report creation. No separate report ID is needed for upload.
 *
 *       **po_number validation:** If provided, it must match an existing AMC contract `po_number`.
 *
 *       **Email:** A full report email is automatically sent to `client_email` on submission.
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
 *                 example: PO-2025-001
 *                 description: Must match an existing AMC contract po_number
 *               location:
 *                 type: string
 *                 example: Building B, Floor 2 — Plant Room
 *               serial_no:
 *                 type: string
 *                 example: VCP-2023-7842
 *               comments:
 *                 type: string
 *                 example: Customer requested additional lubrication check.
 *               client_id:
 *                 type: integer
 *                 example: 5
 *                 description: Optional — overrides the job's linked client
 *               client_name:
 *                 type: string
 *                 example: Acme Industries Pvt Ltd
 *               client_email:
 *                 type: string
 *                 example: facilities@acme.com
 *                 description: Report notification email is sent to this address
 *               technical_reports:
 *                 type: array
 *                 description: |
 *                   Upload files first via POST /api/upload/technical-reports,
 *                   then pass the returned file_name + file_url here.
 *                 items:
 *                   type: object
 *                   required: [file_name, file_url]
 *                   properties:
 *                     file_name:
 *                       type: string
 *                       example: inspection_report_q1.pdf
 *                     file_url:
 *                       type: string
 *                       example: https://yourserver.com/uploads/inspection_report_q1.pdf
 *                     mime_type:
 *                       type: string
 *                       example: application/pdf
 *                     file_size_bytes:
 *                       type: integer
 *                       example: 204800
 *                 example:
 *                   - file_name: inspection_report_q1.pdf
 *                     file_url: https://yourserver.com/uploads/inspection_report_q1.pdf
 *                     mime_type: application/pdf
 *                     file_size_bytes: 204800
 *                   - file_name: site_checklist.pdf
 *                     file_url: https://yourserver.com/uploads/site_checklist.pdf
 *                     mime_type: application/pdf
 *                     file_size_bytes: 102400
 *     responses:
 *       201:
 *         description: Report submitted, technical reports saved, email sent to client
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:                { type: string,  example: RPT-0001 }
 *                     job_id:            { type: string,  example: JOB-0001 }
 *                     title:             { type: string }
 *                     po_number:         { type: string }
 *                     location:          { type: string }
 *                     serial_no:         { type: string }
 *                     comments:          { type: string }
 *                     client_id:         { type: integer }
 *                     client_name:       { type: string }
 *                     client_email:      { type: string }
 *                     technician_id:     { type: integer }
 *                     technician_name:   { type: string }
 *                     status:            { type: string,  example: Pending }
 *                     report_date:       { type: string,  format: date }
 *                     technical_reports:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:              { type: integer }
 *                           file_name:       { type: string }
 *                           file_url:        { type: string }
 *                           mime_type:       { type: string }
 *                           file_size_bytes: { type: integer }
 *                           uploaded_at:     { type: string, format: date-time }
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
 *         description: Report with images[] and technical_reports[] arrays
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
 *     description: Only Pending reports can be reviewed. Status cannot be changed again once set.
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
 *         description: Report status updated
 *       400:
 *         description: Already reviewed or invalid status
 *       404:
 *         description: Report not found
 */
router.patch('/:id/status', protect, authorize('admin'), updateReportStatus);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/{id}/images:
 *   post:
 *     summary: Add image(s) to a report
 *     description: Pass a single object or an array of objects with file_name and file_url.
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
 *                   file_name:       { type: string }
 *                   file_url:        { type: string }
 *                   mime_type:       { type: string, enum: [image/jpeg, image/png, image/webp] }
 *                   file_size_bytes: { type: integer }
 *               - type: array
 *                 items:
 *                   type: object
 *                   required: [file_name, file_url]
 *                   properties:
 *                     file_name:       { type: string }
 *                     file_url:        { type: string }
 *                     mime_type:       { type: string }
 *                     file_size_bytes: { type: integer }
 *     responses:
 *       201:
 *         description: Image(s) added
 *       400:
 *         description: Validation error or max images exceeded
 *       404:
 *         description: Report not found
 */
router.post('/:id/images', protect, addReportImage);

module.exports = router;