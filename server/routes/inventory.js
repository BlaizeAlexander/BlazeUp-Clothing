// ============================================================
// routes/inventory.js — Product variants + movement log
// ============================================================

const express = require('express');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const { adjustStock, getInventoryValuation, getMovements } = require('../services/inventoryService');
const { query, getClient } = require('../db');

const router = express.Router();

// ── GET /api/admin/variants — all variants with product info ─
router.get('/admin/variants', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        pv.*,
        p.name AS product_name,
        p.category,
        (pv.stock_qty * pv.weighted_avg_cost) AS inventory_value
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.is_active = true
      ORDER BY p.name, pv.size, pv.color
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/admin/variants — create a variant ──────────────
router.post('/admin/variants', requireLogin, requireAdmin, async (req, res, next) => {
  const { productId, sku, size, color, sellingPrice, costPrice, stockQty, reorderLevel } = req.body;
  if (!productId || !sellingPrice) {
    return res.status(400).json({ error: 'productId and sellingPrice are required.' });
  }
  try {
    const { rows } = await query(`
      INSERT INTO product_variants
        (product_id, sku, size, color, selling_price, cost_price,
         weighted_avg_cost, stock_qty, reorder_level)
      VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8)
      RETURNING *
    `, [
      productId,
      sku || '',
      size  || '',
      color || '',
      parseFloat(sellingPrice),
      parseFloat(costPrice  || 0),
      parseInt(stockQty    || 0, 10),
      parseInt(reorderLevel || 5,  10)
    ]);
    res.json({ success: true, variant: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Variant (product/size/color) already exists.' });
    next(err);
  }
});

// ── PUT /api/admin/variants/:id ──────────────────────────────
router.put('/admin/variants/:id', requireLogin, requireAdmin, async (req, res, next) => {
  const { sku, size, color, sellingPrice, costPrice, reorderLevel, isActive } = req.body;
  try {
    const { rows } = await query(`
      UPDATE product_variants SET
        sku           = COALESCE($1, sku),
        size          = COALESCE($2, size),
        color         = COALESCE($3, color),
        selling_price = COALESCE($4, selling_price),
        cost_price    = COALESCE($5, cost_price),
        reorder_level = COALESCE($6, reorder_level),
        is_active     = COALESCE($7, is_active)
      WHERE id = $8 RETURNING *
    `, [
      sku          || null,
      size         !== undefined ? size         : null,
      color        !== undefined ? color        : null,
      sellingPrice ? parseFloat(sellingPrice)   : null,
      costPrice    ? parseFloat(costPrice)      : null,
      reorderLevel ? parseInt(reorderLevel, 10) : null,
      isActive     !== undefined ? !!isActive   : null,
      req.params.id
    ]);
    if (!rows.length) return res.status(404).json({ error: 'Variant not found.' });
    res.json({ success: true, variant: rows[0] });
  } catch (err) { next(err); }
});

// ── POST /api/admin/variants/:id/adjust — manual adjustment ──
router.post('/admin/variants/:id/adjust', requireLogin, requireAdmin, async (req, res, next) => {
  const { type, qtyChange, unitCost, notes } = req.body;
  const validTypes = ['adjustment', 'damage', 'return_in', 'return_out'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }
  if (!qtyChange || isNaN(Number(qtyChange))) {
    return res.status(400).json({ error: 'qtyChange is required.' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await adjustStock({
      variantId: req.params.id,
      type,
      qtyChange: parseInt(qtyChange, 10),
      unitCost:  parseFloat(unitCost || 0),
      refType:   'manual',
      notes:     notes || '',
      createdBy: req.user.id
    }, client);
    await client.query('COMMIT');
    res.json({ success: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    next(err);
  } finally {
    client.release();
  }
});

// ── GET /api/admin/inventory/valuation ───────────────────────
router.get('/admin/inventory/valuation', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const result = await getInventoryValuation();
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/admin/inventory/low-stock ───────────────────────
router.get('/admin/inventory/low-stock', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT pv.*, p.name AS product_name
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.stock_qty <= pv.reorder_level AND pv.is_active = true
      ORDER BY pv.stock_qty ASC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/admin/inventory/movements ───────────────────────
router.get('/admin/inventory/movements', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { variantId, limit } = req.query;
    const rows = await getMovements({ variantId, limit: parseInt(limit || 100, 10) });
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
