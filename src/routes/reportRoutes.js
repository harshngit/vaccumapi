// ============================================================
// src/routes/reportRoutes.js
// ============================================================

const express = require('express');
const router  = express.Router();
const {
  getReports,
  createReport,
  getReportById,
  generateReportPdf,
  shareReport,
  updateReportStatus,
  addReportImage,
  addReportDocumentLink,
  getMyReports,
} = require('../controllers/reportController');
const {
  getMonthlyVisitExcel,
  getMonthlyVisitJSON,
} = require('../controllers/visitReportController');
const { protect, authorize } = require('../middleware/authMiddleware');

/**
 * @swagger
 * tags:
 *   name: Reports
 *   description: AMC Service Report management
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
 *     summary: Submit a new AMC service report (Italvacuum Pump)
 *     description: |
 *       Submits a new AMC Service Report matching the PDF form layout.
 *       Status is always **Pending** on creation.
 *
 *       **PDF Pages mapped to API fields:**
 *       - **Page 1** – Client info block (`company_name`, `location`, `contact_person`,
 *         `model_serial_installation`, `operating_hours_per_day`,
 *         `application_process_description`) + `checklist_items[]`
 *       - **Page 2** – `issue_observations[]` (Issue–Observation–Impact matrix)
 *       - **Page 3** – `remarks` (free-text)
 *       - **Page 4** – `mandatory_spares[]` + signature fields
 *         (`vdt_representative_name`, `client_representative_name`)
 *
 *       **technical_reports flow (2 steps):**
 *       1. Upload files via `POST /api/upload/technical-reports` (multipart) — get back URLs.
 *       2. Pass those URLs in the `technical_reports` array here.
 *
 *       **po_number validation:** If provided, must match an existing AMC contract.
 *
 *       **Email:** A full report HTML email is automatically sent to `client_email` on submit.
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
 *                 example: Quarterly AMC Service — Italvacuum Pump
 *               technician_id:
 *                 type: integer
 *                 example: 3
 *               company_name:
 *                 type: string
 *                 example: Acme Industries Pvt Ltd
 *                 description: Client company name (PDF Page 1)
 *               location:
 *                 type: string
 *                 example: Plant Room B, Floor 2
 *                 description: Location / Site (PDF Page 1)
 *               contact_person:
 *                 type: string
 *                 example: Rajesh Mehta
 *                 description: Client contact person (PDF Page 1)
 *               model_serial_installation:
 *                 type: string
 *                 example: "ITPUMP-V2 / SN-20034 / 2021"
 *                 description: Model - Serial No. - Installation Year (PDF Page 1)
 *               operating_hours_per_day:
 *                 type: string
 *                 example: "18 hrs"
 *                 description: Operating Hours / Day (PDF Page 1)
 *               application_process_description:
 *                 type: string
 *                 example: Vacuum drying of pharmaceutical granules
 *                 description: Application / Process Description (PDF Page 1)
 *               checklist_items:
 *                 type: array
 *                 description: Routine Preventive Maintenance Checklist (PDF Page 1)
 *                 items:
 *                   type: object
 *                   required: [sr, description]
 *                   properties:
 *                     sr:
 *                       type: integer
 *                       example: 1
 *                     description:
 *                       type: string
 *                       example: Check the oil level in the oil reserves.
 *                     status:
 *                       type: string
 *                       example: "OK"
 *                       description: >
 *                         Status value. Examples: "OK", "Topped Up", "OK / Topped Up / NA",
 *                         "Normal / Leakage / Blockage", "OK / Cleaned / Replaced",
 *                         "Spare Required", "OK / Adjusted / Replaced", "OK / Done",
 *                         "OK / Replaced / Spare Required"
 *               issue_observations:
 *                 type: array
 *                 description: Issue-Observation-Impact Matrix (PDF Page 2)
 *                 items:
 *                   type: object
 *                   properties:
 *                     sr:
 *                       type: integer
 *                       example: 1
 *                     issue:
 *                       type: string
 *                       example: Low Vaccum
 *                     observation:
 *                       type: string
 *                       example: Valve damage (chock up)
 *                     impact_on_pump:
 *                       type: string
 *                       example: Overheat
 *                     severity:
 *                       type: string
 *                       enum: [Low, Med, High]
 *                       example: Med
 *                     recommended_spares:
 *                       type: string
 *                       example: Valve set
 *               remarks:
 *                 type: string
 *                 example: Pump was running with unusual noise at startup.
 *                 description: Free-text Remarks section (PDF Page 3)
 *               mandatory_spares:
 *                 type: array
 *                 description: Mandatory Spares – AMC Compliance Matrix (PDF Page 4)
 *                 items:
 *                   type: object
 *                   required: [spare_name]
 *                   properties:
 *                     spare_name:
 *                       type: string
 *                       example: Complete set of Gaskets
 *                     pump_model:
 *                       type: string
 *                       example: ITPUMP-V2
 *                     total_to_order:
 *                       type: string
 *                       example: "2"
 *               vdt_representative_name:
 *                 type: string
 *                 example: Suresh Patil
 *                 description: VDT signatory name (PDF Page 4)
 *               client_representative_name:
 *                 type: string
 *                 example: Rajesh Mehta
 *                 description: Client signatory name (PDF Page 4)
 *               po_number:
 *                 type: string
 *                 example: PO-2025-001
 *                 description: Must match an existing AMC contract po_number
 *               serial_no:
 *                 type: string
 *                 example: VCP-2023-7842
 *               findings:
 *                 type: string
 *               recommendations:
 *                 type: string
 *               comments:
 *                 type: string
 *               client_id:
 *                 type: integer
 *               client_name:
 *                 type: string
 *               client_email:
 *                 type: string
 *                 example: facilities@acme.com
 *               technical_reports:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [file_name, file_url]
 *                   properties:
 *                     file_name: { type: string }
 *                     file_url:  { type: string }
 *                     mime_type: { type: string }
 *                     file_size_bytes: { type: integer }
 *     responses:
 *       201:
 *         description: Report created, email sent to client
 *       400:
 *         description: Validation error
 */
router.post('/', protect, createReport);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/my:
 *   get:
 *     summary: Get my service reports (logged-in technician's reports)
 *     description: |
 *       Returns all service reports created by the technician linked to the
 *       logged-in user. Includes summary counts (pending/approved/rejected),
 *       pagination, and optional filters.
 *
 *       If the user has no linked technician profile, returns an empty array
 *       with a message.
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Pending, Approved, Rejected]
 *         description: Filter by report status
 *       - in: query
 *         name: from_date
 *         schema: { type: string, format: date }
 *         description: Filter reports from this date
 *       - in: query
 *         name: to_date
 *         schema: { type: string, format: date }
 *         description: Filter reports up to this date
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: My service reports
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 technician:
 *                   type: object
 *                   properties:
 *                     id: { type: integer }
 *                     name: { type: string }
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total: { type: integer }
 *                     pending: { type: integer }
 *                     approved: { type: integer }
 *                     rejected: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, example: RPT-0001 }
 *                       job_id: { type: string, nullable: true }
 *                       job_title: { type: string, nullable: true }
 *                       job_category: { type: string, nullable: true }
 *                       client_name: { type: string, nullable: true }
 *                       site_location: { type: string, nullable: true }
 *                       client_email: { type: string, nullable: true }
 *                       po_number: { type: string, nullable: true }
 *                       location: { type: string, nullable: true }
 *                       title: { type: string }
 *                       findings: { type: string, nullable: true }
 *                       recommendations: { type: string, nullable: true }
 *                       remarks: { type: string, nullable: true }
 *                       status: { type: string, enum: [Pending, Approved, Rejected] }
 *                       report_date: { type: string, format: date }
 *                       image_count: { type: integer }
 *                       technical_report_count: { type: integer }
 *                       document_count: { type: integer }
 *                       created_at: { type: string, format: date-time }
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       401:
 *         description: Unauthorized
 */
router.get('/my', protect, getMyReports);

// ────────────────────────────────────────────────────────────
// MONTHLY VISIT SCHEDULE REPORT
// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/visit-schedule:
 *   get:
 *     summary: Monthly Visit Schedule — JSON data with summary
 *     description: |
 *       Returns all scheduled visits for a given month/year with status breakdown
 *       and pagination. Use this for dashboard views and tables.
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         required: true
 *         schema: { type: integer, minimum: 1, maximum: 12 }
 *         description: Month number (1–12)
 *         example: 6
 *       - in: query
 *         name: year
 *         required: true
 *         schema: { type: integer }
 *         description: Four-digit year
 *         example: 2026
 *       - in: query
 *         name: technician_id
 *         schema: { type: integer }
 *         description: Filter by technician
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Raised, Assigned, In Progress, Closed]
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [Service, AMC Visit, Breakdown, "Installation & Commissioning", Inspection]
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Monthly visit schedule data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 month: { type: string, example: June }
 *                 year: { type: integer, example: 2026 }
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total_visits: { type: integer }
 *                     completed: { type: integer }
 *                     in_progress: { type: integer }
 *                     assigned: { type: integer }
 *                     pending: { type: integer }
 *                     technicians_involved: { type: integer }
 *                     clients_served: { type: integer }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       job_id: { type: string, example: JOB-0042 }
 *                       title: { type: string }
 *                       scheduled_date: { type: string, format: date }
 *                       raised_date: { type: string, format: date }
 *                       closed_date: { type: string, format: date, nullable: true }
 *                       status: { type: string }
 *                       category: { type: string }
 *                       priority: { type: string }
 *                       amount: { type: number }
 *                       description: { type: string, nullable: true }
 *                       client_name: { type: string }
 *                       site_location: { type: string, nullable: true }
 *                       technician_name: { type: string, nullable: true }
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 */
router.get('/visit-schedule', protect, getMonthlyVisitJSON);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/visit-schedule/excel:
 *   get:
 *     summary: Monthly Visit Schedule — Excel download
 *     description: |
 *       Generates and downloads an Excel (.xlsx) report of all scheduled visits
 *       for the given month/year. Includes color-coded status, summary section,
 *       and breakdown by visit type.
 *
 *       **Response:** Binary .xlsx file download (not JSON).
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         required: true
 *         schema: { type: integer, minimum: 1, maximum: 12 }
 *         description: Month number (1–12)
 *         example: 6
 *       - in: query
 *         name: year
 *         required: true
 *         schema: { type: integer }
 *         description: Four-digit year
 *         example: 2026
 *       - in: query
 *         name: technician_id
 *         schema: { type: integer }
 *         description: Filter by technician
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Raised, Assigned, In Progress, Closed]
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [Service, AMC Visit, Breakdown, "Installation & Commissioning", Inspection]
 *     produces:
 *       - application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 *     responses:
 *       200:
 *         description: Excel file download
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Invalid month value
 */
router.get('/visit-schedule/excel', protect, getMonthlyVisitExcel);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/{id}:
 *   get:
 *     summary: Get a single report with all related data
 *     description: Returns the full report including checklist_items, issue_observations, mandatory_spares, images, and technical_reports.
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
 *         description: Full report object
 *       404:
 *         description: Report not found
 */
router.get('/:id', protect, getReportById);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/{id}/pdf:
 *   get:
 *     summary: Generate and download the AMC Service Report as a PDF
 *     description: |
 *       Generates the full 4-page AMC Service Report PDF matching the official layout
 *       (Vacuum Drying Technology India LLP letterhead, checklist, issue matrix,
 *       mandatory spares, and signature block).
 *
 *       - If **puppeteer** is installed, returns a real `application/pdf` file.
 *       - Otherwise falls back to `text/html` which can be printed to PDF from the browser.
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
 *         description: PDF file (or HTML fallback)
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Report not found
 */
router.get('/:id/pdf', protect, generateReportPdf);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/{id}/share:
 *   post:
 *     summary: Share the AMC Service Report to one or more email addresses
 *     description: |
 *       Sends the full AMC Service Report as a rich HTML email to the provided recipient(s).
 *       The email includes all report sections: client info, checklist, issue matrix,
 *       mandatory spares, and links to any attached technical documents.
 *
 *       Useful for sending the report to the client, a manager, or any third party
 *       after it has been created.
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
 *             required: [to]
 *             properties:
 *               to:
 *                 oneOf:
 *                   - type: string
 *                     example: client@example.com
 *                   - type: array
 *                     items: { type: string }
 *                     example: [client@example.com, manager@example.com]
 *                 description: Recipient email address(es)
 *               subject:
 *                 type: string
 *                 example: "Your AMC Service Report RPT-0001 — Quarterly Inspection"
 *                 description: Custom email subject (optional — default is auto-generated)
 *               message:
 *                 type: string
 *                 example: "Please find your service report attached. Let us know if you have any questions."
 *                 description: Optional personal message shown at the top of the email body
 *     responses:
 *       200:
 *         description: Report shared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:    { type: boolean }
 *                 message:    { type: string }
 *                 recipients: { type: array, items: { type: string } }
 *       400:
 *         description: Missing or invalid email address
 *       404:
 *         description: Report not found
 */
router.post('/:id/share', protect, shareReport);

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

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/reports/{id}/documents:
 *   post:
 *     summary: Add document link(s) to an existing report
 *     description: |
 *       Attach one or more document links to a report by ID.
 *       Pass a single item or an array. Each item is either a plain URL
 *       string or an object with file_url (and optional file_name,
 *       mime_type, file_size_bytes).
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
 *               - type: string
 *                 example: 'https://yourserver.com/uploads/doc.pdf'
 *               - type: object
 *                 required: [file_url]
 *                 properties:
 *                   file_url:        { type: string }
 *                   file_name:       { type: string }
 *                   mime_type:       { type: string }
 *                   file_size_bytes: { type: integer }
 *               - type: array
 *                 items:
 *                   type: object
 *                   required: [file_url]
 *                   properties:
 *                     file_url:        { type: string }
 *                     file_name:       { type: string }
 *                     mime_type:       { type: string }
 *                     file_size_bytes: { type: integer }
 *     responses:
 *       201:
 *         description: Document link(s) added
 *       400:
 *         description: Validation error
 *       404:
 *         description: Report not found
 */
router.post('/:id/documents', protect, addReportDocumentLink);

module.exports = router;