// ============================================================
// src/routes/uploadRoutes.js
// ============================================================

const express  = require('express');
const router   = express.Router();
const { uploadFiles, deleteFile } = require('../controllers/uploadController');
const { protect } = require('../middleware/authMiddleware');
const { upload, handleUploadErrors } = require('../middleware/uploadMiddleware');

/**
 * @swagger
 * tags:
 *   name: Upload
 *   description: Local file upload — returns public URLs for use in job/report image APIs
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
 *
 *       **Optional query params:**
 *       - `entity_type` — `job` or `report`
 *       - `entity_id` — e.g. `JOB-0001` or `RPT-0001`
 *
 *       These are just for record-keeping — they do not link the file to the job/report automatically.
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: entity_type
 *         schema:
 *           type: string
 *           enum: [job, report]
 *         description: Optional — which module this upload belongs to
 *       - in: query
 *         name: entity_id
 *         schema: { type: string }
 *         description: Optional — e.g. JOB-0001 or RPT-0001
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: '2 file(s) uploaded successfully.' }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/UploadResponse'
 *       400:
 *         description: No files, invalid type, or file too large
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
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
 *         description: Upload record ID
 *     responses:
 *       200:
 *         description: File deleted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessMessageResponse' }
 *       404:
 *         description: Upload not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.delete('/:id', protect, deleteFile);

module.exports = router;
