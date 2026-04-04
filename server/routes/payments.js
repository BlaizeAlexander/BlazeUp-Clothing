// ============================================================
// routes/payments.js — Customer payment endpoints
// ============================================================

const express = require('express');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const { postPayment, voidPayment }   = require('../services/paymentService');
const { query }                       = require('../db');
const { uploadPayment, handleUploadError, uploadToSupabase } = require('../middleware/upload');

const router = express.Router();

// ── GET /api/admin/orders/:id/payments ───────────────────────
router.get('/admin/orders/:id/payments', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT p.*, u.username AS posted_by_name
      FROM payments p
      LEFT JOIN users u ON u.id = p.posted_by
      WHERE p.order_id = $1
      ORDER BY p.created_at ASC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/admin/orders/:id/payments ──────────────────────
// Admin records a verified payment for an order.
// Supports optional screenshot upload.
router.post('/admin/orders/:id/payments', requireLogin, requireAdmin,
  (req, res, next) => {
    uploadPayment.single('screenshot')(req, res, err => {
      if (err) return handleUploadError(err, req, res, next);
      next();
    });
  },
  async (req, res, next) => {
    try {
      const { date, amount, method, referenceNumber, notes } = req.body;
      if (!amount) return res.status(400).json({ error: 'Amount is required.' });

      let screenshotUrl = '';
      if (req.file) {
        screenshotUrl = await uploadToSupabase(req.file, 'payments');
      }

      const result = await postPayment({
        orderId: req.params.id,
        date, amount, method, referenceNumber, screenshotUrl, notes
      }, req.user.id);

      res.json(result);
    } catch (err) {
      if (err.message.includes('exceeds') || err.message.includes('not found') ||
          err.message.includes('Confirm') || err.message.includes('voided')) {
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  }
);

// ── DELETE /api/admin/payments/:id — void a payment ──────────
router.delete('/admin/payments/:id', requireLogin, requireAdmin, async (req, res, next) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'A void reason is required.' });
  try {
    const result = await voidPayment(req.params.id, { reason, adminId: req.user.id });
    res.json(result);
  } catch (err) {
    if (err.message.includes('not found') || err.message.includes('voided')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
