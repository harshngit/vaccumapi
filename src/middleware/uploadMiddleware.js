// ============================================================
// src/middleware/uploadMiddleware.js
// Local file upload using Multer
// Files are saved to /uploads folder in the project root.
// Public URL: {BASE_URL}/uploads/{stored_filename}
// ============================================================

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const { sendError } = require('../utils/AppError');
const ERROR_CODES   = require('../utils/errorCodes');

// ─── Ensure uploads directory exists ─────────────────────────
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ─── Allowed MIME types ───────────────────────────────────────
const IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',   // some Android cameras
  'image/png',
  'image/webp',
  'image/heic',  // iOS camera
  'image/heif',  // iOS camera
  'application/octet-stream', // some Android cameras send this for photos
];

const DOC_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/octet-stream',
  'application/msword',                                                          // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',    // .docx
];

const MAX_IMAGE_SIZE_MB = parseInt(process.env.MAX_IMAGE_SIZE_MB || '50');
const MAX_DOC_SIZE_MB   = parseInt(process.env.MAX_DOC_SIZE_MB   || '50');

// ─── Shared disk storage ──────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safeName}`);
  },
});

// ─── Image-only filter ────────────────────────────────────────
const imageFileFilter = (req, file, cb) => {
  if (IMAGE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  }
};

// ─── Document filter (PDF + Word + images) ───────────────────
const docFileFilter = (req, file, cb) => {
  if (DOC_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  }
};

// ─── Multer instances ─────────────────────────────────────────

// For POST /api/upload  (images only)
const upload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: MAX_IMAGE_SIZE_MB * 1024 * 1024,
    files:    20,
  },
});

// For POST /api/upload/technical-reports  (PDF, Word, images)
const uploadDocs = multer({
  storage,
  fileFilter: docFileFilter,
  limits: {
    fileSize: MAX_DOC_SIZE_MB * 1024 * 1024,
    files:    10,
  },
});

// For POST /api/upload/report-files  (any file type — images, PDFs, etc.)
const uploadAny = multer({
  storage,
  limits: {
    fileSize: MAX_DOC_SIZE_MB * 1024 * 1024,
    files:    10,
  },
});

// ─── Error handler wrapper ────────────────────────────────────
const handleUploadErrors = (uploadMiddleware) => {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (!err) return next();

      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return sendError(res, 400, ERROR_CODES.INVALID_FILE_TYPE,
            `File too large. Maximum allowed size is ${MAX_DOC_SIZE_MB}MB per file.`);
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return sendError(res, 400, ERROR_CODES.TOO_MANY_IMAGES,
            'Too many files uploaded at once.');
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return sendError(res, 400, ERROR_CODES.INVALID_FILE_TYPE,
            'Invalid file type. Images: JPEG, PNG, WebP. Documents: PDF, DOC, DOCX.',
            { allowed_images: IMAGE_TYPES, allowed_docs: DOC_TYPES });
        }
        return sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, err.message);
      }

      next(err);
    });
  };
};

// ─── Build public URL ─────────────────────────────────────────
const getFileUrl = (req, filename) => {
  const base = process.env.BASE_URL ||
    `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/uploads/${filename}`;
};

module.exports = { upload, uploadDocs, uploadAny, handleUploadErrors, getFileUrl, UPLOAD_DIR };