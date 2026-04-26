// ============================================================
// src/controllers/uploadController.js
// ============================================================

const pool = require('../config/db');
const path = require('path');
const fs   = require('fs');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');
const { getFileUrl, UPLOAD_DIR } = require('../middleware/uploadMiddleware');

// ────────────────────────────────────────────────────────────
// POST /api/upload
// Body: multipart/form-data, field: images (1–20 files)
// Accepts: JPEG, PNG, WebP
// ────────────────────────────────────────────────────────────
const uploadFiles = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'No files uploaded. Please attach at least one image under the "images" field.');
    }

    const { entity_type, entity_id } = req.query;

    const uploaded = [];

    for (const file of req.files) {
      const fileUrl = getFileUrl(req, file.filename);

      const result = await pool.query(
        `INSERT INTO uploads
           (original_name, stored_name, file_url, mime_type, file_size_bytes,
            entity_type, entity_id, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, original_name, stored_name, file_url, mime_type,
                   file_size_bytes, entity_type, entity_id, uploaded_at`,
        [
          file.originalname,
          file.filename,
          fileUrl,
          file.mimetype,
          file.size,
          entity_type || null,
          entity_id   || null,
          req.user.id,
        ]
      );

      uploaded.push(result.rows[0]);
    }

    return res.status(201).json({
      success: true,
      message: `${uploaded.length} file(s) uploaded successfully.`,
      data:    uploaded,
    });

  } catch (error) {
    console.error('Upload error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/upload/technical-reports
// Upload technical report files (PDF, Word, images).
// No report ID required — call this BEFORE creating the report,
// then pass the returned file_name + file_url into POST /api/reports
// under the technical_reports[] array.
//
// Body: multipart/form-data, field: files (1–10 files)
// Accepts: PDF, JPEG, PNG, WebP, DOC, DOCX
// ────────────────────────────────────────────────────────────
const uploadTechnicalReports = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'No files uploaded. Please attach at least one file under the "files" field.');
    }

    const uploaded = [];

    for (const file of req.files) {
      const fileUrl = getFileUrl(req, file.filename);

      // Record in uploads table with entity_type = 'technical_report'
      const result = await pool.query(
        `INSERT INTO uploads
           (original_name, stored_name, file_url, mime_type, file_size_bytes,
            entity_type, entity_id, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, 'technical_report', NULL, $6)
         RETURNING id, original_name, stored_name, file_url, mime_type,
                   file_size_bytes, uploaded_at`,
        [
          file.originalname,
          file.filename,
          fileUrl,
          file.mimetype,
          file.size,
          req.user.id,
        ]
      );

      const row = result.rows[0];

      // Shape the response to match exactly what POST /api/reports expects
      // in its technical_reports[] array
      uploaded.push({
        id:              row.id,
        file_name:       row.original_name,
        stored_name:     row.stored_name,
        file_url:        row.file_url,
        mime_type:       row.mime_type,
        file_size_bytes: row.file_size_bytes,
        uploaded_at:     row.uploaded_at,
      });
    }

    return res.status(201).json({
      success: true,
      message: `${uploaded.length} technical report file(s) uploaded successfully.`,
      data:    uploaded,
      note:    'Pass these objects in the technical_reports[] array when calling POST /api/reports.',
    });

  } catch (error) {
    console.error('Upload technical reports error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// DELETE /api/upload/:id
// Deletes file from disk AND removes DB record
// ────────────────────────────────────────────────────────────
const deleteFile = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Invalid upload ID.', { field: 'id' });
    }

    const result = await pool.query(
      'SELECT * FROM uploads WHERE id = $1', [id]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, ERROR_CODES.JOB_IMAGE_NOT_FOUND,
        'Upload record not found.');
    }

    const upload = result.rows[0];

    // Delete physical file from disk
    const filePath = path.join(UPLOAD_DIR, upload.stored_name);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await pool.query('DELETE FROM uploads WHERE id = $1', [id]);

    return res.status(200).json({
      success: true,
      message: `File "${upload.original_name}" deleted successfully.`,
    });

  } catch (error) {
    console.error('Delete upload error:', error);
    return Errors.internalError(res);
  }
};

module.exports = { uploadFiles, uploadTechnicalReports, deleteFile };