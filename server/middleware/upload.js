// ============================================================
// middleware/upload.js — Multer + Supabase Storage
// Files are held in memory by multer, then pushed to Supabase.
// Nothing is written to the local disk, so images survive
// Render restarts.
// ============================================================

const multer  = require('multer');
const path    = require('path');
const crypto  = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const ALLOWED_EXT  = new Set(['.jpg', '.jpeg', '.png']);
const MAX_BYTES    = 10 * 1024 * 1024; // 10 MB

const supabase = createClient(
  (process.env.SUPABASE_URL || '').trim(),
  (process.env.SUPABASE_SERVICE_KEY || '').trim()
);

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

/**
 * Upload a multer file (from memoryStorage) to a Supabase Storage bucket.
 * Returns the public URL of the uploaded file.
 */
async function uploadToSupabase(file, bucket) {
  const ext      = path.extname(file.originalname).toLowerCase();
  const filename = `${crypto.randomUUID()}${ext}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(filename, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) {
    throw Object.assign(new Error(`Storage upload failed: ${error.message}`), { status: 500 });
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
  return data.publicUrl;
}

// All three multer instances use memory storage — no disk writes.
const memStorage = multer.memoryStorage();
const opts = { storage: memStorage, limits: { fileSize: MAX_BYTES }, fileFilter };

const avatarOpts = { storage: memStorage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter };

const uploadPayment = multer(opts);
const uploadProduct = multer(opts);
const uploadQR      = multer(opts);
const uploadAvatar  = multer(avatarOpts);

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

module.exports = { uploadPayment, uploadProduct, uploadQR, uploadAvatar, handleUploadError, uploadToSupabase };
