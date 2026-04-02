// ============================================================
// routes/orders.js — Place orders, admin order management
// ============================================================

const express = require('express');
const { query, getClient } = require('../db');
const { requireLogin, requireAdmin, optionalLogin } = require('../middleware/auth');
const { uploadPayment, handleUploadError, uploadToSupabase } = require('../middleware/upload');

const router = express.Router();

// ── Mappers ───────────────────────────────────────────────────

function mapItem(row) {
  return {
    name:         row.name,
    price:        parseFloat(row.price),
    basePrice:    parseFloat(row.base_price),
    qty:          row.quantity,
    image:        row.image,
    productId:    row.product_id,
    costAtSale:   parseFloat(row.cost_at_sale),
    sellingPrice: parseFloat(row.price)
  };
}

function mapOrder(row, items = []) {
  return {
    id:                row.id,
    userId:            row.user_id,
    customerName:      row.customer_name,
    contact:           row.contact,
    address:           row.address,
    items,
    total:             parseFloat(row.total),
    pointsUsed:        row.points_used,
    paymentScreenshot: row.payment_screenshot,
    status:            row.status,
    createdAt:         row.created_at
  };
}

/**
 * Fetch a batch of orders with their items in 2 queries (not N+1).
 */
async function withItems(orderRows) {
  if (!orderRows.length) return [];
  const ids = orderRows.map(o => o.id);
  const { rows: itemRows } = await query(
    'SELECT * FROM order_items WHERE order_id = ANY($1::uuid[])',
    [ids]
  );
  const byOrder = {};
  itemRows.forEach(r => {
    (byOrder[r.order_id] = byOrder[r.order_id] || []).push(mapItem(r));
  });
  return orderRows.map(o => mapOrder(o, byOrder[o.id] || []));
}

// ── POST /api/orders ──────────────────────────────────────────
// Guests and logged-in users can both place orders.
router.post('/orders', optionalLogin,
  (req, res, next) => {
    // Original frontend sends file under the field name 'screenshot'
    uploadPayment.single('screenshot')(req, res, err => {
      if (err) return handleUploadError(err, req, res, next);
      next();
    });
  },
  async (req, res, next) => {
    const { customerName, contact, address, items, total, pointsUsed } = req.body;
    if (!customerName || !contact || !address || !items) {
      return res.status(400).json({ error: 'All order fields are required.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Payment screenshot is required.' });
    }

    let parsedItems;
    try { parsedItems = JSON.parse(items); }
    catch { return res.status(400).json({ error: 'Invalid items format.' }); }

    const userId = req.user ? req.user.id : null;
    const pts    = parseInt(pointsUsed, 10) || 0;
    const paymentScreenshot = await uploadToSupabase(req.file, 'payments');

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Deduct loyalty points atomically (FOR UPDATE prevents double-spend)
      if (pts > 0 && userId) {
        const { rows } = await client.query(
          'SELECT points FROM users WHERE id = $1 FOR UPDATE',
          [userId]
        );
        if (!rows.length || rows[0].points < pts) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Not enough points.' });
        }
        await client.query('UPDATE users SET points = points - $1 WHERE id = $2', [pts, userId]);
      }

      // Insert the order
      const orderRes = await client.query(`
        INSERT INTO orders
          (user_id, customer_name, contact, address, total, points_used, payment_screenshot, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
        RETURNING *
      `, [userId, customerName, contact, address, parseFloat(total), pts, paymentScreenshot]);
      const order = orderRes.rows[0];

      // Check stock before inserting anything
      for (const item of parsedItems) {
        if (!item.productId) continue;
        const { rows: stockRows } = await client.query(
          'SELECT name, stock_quantity FROM products WHERE id = $1 FOR UPDATE',
          [item.productId]
        );
        if (stockRows.length && stockRows[0].stock_quantity === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `"${stockRows[0].name}" is out of stock.` });
        }
      }

      // Insert order items — snapshot cost at this moment
      const insertedItems = [];
      for (const item of parsedItems) {
        const productRes = await client.query(
          'SELECT id, cost_price FROM products WHERE id = $1',
          [item.productId || null]
        );
        const costAtSale = productRes.rows[0] ? parseFloat(productRes.rows[0].cost_price) : 0;

        const itemRes = await client.query(`
          INSERT INTO order_items
            (order_id, product_id, name, price, base_price, cost_at_sale, quantity, image)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          RETURNING *
        `, [
          order.id,
          item.productId || null,
          item.name,
          parseFloat(item.price),
          parseFloat(item.basePrice || item.price),
          costAtSale,
          parseInt(item.qty, 10) || 1,
          item.image || ''
        ]);
        insertedItems.push(mapItem(itemRes.rows[0]));
      }

      await client.query('COMMIT');
      res.json({ success: true, orderId: order.id });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

// ── GET /api/orders/my ────────────────────────────────────────
router.get('/orders/my', requireLogin, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(await withItems(rows));
  } catch (err) { next(err); }
});

// ── GET /api/admin/orders ─────────────────────────────────────
router.get('/admin/orders', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(await withItems(rows));
  } catch (err) { next(err); }
});

// ── DELETE /api/admin/orders/:id ─────────────────────────────
router.delete('/admin/orders/:id', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    await query('DELETE FROM order_items WHERE order_id = $1', [req.params.id]);
    const { rowCount } = await query('DELETE FROM orders WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Order not found.' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /api/admin/customers ──────────────────────────────────
router.get('/admin/customers', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const [usersRes, ordersRes] = await Promise.all([
      query('SELECT * FROM users ORDER BY created_at DESC'),
      query('SELECT * FROM orders')
    ]);

    const byUser = {};
    ordersRes.rows.forEach(o => {
      if (o.user_id) (byUser[o.user_id] = byUser[o.user_id] || []).push(mapOrder(o));
    });

    res.json(usersRes.rows.map(u => ({
      id:            u.id,
      username:      u.username,
      email:         u.email,
      contact:       u.contact,
      pinnedLocation: u.pinned_location,
      points:        u.points,
      isAdmin:       u.role === 'admin',
      referralCode:  u.referral_code,
      referralCount: u.referral_count,
      referredBy:    u.referred_by,
      avatarUrl:     u.avatar_url || '',
      createdAt:     u.created_at,
      orders:        byUser[u.id] || []
    })));
  } catch (err) { next(err); }
});

// ── PUT /api/admin/orders/:id/status ─────────────────────────
const VALID_STATUSES = new Set(['pending','confirmed','shipped','delivered','cancelled']);
const PAID_STATUSES  = new Set(['confirmed','shipped','delivered']);

router.put('/admin/orders/:id/status', requireLogin, requireAdmin, async (req, res, next) => {
  const { status } = req.body;
  if (!VALID_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status.' });

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock the order row to prevent concurrent status races
    const { rows } = await client.query(
      'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found.' });
    }
    const order      = rows[0];
    const prevStatus = order.status;

    await client.query('UPDATE orders SET status = $1 WHERE id = $2', [status, order.id]);

    // ── Confirm: first time only ──────────────────────────────
    if (status === 'confirmed' && !PAID_STATUSES.has(prevStatus)) {

      // 1. Decrement stock
      const itemsRes = await client.query(
        'SELECT product_id, quantity FROM order_items WHERE order_id = $1 AND product_id IS NOT NULL',
        [order.id]
      );
      for (const item of itemsRes.rows) {
        await client.query(
          'UPDATE products SET stock_quantity = GREATEST(0, stock_quantity - $1) WHERE id = $2',
          [item.quantity, item.product_id]
        );
      }

      // 2. Award purchase points to buyer
      if (order.user_id) {
        const settingsRes = await client.query('SELECT * FROM settings WHERE id = 1');
        const s = settingsRes.rows[0];
        if (s.points_system_enabled) {
          const rate   = parseFloat(s.purchase_points_rate);
          const earned = Math.floor(parseFloat(order.total) / 100 * rate);
          if (earned > 0) {
            await client.query('UPDATE users SET points = points + $1 WHERE id = $2', [earned, order.user_id]);
          }
        }
      }

      // 3. Auto-create receivable (skip if one already exists for this order)
      const existingRec = await client.query(
        'SELECT id FROM receivables WHERE related_order_id = $1',
        [order.id]
      );
      if (!existingRec.rows.length) {
        await client.query(`
          INSERT INTO receivables (related_order_id, customer_id, customer_name, amount, status, notes)
          VALUES ($1,$2,$3,$4,'paid','Auto-created on order confirmation')
        `, [order.id, order.user_id, order.customer_name, order.total]);
      }
    }

    // ── Cancel: restore stock if previously confirmed ─────────
    if (status === 'cancelled' && PAID_STATUSES.has(prevStatus)) {
      const itemsRes = await client.query(
        'SELECT product_id, quantity FROM order_items WHERE order_id = $1 AND product_id IS NOT NULL',
        [order.id]
      );
      for (const item of itemsRes.rows) {
        await client.query(
          'UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2',
          [item.quantity, item.product_id]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
