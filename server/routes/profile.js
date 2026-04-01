// ============================================================
// routes/profile.js — User profile, admin customer/points mgmt
// ============================================================

const express = require('express');
const { query } = require('../db');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const { uploadAvatar, handleUploadError, uploadToSupabase } = require('../middleware/upload');

const router = express.Router();

// PUT /api/profile — logged-in user updates their own profile
router.put('/profile', requireLogin, async (req, res, next) => {
  const { username, contact, pinnedLocation } = req.body;
  try {
    if (username !== undefined) {
      const trimmed = (username || '').trim();
      if (!trimmed) return res.status(400).json({ error: 'Username cannot be empty.' });

      const taken = await query(
        'SELECT id FROM users WHERE lower(username) = lower($1) AND id != $2',
        [trimmed, req.user.id]
      );
      if (taken.rows.length) return res.status(400).json({ error: 'Username already taken.' });

      // Reflect new username on existing orders so admin sees it
      await query('UPDATE orders SET customer_name = $1 WHERE user_id = $2', [trimmed, req.user.id]);
    }

    const { rows } = await query(`
      UPDATE users SET
        username        = COALESCE($1, username),
        contact         = COALESCE($2, contact),
        pinned_location = COALESCE($3, pinned_location)
      WHERE id = $4
      RETURNING id, username, contact, pinned_location
    `, [
      username      !== undefined ? (username || '').trim() : null,
      contact       !== undefined ? contact                 : null,
      pinnedLocation !== undefined ? pinnedLocation         : null,
      req.user.id
    ]);

    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, username: rows[0].username });
  } catch (err) { next(err); }
});

// POST /api/profile/avatar — upload or replace profile picture
router.post('/profile/avatar', requireLogin,
  (req, res, next) => {
    uploadAvatar.single('avatar')(req, res, err => {
      if (err) return handleUploadError(err, req, res, next);
      next();
    });
  },
  async (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
    try {
      const avatarUrl = await uploadToSupabase(req.file, 'products');
      await query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, req.user.id]);
      res.json({ success: true, avatarUrl });
    } catch (err) { next(err); }
  }
);

// DELETE /api/admin/customers/:id — admin removes a customer account
router.delete('/admin/customers/:id', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    // Prevent deleting admin accounts
    const { rows } = await query('SELECT role FROM users WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    if (rows[0].role === 'admin') return res.status(403).json({ error: 'Cannot delete admin accounts.' });

    await query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PUT /api/admin/users/:id/points — add or subtract points
router.put('/admin/users/:id/points', requireLogin, requireAdmin, async (req, res, next) => {
  const { points } = req.body;
  if (points === undefined || isNaN(Number(points)))
    return res.status(400).json({ error: 'A numeric points value is required.' });
  try {
    const { rows } = await query(
      'UPDATE users SET points = GREATEST(0, points + $1) WHERE id = $2 RETURNING points',
      [parseInt(points, 10), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, points: rows[0].points });
  } catch (err) { next(err); }
});

// PUT /api/admin/users/:id/points/set — set points to exact value
router.put('/admin/users/:id/points/set', requireLogin, requireAdmin, async (req, res, next) => {
  const { points } = req.body;
  if (points === undefined || isNaN(Number(points)))
    return res.status(400).json({ error: 'A numeric points value is required.' });
  try {
    const { rows } = await query(
      'UPDATE users SET points = GREATEST(0, $1) WHERE id = $2 RETURNING points',
      [parseInt(points, 10), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, points: rows[0].points });
  } catch (err) { next(err); }
});

module.exports = router;
