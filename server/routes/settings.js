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
  paymentQrCodePath:    r.payment_qr_code_path,
  shippingFee:          parseFloat(r.shipping_fee),
  facebookUrl:          r.facebook_url  || '',
  instagramUrl:         r.instagram_url || '',
  telegramUrl:          r.telegram_url  || ''
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
    const { pointsSystemEnabled, purchasePointsRate, referralRewardPoints, shippingFee,
            facebookUrl, instagramUrl, telegramUrl } = req.body;

    const { rows } = await query(`
      UPDATE settings SET
        points_system_enabled  = $1,
        purchase_points_rate   = $2,
        referral_reward_points = $3,
        shipping_fee           = $4,
        facebook_url           = $5,
        instagram_url          = $6,
        telegram_url           = $7
      WHERE id = 1 RETURNING *
    `, [
      pointsSystemEnabled  !== undefined ? !!pointsSystemEnabled             : cur.points_system_enabled,
      purchasePointsRate   !== undefined ? parseFloat(purchasePointsRate)    : cur.purchase_points_rate,
      referralRewardPoints !== undefined ? parseInt(referralRewardPoints, 10): cur.referral_reward_points,
      shippingFee          !== undefined ? parseFloat(shippingFee)           : cur.shipping_fee,
      facebookUrl          !== undefined ? (facebookUrl  || '')              : (cur.facebook_url  || ''),
      instagramUrl         !== undefined ? (instagramUrl || '')              : (cur.instagram_url || ''),
      telegramUrl          !== undefined ? (telegramUrl  || '')              : (cur.telegram_url  || '')
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

// GET /api/social-links — public: footer uses this to show social icons
router.get('/social-links', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT facebook_url, instagram_url, telegram_url FROM settings WHERE id = 1');
    const r = rows[0] || {};
    res.json({ facebookUrl: r.facebook_url || '', instagramUrl: r.instagram_url || '', telegramUrl: r.telegram_url || '' });
  } catch (err) { next(err); }
});

// GET /api/quantity-discounts — public: storefront reads tiers to auto-apply cart discount
router.get('/quantity-discounts', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM quantity_discounts ORDER BY min_qty ASC');
    res.json(rows.map(r => ({ id: r.id, minQty: r.min_qty, discountPercent: parseFloat(r.discount_percent) })));
  } catch (err) { next(err); }
});

// POST /api/admin/quantity-discounts — add a tier
router.post('/admin/quantity-discounts', requireLogin, requireAdmin, async (req, res, next) => {
  const { minQty, discountPercent } = req.body;
  if (!minQty || !discountPercent)
    return res.status(400).json({ error: 'minQty and discountPercent are required.' });
  try {
    const { rows } = await query(
      'INSERT INTO quantity_discounts (min_qty, discount_percent) VALUES ($1,$2) RETURNING *',
      [parseInt(minQty, 10), parseFloat(discountPercent)]
    );
    res.json({ success: true, tier: { id: rows[0].id, minQty: rows[0].min_qty, discountPercent: parseFloat(rows[0].discount_percent) } });
  } catch (err) { next(err); }
});

// DELETE /api/admin/quantity-discounts/:id — remove a tier
router.delete('/admin/quantity-discounts/:id', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM quantity_discounts WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Tier not found.' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/shipping-fee — public: storefront uses this to display and apply shipping cost
router.get('/shipping-fee', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT shipping_fee FROM settings WHERE id = 1');
    res.json({ shippingFee: parseFloat(rows[0]?.shipping_fee ?? 0) });
  } catch (err) { next(err); }
});

module.exports = router;
