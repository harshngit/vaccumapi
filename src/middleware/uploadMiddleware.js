// ============================================================
// src/middleware/uploadMiddleware.js
// Local file upload using Multer — for Railway production server
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
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB   = parseInt(process.env.MAX_IMAGE_SIZE_MB || '10');

// ─── Storage: save to /uploads with timestamped filename ─────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // e.g. 1714012345678_site_before.jpg
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const stored   = `${Date.now()}_${safeName}`;
    cb(null, stored);
  },
});

// ─── File type filter ─────────────────────────────────────────
const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  }
};

// ─── Multer instance ──────────────────────────────────────────
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_SIZE_MB * 1024 * 1024,
    files: 20,
  },
});

// ─── Error handler wrapper ────────────────────────────────────
// Wraps multer errors into our standard sendError format
const handleUploadErrors = (uploadMiddleware) => {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (!err) return next();

      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return sendError(res, 400, ERROR_CODES.INVALID_FILE_TYPE,
            `File too large. Maximum allowed size is ${MAX_SIZE_MB}MB per image.`);
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return sendError(res, 400, ERROR_CODES.TOO_MANY_IMAGES,
            'Too many files. Maximum 20 images allowed per upload.');
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return sendError(res, 400, ERROR_CODES.INVALID_FILE_TYPE,
            'Invalid file type. Only JPEG, PNG, and WebP images are allowed.',
            { allowed: ALLOWED_TYPES });
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
  return `${base}/uploads/${filename}`;
};

module.exports = { upload, handleUploadErrors, getFileUrl, UPLOAD_DIR };
