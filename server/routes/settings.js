// ============================================================
// routes/settings.js — App settings & payment QR code
// ============================================================

const express = require('express');
const { query } = require('../db');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const { uploadQR, handleUploadError, uploadToSupabase } = require('../middleware/upload');

const router = express.Router();

const mapSettings = r => ({
  pointsSystemEnabled:  r.points_system_enabled,
  purchasePointsRate:   parseFloat(r.purchase_points_rate),
  referralRewardPoints: r.referral_reward_points,
  paymentQrCodePath:    r.payment_qr_code_path
});

// GET /api/admin/settings
router.get('/admin/settings', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM settings WHERE id = 1');
    res.json(mapSettings(rows[0]));
  } catch (err) { next(err); }
});

// PUT /api/admin/settings
router.put('/admin/settings', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const current = await query('SELECT * FROM settings WHERE id = 1');
    const cur = current.rows[0];
    const { pointsSystemEnabled, purchasePointsRate, referralRewardPoints } = req.body;

    const { rows } = await query(`
      UPDATE settings SET
        points_system_enabled  = $1,
        purchase_points_rate   = $2,
        referral_reward_points = $3
      WHERE id = 1 RETURNING *
    `, [
      pointsSystemEnabled !== undefined ? !!pointsSystemEnabled    : cur.points_system_enabled,
      purchasePointsRate  !== undefined ? parseFloat(purchasePointsRate) : cur.purchase_points_rate,
      referralRewardPoints !== undefined ? parseInt(referralRewardPoints, 10) : cur.referral_reward_points
    ]);
    res.json({ success: true, settings: mapSettings(rows[0]) });
  } catch (err) { next(err); }
});

// POST /api/admin/settings/qr — upload payment QR image
router.post('/admin/settings/qr', requireLogin, requireAdmin,
  (req, res, next) => {
    uploadQR.single('qr')(req, res, err => {
      if (err) return handleUploadError(err, req, res, next);
      next();
    });
  },
  async (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const qrPath = await uploadToSupabase(req.file, 'products');
    try {
      await query('UPDATE settings SET payment_qr_code_path = $1 WHERE id = 1', [qrPath]);
      res.json({ success: true, path: qrPath });
    } catch (err) { next(err); }
  }
);

// GET /api/payment-qr — public: checkout page uses this to show payment instructions
router.get('/payment-qr', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT payment_qr_code_path FROM settings WHERE id = 1');
    res.json({ path: rows[0]?.payment_qr_code_path || '' });
  } catch (err) { next(err); }
});

module.exports = router;
