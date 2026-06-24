// ============================================================
// src/routes/uploadRoutes.js
// ============================================================

const express  = require('express');
const router   = express.Router();
const { uploadFiles, uploadTechnicalReports, uploadDocumentLinks, deleteFile } = require('../controllers/uploadController');
const { uploadTechnicianDocFiles } = require('../controllers/technicianDocController');
const { protect } = require('../middleware/authMiddleware');
const { upload, uploadDocs, handleUploadErrors } = require('../middleware/uploadMiddleware');

/**
 * @swagger
 * tags:
 *   name: Upload
 *   description: File upload — returns public URLs for use in other APIs
 */

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/upload:
 *   post:
 *     summary: Upload one or more images
 *     description: |
 *       Upload images to the server. Returns public URLs that you then pass into:
 *       - `POST /api/jobs/:id/images`
 *       - `POST /api/reports/:id/images`
 *
 *       **Accepted types:** JPEG, PNG, WebP — max 10MB each, max 20 files per request.
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: entity_type
 *         schema:
 *           type: string
 *           enum: [job, report]
 *         description: Optional — for record-keeping only
 *       - in: query
 *         name: entity_id
 *         schema: { type: string }
 *         description: Optional — e.g. JOB-0001
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [images]
 *             properties:
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: One or more image files (JPEG, PNG, WebP)
 *     responses:
 *       201:
 *         description: Files uploaded successfully
 *       400:
 *         description: No files, invalid type, or file too large
 */
router.post(
  '/',
  protect,
  handleUploadErrors(upload.array('images', 20)),
  uploadFiles
);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/upload/technical-reports:
 *   post:
 *     summary: Upload technical report documents (PDF, Word, images)
 *     description: |
 *       Upload one or more technical report files **before** creating the report.
 *       No report ID is needed at this stage.
 *
 *       **Typical flow:**
 *       1. Call `POST /api/upload/technical-reports` with your files (multipart).
 *       2. Take the `file_name` + `file_url` from the response.
 *       3. Pass them in the `technical_reports[]` array when calling `POST /api/reports`.
 *
 *       **Accepted types:** PDF, JPEG, PNG, WebP, DOC, DOCX
 *       **Limits:** Max 20MB each, max 10 files per request.
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [files]
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: One or more document files (PDF, Word, images)
 *     responses:
 *       201:
 *         description: Files uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *                 note:
 *                   type: string
 *                   example: Pass these objects in the technical_reports[] array when calling POST /api/reports.
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:              { type: integer }
 *                       file_name:       { type: string, example: inspection_report.pdf }
 *                       stored_name:     { type: string }
 *                       file_url:        { type: string, example: 'https://yourserver.com/uploads/1714012345678_inspection_report.pdf' }
 *                       mime_type:       { type: string, example: application/pdf }
 *                       file_size_bytes: { type: integer }
 *                       uploaded_at:     { type: string, format: date-time }
 *       400:
 *         description: No files, invalid type, or file too large
 */
router.post(
  '/technical-reports',
  protect,
  handleUploadErrors(uploadDocs.array('files', 10)),
  uploadTechnicalReports
);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/upload/document-links:
 *   post:
 *     summary: Upload document(s) for upload_document_link[]
 *     description: |
 *       "Normal" document upload. Upload one or more documents and get
 *       back URLs to place in the `upload_document_link[]` array when
 *       calling `POST /api/reports`, or POST to `/api/reports/:id/documents`.
 *
 *       **Accepted types:** PDF, JPEG, PNG, WebP, DOC, DOCX
 *       **Limits:** Max 20MB each, max 10 files per request.
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [files]
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: One or more document files (PDF, Word, images)
 *     responses:
 *       201:
 *         description: Files uploaded successfully
 *       400:
 *         description: No files, invalid type, or file too large
 */
router.post(
  '/document-links',
  protect,
  handleUploadErrors(uploadDocs.array('files', 10)),
  uploadDocumentLinks
);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/upload/technician-documents:
 *   post:
 *     summary: Upload technician document files (PDF, JPG, PNG)
 *     description: |
 *       Upload one or more technician document files **before** attaching them.
 *       No technician ID is needed at this stage.
 *
 *       **Typical flow:**
 *       1. Call `POST /api/upload/technician-documents` with your files (multipart).
 *       2. Take the `file_name` + `file_url` from the response.
 *       3. Pass them when calling `POST /api/technicians/:id/documents`.
 *
 *       **Accepted types:** PDF, JPEG, PNG, WebP, DOC, DOCX
 *       **Limits:** Max 20MB each, max 10 files per request.
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: document_type
 *         schema:
 *           type: string
 *           enum: [Aadhaar Card, Technician Photo, WC Policy, Medical Insurance Policy, Other]
 *         description: Optional — pre-tag the upload with a document type
 *       - in: query
 *         name: document_name
 *         schema: { type: string }
 *         description: Optional — user-facing label (defaults to original filename)
 *       - in: query
 *         name: expiry_date
 *         schema: { type: string, format: date }
 *         description: Optional — document expiry date (e.g. 2026-12-31)
 *       - in: query
 *         name: notes
 *         schema: { type: string }
 *         description: Optional — notes about the document
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [files]
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: One or more document files (PDF, JPG, PNG, WebP, DOC, DOCX)
 *     responses:
 *       201:
 *         description: Files uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *                 note:
 *                   type: string
 *                   example: Use file_name + file_url when calling POST /api/technicians/:id/documents.
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TechnicianDocUploadItem'
 *       400:
 *         description: No files, invalid type, or file too large
 */
router.post(
  '/technician-documents',
  protect,
  handleUploadErrors(uploadDocs.array('files', 10)),
  uploadTechnicianDocFiles
);

// ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/upload/{id}:
 *   delete:
 *     summary: Delete an uploaded file by ID
 *     description: Deletes the file from disk AND removes the database record.
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: File deleted
 *       404:
 *         description: Upload not found
 */
router.delete('/:id', protect, deleteFile);

module.exports = router;