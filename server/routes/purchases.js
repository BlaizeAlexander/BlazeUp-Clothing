// ============================================================
// routes/purchases.js — Supplier purchase management
// ============================================================

const express = require('express');
const { requireLogin, requireAdmin }       = require('../middleware/auth');
const { receivePurchase, postSupplierPayment } = require('../services/purchaseService');
const { query }                             = require('../db');

const router = express.Router();

function mapPurchase(row, items = []) {
  return {
    id:            row.id,
    supplierName:  row.supplier_name,
    supplierRef:   row.supplier_ref,
    date:          row.date,
    subtotal:      parseFloat(row.subtotal),
    total:         parseFloat(row.total),
    amountPaid:    parseFloat(row.amount_paid),
    balanceDue:    parseFloat(row.balance_due),
    paymentStatus: row.payment_status,
    status:        row.status,
    notes:         row.notes,
    isVoided:      row.is_voided,
    createdAt:     row.created_at,
    items
  };
}

// ── GET /api/admin/purchases ──────────────────────────────────
router.get('/admin/purchases', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { rows: purchases } = await query(
      'SELECT * FROM purchases WHERE is_voided = false ORDER BY created_at DESC'
    );
    if (!purchases.length) return res.json([]);

    const ids = purchases.map(p => p.id);
    const { rows: items } = await query(
      'SELECT * FROM purchase_items WHERE purchase_id = ANY($1::uuid[])', [ids]
    );
    const byPurchase = {};
    items.forEach(it => {
      (byPurchase[it.purchase_id] = byPurchase[it.purchase_id] || []).push(it);
    });

    res.json(purchases.map(p => mapPurchase(p, byPurchase[p.id] || [])));
  } catch (err) { next(err); }
});

// ── GET /api/admin/purchases/:id ─────────────────────────────
router.get('/admin/purchases/:id', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM purchases WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Purchase not found.' });
    const { rows: items } = await query(
      'SELECT * FROM purchase_items WHERE purchase_id = $1', [req.params.id]
    );
    res.json(mapPurchase(rows[0], items));
  } catch (err) { next(err); }
});

// ── POST /api/admin/purchases ─────────────────────────────────
router.post('/admin/purchases', requireLogin, requireAdmin, async (req, res, next) => {
  const { supplierName, supplierRef, date, items, amountPaid, method, notes } = req.body;
  if (!supplierName) return res.status(400).json({ error: 'Supplier name is required.' });
  if (!items || !items.length) return res.status(400).json({ error: 'At least one item is required.' });

  try {
    const result = await receivePurchase(
      { supplierName, supplierRef, date, items, amountPaid, method, notes },
      req.user.id
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET /api/admin/purchases/:id/payments ────────────────────
router.get('/admin/purchases/:id/payments', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM supplier_payments WHERE purchase_id = $1 AND is_voided = false ORDER BY date ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/admin/purchases/:id/payments ───────────────────
router.post('/admin/purchases/:id/payments', requireLogin, requireAdmin, async (req, res, next) => {
  const { date, amount, method, referenceNumber, notes } = req.body;
  if (!amount) return res.status(400).json({ error: 'Amount is required.' });

  try {
    const result = await postSupplierPayment(
      { purchaseId: req.params.id, date, amount, method, referenceNumber, notes },
      req.user.id
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET /api/admin/supplier-payments ─────────────────────────
router.get('/admin/supplier-payments', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT sp.*, p.supplier_name
      FROM supplier_payments sp
      JOIN purchases p ON p.id = sp.purchase_id
      WHERE sp.is_voided = false
      ORDER BY sp.date DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
