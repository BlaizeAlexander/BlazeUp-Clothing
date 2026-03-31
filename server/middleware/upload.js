// ============================================================
// middleware/upload.js — Secure multer configuration
// ============================================================

const multer = require('multer');
const path   = require('path');
const crypto = require('crypto');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const ALLOWED_EXT  = new Set(['.jpg', '.jpeg', '.png']);
const MAX_BYTES    = 10 * 1024 * 1024; // 10 MB

/**
 * Validate file by both declared MIME type and file extension.
 *
 * Note for production: consider adding the `file-type` package to
 * inspect actual magic bytes instead of trusting multer's MIME
 * detection (which comes from the Content-Type the client sends).
 */
function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(Object.assign(new Error('Only JPG and PNG images are allowed.'), { status: 400 }));
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return cb(Object.assign(new Error('Invalid file extension.'), { status: 400 }));
  }
  cb(null, true);
}

/** Build a diskStorage that saves files with UUID-based names. */
function makeStorage(dest) {
  return multer.diskStorage({
    destination: dest,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      // UUID filename prevents path traversal and enumeration attacks
      cb(null, `${crypto.randomUUID()}${ext}`);
    }
  });
}

const UPLOADS_DIR = path.join(__dirname, '../../public/uploads');
const ASSETS_DIR  = path.join(__dirname, '../../public/assets');

// For payment proof screenshots
const uploadPayment = multer({
  storage: makeStorage(UPLOADS_DIR),
  limits:  { fileSize: MAX_BYTES },
  fileFilter
});

// For product images
const uploadProduct = multer({
  storage: makeStorage(ASSETS_DIR),
  limits:  { fileSize: MAX_BYTES },
  fileFilter
});

// For the payment QR code — always overwrites with the same filename
// so the frontend can reference a stable path.
const uploadQR = multer({
  storage: multer.diskStorage({
    destination: ASSETS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `qr-payment${ext}`);
    }
  }),
  limits:    { fileSize: MAX_BYTES },
  fileFilter
});

/**
 * Error handler for multer upload errors.
 * Use as the 4-argument error middleware directly after multer middleware.
 *
 *   router.post('/upload', upload.single('file'), handleUploadError, handler);
 */
function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'File too large. Maximum size is 10 MB.'
      : `Upload error: ${err.message}`;
    return res.status(400).json({ error: msg });
  }
  if (err && err.message) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  next(err);
}

module.exports = { uploadPayment, uploadProduct, uploadQR, handleUploadError };
