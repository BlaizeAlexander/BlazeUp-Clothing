// ============================================================
// routes/discounts.js — Discount code CRUD
// ============================================================

const express = require('express');
const { query } = require('../db');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const mapDiscount = r => ({
  id:        r.id,
  name:      r.name,
  type:      r.type,
  value:     parseFloat(r.value),
  createdAt: r.created_at
});

router.get('/discounts', requireLogin, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM discounts ORDER BY created_at DESC');
    res.json(rows.map(mapDiscount));
  } catch (err) { next(err); }
});

router.post('/admin/discounts', requireLogin, requireAdmin, async (req, res, next) => {
  const { name, type, value } = req.body;
  if (!name || !type || value === undefined)
    return res.status(400).json({ error: 'Name, type, and value are required.' });
  if (!['percent', 'fixed'].includes(type))
    return res.status(400).json({ error: 'Type must be "percent" or "fixed".' });
  try {
    const { rows } = await query(
      'INSERT INTO discounts (name, type, value) VALUES ($1,$2,$3) RETURNING *',
      [name.toUpperCase(), type, parseFloat(value)]
    );
    res.json({ success: true, discount: mapDiscount(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Discount name already exists.' });
    next(err);
  }
});

router.put('/admin/discounts/:id', requireLogin, requireAdmin, async (req, res, next) => {
  const { name, type, value } = req.body;
  try {
    const { rows } = await query(`
      UPDATE discounts SET
        name  = COALESCE($1, name),
        type  = COALESCE($2, type),
        value = COALESCE($3, value)
      WHERE id = $4 RETURNING *
    `, [name ? name.toUpperCase() : null, type || null, value !== undefined ? parseFloat(value) : null, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Discount not found.' });
    res.json({ success: true, discount: mapDiscount(rows[0]) });
  } catch (err) { next(err); }
});

router.delete('/admin/discounts/:id', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const result = await query('DELETE FROM discounts WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Discount not found.' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
