// ============================================================
// routes/orders.js — Order placement and admin management
//
// Storefront POST /api/orders is preserved for backward compat.
// Admin confirmation now routes through orderService so revenue,
// COGS, inventory, and receivables are all posted atomically.
// ============================================================

const express = require('express');
const { query, getClient }                  = require('../db');
const { requireLogin, requireAdmin, optionalLogin } = require('../middleware/auth');
const { uploadPayment, handleUploadError, uploadToSupabase } = require('../middleware/upload');
const { confirmOrder, voidOrder }           = require('../services/orderService');

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
    variantId:    row.variant_id,
    costAtSale:   parseFloat(row.cost_at_sale),
    lineTotal:    parseFloat(row.line_total || row.price * row.quantity),
    lineCogs:     parseFloat(row.line_cogs  || 0)
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
    subtotal:          parseFloat(row.subtotal  || 0),
    discountAmount:    parseFloat(row.discount_amount || 0),
    shippingFee:       parseFloat(row.shipping_fee    || 0),
    total:             parseFloat(row.total),
    amountPaid:        parseFloat(row.amount_paid     || 0),
    balanceDue:        parseFloat(row.balance_due     || row.total),
    paymentStatus:     row.payment_status  || 'unpaid',
    status:            row.status,
    pointsUsed:        row.points_used,
    paymentScreenshot: row.payment_screenshot,
    isVoided:          row.is_voided,
    postedAt:          row.posted_at,
    createdAt:         row.created_at
  };
}

async function withItems(orderRows) {
  if (!orderRows.length) return [];
  const ids = orderRows.map(o => o.id);
  const { rows: itemRows } = await query(
    'SELECT * FROM order_items WHERE order_id = ANY($1::uuid[])', [ids]
  );
  const byOrder = {};
  itemRows.forEach(r => {
    (byOrder[r.order_id] = byOrder[r.order_id] || []).push(mapItem(r));
  });
  return orderRows.map(o => mapOrder(o, byOrder[o.id] || []));
}

// ── POST /api/orders — storefront order placement ─────────────
// Guests and logged-in users can both place orders.
// Screenshot is stored as a pending payment proof;
// admin verifies via paymentService after confirming.
router.post('/orders', optionalLogin,
  (req, res, next) => {
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

      if (pts > 0 && userId) {
        const { rows } = await client.query(
          'SELECT points FROM users WHERE id = $1 FOR UPDATE', [userId]
        );
        if (!rows.length || rows[0].points < pts) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Not enough points.' });
        }
        await client.query('UPDATE users SET points = points - $1 WHERE id = $2', [pts, userId]);
      }

      // Compute subtotal from items for accurate record-keeping
      const subtotal = parsedItems.reduce(
        (s, it) => s + parseFloat(it.price) * (parseInt(it.qty, 10) || 1), 0
      );

      // Fetch shipping fee
      const { rows: sRows } = await client.query('SELECT shipping_fee FROM settings WHERE id = 1');
      const shippingFee = parseFloat(sRows[0]?.shipping_fee ?? 0);

      const orderTotal = parseFloat(total) || subtotal + shippingFee;

      const orderRes = await client.query(`
        INSERT INTO orders
          (user_id, customer_name, contact, address, subtotal, shipping_fee,
           total, points_used, payment_screenshot, status, payment_status, balance_due)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending','unpaid',$7)
        RETURNING *
      `, [userId, customerName, contact, address, subtotal, shippingFee,
          orderTotal, pts, paymentScreenshot]);
      const order = orderRes.rows[0];

      // Check stock
      for (const item of parsedItems) {
        if (!item.productId) continue;
        const { rows: stockRows } = await client.query(
          'SELECT name, stock_quantity FROM products WHERE id = $1 FOR UPDATE', [item.productId]
        );
        if (stockRows.length && stockRows[0].stock_quantity === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `"${stockRows[0].name}" is out of stock.` });
        }
      }

      // Insert order items
      for (const item of parsedItems) {
        const productRes = await client.query(
          'SELECT id, cost_price FROM products WHERE id = $1', [item.productId || null]
        );
        const costAtSale = productRes.rows[0] ? parseFloat(productRes.rows[0].cost_price) : 0;
        const qty        = parseInt(item.qty, 10) || 1;
        const unitPrice  = parseFloat(item.price);
        const lineTotal  = qty * unitPrice;

        await client.query(`
          INSERT INTO order_items
            (order_id, product_id, name, price, base_price, cost_at_sale,
             quantity, image, line_total, line_cogs)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `, [
          order.id,
          item.productId || null,
          item.name,
          unitPrice,
          parseFloat(item.basePrice || item.price),
          costAtSale,
          qty,
          item.image || '',
          lineTotal,
          costAtSale * qty
        ]);
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
      'SELECT * FROM orders WHERE user_id = $1 AND is_voided = false ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(await withItems(rows));
  } catch (err) { next(err); }
});

// ── GET /api/admin/orders ─────────────────────────────────────
router.get('/admin/orders', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { status, paymentStatus } = req.query;
    const conditions = ['o.is_voided = false'];
    const params = [];
    if (status)        { params.push(status);        conditions.push(`o.status = $${params.length}`); }
    if (paymentStatus) { params.push(paymentStatus); conditions.push(`o.payment_status = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT o.* FROM orders o ${where} ORDER BY o.created_at DESC`, params
    );
    res.json(await withItems(rows));
  } catch (err) { next(err); }
});

// ── GET /api/admin/orders/:id ─────────────────────────────────
router.get('/admin/orders/:id', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Order not found.' });
    const items = (await query('SELECT * FROM order_items WHERE order_id = $1', [req.params.id])).rows;
    res.json(mapOrder(rows[0], items.map(mapItem)));
  } catch (err) { next(err); }
});

// ── PUT /api/admin/orders/:id/status ─────────────────────────
// Routes through orderService for confirmed — posts journal entries.
const VALID_STATUSES = new Set(['pending','confirmed','shipped','delivered','cancelled']);

router.put('/admin/orders/:id/status', requireLogin, requireAdmin, async (req, res, next) => {
  const { status } = req.body;
  if (!VALID_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status.' });

  try {
    if (status === 'confirmed') {
      // Full accounting posting via service
      const result = await confirmOrder(req.params.id, req.user.id);
      return res.json(result);
    }

    // Non-confirming status changes (shipped, delivered, cancelled) — direct update
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [req.params.id]
      );
      if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Order not found.' }); }
      const order = rows[0];
      if (order.is_voided) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Order is voided.' }); }

      await client.query('UPDATE orders SET status = $1 WHERE id = $2', [status, order.id]);

      // Cancelled after confirmation: restore stock via voidOrder
      if (status === 'cancelled' && order.posted_at) {
        await client.query('ROLLBACK');
        client.release();
        const result = await voidOrder(order.id, { reason: 'Cancelled by admin', adminId: req.user.id });
        return res.json(result);
      }

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.message.includes('already confirmed') || err.message.includes('voided') ||
        err.message.includes('not found') || err.message.includes('cancelled')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// ── DELETE /api/admin/orders/:id — void (not hard delete) ────
router.delete('/admin/orders/:id', requireLogin, requireAdmin, async (req, res, next) => {
  const { reason } = req.body;
  try {
    const { rows } = await query('SELECT posted_at, is_voided FROM orders WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Order not found.' });
    if (rows[0].is_voided) return res.status(400).json({ error: 'Order already voided.' });

    if (rows[0].posted_at) {
      // Posted orders must be voided (with journal reversal)
      if (!reason) return res.status(400).json({ error: 'A void reason is required for posted orders.' });
      const result = await voidOrder(req.params.id, { reason, adminId: req.user.id });
      return res.json(result);
    }

    // Pending (unposted) orders can be hard-deleted
    await query('DELETE FROM order_items WHERE order_id = $1', [req.params.id]);
    await query('DELETE FROM orders WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /api/admin/customers ──────────────────────────────────
router.get('/admin/customers', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const [usersRes, ordersRes] = await Promise.all([
      query('SELECT * FROM users ORDER BY created_at DESC'),
      query('SELECT id, user_id, total, status FROM orders WHERE is_voided = false')
    ]);
    const byUser = {};
    ordersRes.rows.forEach(o => {
      if (o.user_id) (byUser[o.user_id] = byUser[o.user_id] || []).push(o);
    });
    res.json(usersRes.rows.map(u => ({
      id:             u.id,
      username:       u.username,
      email:          u.email,
      contact:        u.contact,
      pinnedLocation: u.pinned_location,
      points:         u.points,
      isAdmin:        u.role === 'admin',
      referralCode:   u.referral_code,
      referralCount:  u.referral_count,
      referredBy:     u.referred_by,
      avatarUrl:      u.avatar_url || '',
      status:         u.status,
      createdAt:      u.created_at,
      orders:         byUser[u.id] || []
    })));
  } catch (err) { next(err); }
});

module.exports = router;
