// ============================================================
// src/controllers/technicianDocController.js
// ============================================================

const pool = require('../config/db');
const path = require('path');
const fs   = require('fs');
const { sendError, Errors } = require('../utils/AppError');
const ERROR_CODES = require('../utils/errorCodes');
const { logActivity } = require('./activityController');
const { getFileUrl, UPLOAD_DIR } = require('../middleware/uploadMiddleware');

const VALID_DOC_TYPES = [
  'Aadhaar Card',
  'Technician Photo',
  'WC Policy',
  'Medical Insurance Policy',
  'Other',
];

// ────────────────────────────────────────────────────────────
// POST /api/upload/technician-documents
// Upload document files WITHOUT linking to a technician yet.
// Returns file metadata so frontend can later attach via POST
// /api/technicians/:id/documents
// ────────────────────────────────────────────────────────────
const uploadTechnicianDocFiles = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'No files uploaded. Please attach at least one file under the "files" field.');
    }

    const { document_type, document_name, expiry_date, notes } = req.query;

    if (document_type && !VALID_DOC_TYPES.includes(document_type)) {
      return sendError(res, 400, ERROR_CODES.INVALID_DOCUMENT_TYPE,
        `Invalid document_type. Allowed: ${VALID_DOC_TYPES.join(', ')}.`,
        { allowed: VALID_DOC_TYPES });
    }

    const uploaded = [];

    for (const file of req.files) {
      const fileUrl = getFileUrl(req, file.filename);

      const result = await pool.query(
        `INSERT INTO uploads
           (original_name, stored_name, file_url, mime_type, file_size_bytes,
            entity_type, entity_id, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, 'technician_document', NULL, $6)
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
      uploaded.push({
        id:              row.id,
        file_name:       row.original_name,
        stored_name:     row.stored_name,
        file_url:        row.file_url,
        mime_type:       row.mime_type,
        file_size_bytes: row.file_size_bytes,
        uploaded_at:     row.uploaded_at,
        document_type:   document_type || null,
        document_name:   document_name || row.original_name,
        expiry_date:     expiry_date || null,
        notes:           notes || null,
      });
    }

    return res.status(201).json({
      success: true,
      message: `${uploaded.length} file(s) uploaded successfully.`,
      data:    uploaded,
      note:    'Use file_name + file_url when calling POST /api/technicians/:id/documents.',
    });

  } catch (error) {
    console.error('Upload technician doc files error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// POST /api/technicians/:id/documents
// Attach document metadata to a technician.
// Body: { document_type, document_name, file_name, file_url,
//         mime_type?, file_size_bytes?, expiry_date?, notes? }
// ────────────────────────────────────────────────────────────
const addTechnicianDocument = async (req, res) => {
  try {
    const techId = parseInt(req.params.id);
    if (isNaN(techId)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Invalid technician ID.', { field: 'id' });
    }

    const techCheck = await pool.query(
      'SELECT id, name FROM technicians WHERE id = $1', [techId]
    );
    if (techCheck.rows.length === 0) return Errors.technicianNotFound(res);

    const {
      document_type,
      document_name,
      file_name,
      file_url,
      mime_type = 'application/pdf',
      file_size_bytes,
      expiry_date,
      notes,
    } = req.body;

    const missing = [];
    if (!document_type) missing.push('document_type');
    if (!document_name) missing.push('document_name');
    if (!file_name)     missing.push('file_name');
    if (!file_url)      missing.push('file_url');
    if (missing.length > 0) {
      return sendError(res, 400, ERROR_CODES.MISSING_REQUIRED_FIELDS,
        `Missing required fields: ${missing.join(', ')}.`,
        { missing_fields: missing });
    }

    if (!VALID_DOC_TYPES.includes(document_type)) {
      return sendError(res, 400, ERROR_CODES.INVALID_DOCUMENT_TYPE,
        `Invalid document_type. Allowed: ${VALID_DOC_TYPES.join(', ')}.`,
        { allowed: VALID_DOC_TYPES });
    }

    const result = await pool.query(
      `INSERT INTO technician_documents
         (technician_id, document_type, document_name, file_name, file_url,
          mime_type, file_size_bytes, expiry_date, notes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        techId,
        document_type,
        document_name.trim(),
        file_name,
        file_url,
        mime_type,
        file_size_bytes || null,
        expiry_date || null,
        notes || null,
        req.user.id,
      ]
    );

    await logActivity({
      type:         'technician',
      action:       `Document "${document_name}" (${document_type}) added for technician "${techCheck.rows[0].name}"`,
      entity_type:  'technician',
      entity_id:    String(techId),
      performed_by: req.user.id,
    });

    return res.status(201).json({
      success: true,
      message: `Document "${document_name}" added successfully.`,
      data:    result.rows[0],
    });

  } catch (error) {
    console.error('Add technician document error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/technicians/:id/documents
// List all documents for a technician
// ────────────────────────────────────────────────────────────
const getTechnicianDocuments = async (req, res) => {
  try {
    const techId = parseInt(req.params.id);
    if (isNaN(techId)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Invalid technician ID.', { field: 'id' });
    }

    const techCheck = await pool.query(
      'SELECT id FROM technicians WHERE id = $1', [techId]
    );
    if (techCheck.rows.length === 0) return Errors.technicianNotFound(res);

    const { document_type } = req.query;

    let query = `
      SELECT td.*, u.first_name || ' ' || u.last_name AS uploaded_by_name
      FROM technician_documents td
      LEFT JOIN users u ON u.id = td.uploaded_by
      WHERE td.technician_id = $1
    `;
    const values = [techId];

    if (document_type) {
      if (!VALID_DOC_TYPES.includes(document_type)) {
        return sendError(res, 400, ERROR_CODES.INVALID_DOCUMENT_TYPE,
          `Invalid document_type filter. Allowed: ${VALID_DOC_TYPES.join(', ')}.`);
      }
      values.push(document_type);
      query += ` AND td.document_type = $${values.length}`;
    }

    query += ' ORDER BY td.document_type, td.created_at DESC';

    const result = await pool.query(query, values);

    return res.status(200).json({
      success: true,
      total:   result.rows.length,
      data:    result.rows,
    });

  } catch (error) {
    console.error('Get technician documents error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// PUT /api/technicians/:id/documents/:docId
// Update document metadata (expiry_date, notes, document_name)
// ────────────────────────────────────────────────────────────
const updateTechnicianDocument = async (req, res) => {
  try {
    const techId = parseInt(req.params.id);
    const docId  = parseInt(req.params.docId);
    if (isNaN(techId) || isNaN(docId)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Invalid technician ID or document ID.');
    }

    const docCheck = await pool.query(
      'SELECT * FROM technician_documents WHERE id = $1 AND technician_id = $2',
      [docId, techId]
    );
    if (docCheck.rows.length === 0) {
      return sendError(res, 404, ERROR_CODES.TECHNICIAN_DOC_NOT_FOUND,
        'Document not found for this technician.');
    }

    const cur = docCheck.rows[0];
    const { document_name, expiry_date, notes } = req.body;

    if (!document_name && expiry_date === undefined && notes === undefined) {
      return sendError(res, 400, ERROR_CODES.NO_FIELDS_TO_UPDATE,
        'No fields provided to update.');
    }

    const newName   = document_name ? document_name.trim() : cur.document_name;
    const newExpiry = expiry_date !== undefined ? (expiry_date || null) : cur.expiry_date;
    const newNotes  = notes !== undefined ? (notes || null) : cur.notes;

    const result = await pool.query(
      `UPDATE technician_documents
       SET document_name = $1, expiry_date = $2, notes = $3
       WHERE id = $4
       RETURNING *`,
      [newName, newExpiry, newNotes, docId]
    );

    return res.status(200).json({
      success: true,
      message: 'Document updated successfully.',
      data:    result.rows[0],
    });

  } catch (error) {
    console.error('Update technician document error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// DELETE /api/technicians/:id/documents/:docId
// Delete a technician document record.
// Does NOT delete the physical file from /uploads (use
// DELETE /api/upload/:id for that if needed).
// ────────────────────────────────────────────────────────────
const deleteTechnicianDocument = async (req, res) => {
  try {
    const techId = parseInt(req.params.id);
    const docId  = parseInt(req.params.docId);
    if (isNaN(techId) || isNaN(docId)) {
      return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR,
        'Invalid technician ID or document ID.');
    }

    const docCheck = await pool.query(
      'SELECT * FROM technician_documents WHERE id = $1 AND technician_id = $2',
      [docId, techId]
    );
    if (docCheck.rows.length === 0) {
      return sendError(res, 404, ERROR_CODES.TECHNICIAN_DOC_NOT_FOUND,
        'Document not found for this technician.');
    }

    const doc = docCheck.rows[0];

    // Try to delete physical file if it's a local upload
    try {
      const urlParts = doc.file_url.split('/uploads/');
      if (urlParts.length === 2) {
        const filePath = path.join(UPLOAD_DIR, urlParts[1]);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    } catch (_) { /* ignore file delete errors */ }

    await pool.query('DELETE FROM technician_documents WHERE id = $1', [docId]);

    await logActivity({
      type:         'technician',
      action:       `Document "${doc.document_name}" (${doc.document_type}) removed from technician #${techId}`,
      entity_type:  'technician',
      entity_id:    String(techId),
      performed_by: req.user.id,
    });

    return res.status(200).json({
      success: true,
      message: `Document "${doc.document_name}" deleted successfully.`,
    });

  } catch (error) {
    console.error('Delete technician document error:', error);
    return Errors.internalError(res);
  }
};

// ────────────────────────────────────────────────────────────
// GET /api/technicians/documents/expiring
// List documents expiring within N days (default 30)
// ────────────────────────────────────────────────────────────
const getExpiringDocuments = async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.query.days) || 30);

    const result = await pool.query(
      `SELECT td.*, t.name AS technician_name, t.phone AS technician_phone
       FROM technician_documents td
       JOIN technicians t ON t.id = td.technician_id
       WHERE td.expiry_date IS NOT NULL
         AND td.expiry_date <= CURRENT_DATE + $1 * INTERVAL '1 day'
       ORDER BY td.expiry_date ASC`,
      [days]
    );

    const expired  = [];
    const expiring = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const row of result.rows) {
      const exp = new Date(row.expiry_date);
      exp.setHours(0, 0, 0, 0);
      if (exp < today) {
        row.expiry_status = 'expired';
        expired.push(row);
      } else {
        row.expiry_status = 'expiring_soon';
        expiring.push(row);
      }
    }

    return res.status(200).json({
      success: true,
      days_window: days,
      summary: {
        expired:       expired.length,
        expiring_soon: expiring.length,
        total:         result.rows.length,
      },
      data: { expired, expiring },
    });

  } catch (error) {
    console.error('Get expiring documents error:', error);
    return Errors.internalError(res);
  }
};

module.exports = {
  uploadTechnicianDocFiles,
  addTechnicianDocument,
  getTechnicianDocuments,
  updateTechnicianDocument,
  deleteTechnicianDocument,
  getExpiringDocuments,
};
