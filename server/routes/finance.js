// ============================================================
// routes/finance.js — Expenses, Receivables, Payables CRUD
//
// The heavy reporting logic moved to routes/reports.js.
// The old /api/admin/finance/overview is kept for backward
// compatibility with the existing admin.js frontend.
// ============================================================

const express = require('express');
const { query } = require('../db');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const { postExpense, voidExpense }   = require('../services/expenseService');

const router = express.Router();

// ── LEGACY overview — direct SQL (works with pre-migration data) ─
// Reads directly from orders/expenses/products so existing confirmed
// orders show up even if they have no journal entries yet.
// New code should use GET /api/admin/reports/dashboard instead.
router.get('/admin/finance/overview', requireLogin, requireAdmin, async (req, res, next) => {
  const PAID = ['confirmed', 'shipped', 'delivered'];

  function periodBounds(period) {
    const now = new Date();
    if (period === 'thisMonth') return [
      new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()
    ];
    if (period === 'thisYear') return [
      new Date(now.getFullYear(), 0, 1).toISOString(),
      new Date(now.getFullYear() + 1, 0, 1).toISOString()
    ];
    return ['1970-01-01T00:00:00Z', '2999-12-31T23:59:59Z'];
  }

  try {
    const period = req.query.period || 'allTime';
    const [start, end] = periodBounds(period);

    const [revRes, pendRes, cogsRes, expRes, invRes, recRes, payRes, cntRes] = await Promise.all([
      query(`SELECT COALESCE(SUM(o.total),0) AS total, COUNT(*) AS cnt
             FROM orders o
             WHERE o.status = ANY($1) AND o.is_voided = false
               AND o.created_at >= $2 AND o.created_at < $3`,
        [PAID, start, end]),

      query(`SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS cnt
             FROM orders
             WHERE status = 'pending' AND is_voided = false
               AND created_at >= $1 AND created_at < $2`,
        [start, end]),

      query(`SELECT oi.cost_at_sale, oi.quantity
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE o.status = ANY($1) AND o.is_voided = false
               AND o.created_at >= $2 AND o.created_at < $3`,
        [PAID, start, end]),

      query(`SELECT COALESCE(SUM(amount),0) AS total
             FROM expenses
             WHERE is_voided = false
               AND date >= $1::date AND date < $2::date`,
        [start.slice(0, 10), end.slice(0, 10)]),

      // Use product_variants WAC if available, fall back to products.cost_price
      query(`SELECT
               COALESCE(
                 (SELECT SUM(pv.stock_qty * pv.weighted_avg_cost) FROM product_variants pv WHERE pv.is_active = true),
                 (SELECT SUM(p.cost_price * p.stock_quantity) FROM products p),
                 0
               ) AS total`),

      query(`SELECT
               COALESCE(SUM(COALESCE(balance_due, amount)),0) AS outstanding
             FROM receivables
             WHERE COALESCE(balance_due, amount) > 0`),

      query(`SELECT
               COALESCE(SUM(COALESCE(balance_due, amount)),0) AS outstanding
             FROM payables
             WHERE COALESCE(balance_due, amount) > 0`),

      query(`SELECT
               (SELECT COUNT(*) FROM products)          AS total_products,
               (SELECT COUNT(*) FROM orders WHERE is_voided = false) AS total_orders`)
    ]);

    const totalRevenue    = parseFloat(revRes.rows[0].total);
    const paidOrders      = parseInt(revRes.rows[0].cnt, 10);
    const pendingRevenue  = parseFloat(pendRes.rows[0].total);
    const pendingOrders   = parseInt(pendRes.rows[0].cnt, 10);
    const cogs            = cogsRes.rows.reduce(
      (sum, r) => sum + parseFloat(r.cost_at_sale) * r.quantity, 0
    );
    const totalExpenses        = parseFloat(expRes.rows[0].total);
    const inventoryValue       = parseFloat(invRes.rows[0].total);
    const outstandingReceivables = parseFloat(recRes.rows[0].outstanding);
    const outstandingPayables    = parseFloat(payRes.rows[0].outstanding);
    const totalProducts        = parseInt(cntRes.rows[0].total_products, 10);
    const totalOrders          = parseInt(cntRes.rows[0].total_orders, 10);

    const grossProfit     = totalRevenue - cogs;
    const operatingProfit = grossProfit  - totalExpenses;
    const estCashPosition = operatingProfit - outstandingPayables;

    res.json({
      period,
      inventoryValue,
      totalRevenue,
      pendingRevenue,
      cogs,
      grossProfit,
      totalExpenses,
      operatingProfit,
      estCashPosition,
      outstandingReceivables,
      outstandingPayables,
      totalProducts,
      totalOrders,
      paidOrders,
      pendingOrders
    });
  } catch (err) { next(err); }
});

// ── POST /api/admin/finance/backfill-journal ──────────────────
// Creates journal entries for confirmed orders that pre-date the
// new accounting system (posted_at IS NULL). Safe to run multiple
// times — skips orders that already have journal entries.
router.post('/admin/finance/backfill-journal', requireLogin, requireAdmin, async (req, res, next) => {
  const { postEntry } = require('../services/journalService');
  const { getClient } = require('../db');

  try {
    const { rows: orders } = await query(`
      SELECT o.*, COALESCE(array_agg(row_to_json(oi)) FILTER (WHERE oi.id IS NOT NULL), '{}') AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status IN ('confirmed','shipped','delivered')
        AND o.is_voided = false
        AND o.posted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries je
          WHERE je.ref_type = 'order' AND je.ref_id = o.id AND je.is_voided = false
        )
      GROUP BY o.id
    `);

    let backfilled = 0;
    for (const order of orders) {
      const client = await getClient();
      try {
        await client.query('BEGIN');

        const items = Array.isArray(order.items) ? order.items : [];
        const subtotal       = parseFloat(order.subtotal || order.total);
        const discountAmount = parseFloat(order.discount_amount || 0);
        const shippingFee    = parseFloat(order.shipping_fee    || 0);
        const total          = parseFloat(order.total);
        const cogs           = items.reduce(
          (s, it) => s + parseFloat(it.cost_at_sale || 0) * (it.quantity || 1), 0
        );

        // Revenue entry
        const revenueLines = [
          { accountCode: '1100', debit: total, credit: 0, description: `AR: ${order.customer_name}` },
          { accountCode: '4000', debit: 0, credit: subtotal + shippingFee, description: 'Gross Sales (backfill)' }
        ];
        if (discountAmount > 0) {
          revenueLines.push({ accountCode: '4010', debit: discountAmount, credit: 0, description: 'Sales Discount' });
        }
        await postEntry({
          date:        order.created_at,
          description: `[Backfill] Sale — Order #${order.id.slice(-8).toUpperCase()}`,
          refType:     'order', refId: order.id, postedBy: req.user.id,
          lines:       revenueLines
        }, client);

        // COGS entry
        if (cogs > 0) {
          await postEntry({
            date:        order.created_at,
            description: `[Backfill] COGS — Order #${order.id.slice(-8).toUpperCase()}`,
            refType:     'order', refId: order.id, postedBy: req.user.id,
            lines: [
              { accountCode: '5000', debit: cogs, credit: 0,    description: 'COGS (backfill)' },
              { accountCode: '1200', debit: 0,    credit: cogs, description: 'Inventory (backfill)' }
            ]
          }, client);
        }

        // Mark posted and update balances
        const amountPaid = parseFloat(order.amount_paid || 0);
        const balanceDue = Math.max(0, total - amountPaid);
        await client.query(`
          UPDATE orders SET
            posted_at      = $1,
            subtotal       = $2,
            discount_amount= $3,
            balance_due    = $4,
            payment_status = CASE WHEN $4 <= 0 THEN 'paid' WHEN $5 > 0 THEN 'partial' ELSE 'unpaid' END
          WHERE id = $6
        `, [order.created_at, subtotal, discountAmount, balanceDue, amountPaid, order.id]);

        await client.query('COMMIT');
        backfilled++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[backfill] order ${order.id} failed:`, err.message);
      } finally {
        client.release();
      }
    }

    res.json({ success: true, backfilled, skipped: orders.length - backfilled });
  } catch (err) { next(err); }
});

// ── EXPENSES ─────────────────────────────────────────────────
const mapExpense = r => ({
  id:            r.id,
  category:      r.category,
  description:   r.description,
  amount:        parseFloat(r.amount),
  date:          r.date,
  paymentStatus: r.payment_status || 'paid',
  paymentMethod: r.payment_method || 'cash',
  isVoided:      r.is_voided,
  createdAt:     r.created_at
});

router.get('/admin/expenses', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM expenses WHERE is_voided = false ORDER BY date DESC, created_at DESC'
    );
    res.json(rows.map(mapExpense));
  } catch (err) { next(err); }
});

// New: post through expenseService (records journal entry)
router.post('/admin/expenses', requireLogin, requireAdmin, async (req, res, next) => {
  const { category, description, amount, date, paymentStatus, paymentMethod } = req.body;
  if (!category || !amount || !date)
    return res.status(400).json({ error: 'Category, amount, and date are required.' });
  try {
    const result = await postExpense(
      { category, description, amount, date, paymentStatus, paymentMethod },
      req.user.id
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/admin/expenses/:id', requireLogin, requireAdmin, async (req, res, next) => {
  const { category, description, amount, date } = req.body;
  try {
    const { rows } = await query(`
      UPDATE expenses SET
        category    = COALESCE($1, category),
        description = COALESCE($2, description),
        amount      = COALESCE($3, amount),
        date        = COALESCE($4::date, date)
      WHERE id = $5 AND is_voided = false RETURNING *
    `, [
      category    ? category.trim()    : null,
      description !== undefined ? description.trim() : null,
      amount      ? parseFloat(amount) : null,
      date        || null,
      req.params.id
    ]);
    if (!rows.length) return res.status(404).json({ error: 'Expense not found.' });
    res.json({ success: true, expense: mapExpense(rows[0]) });
  } catch (err) { next(err); }
});

// Void instead of hard delete
router.delete('/admin/expenses/:id', requireLogin, requireAdmin, async (req, res, next) => {
  const { reason } = req.body;
  try {
    // Check if expense has a journal entry — if so, use voidExpense
    const { rows: jes } = await query(
      "SELECT id FROM journal_entries WHERE ref_type = 'expense' AND ref_id = $1 AND is_voided = false",
      [req.params.id]
    );
    if (jes.length) {
      if (!reason) return res.status(400).json({ error: 'A void reason is required.' });
      return res.json(await voidExpense(req.params.id, { reason, adminId: req.user.id }));
    }
    // Legacy expense without journal entry — hard delete
    const result = await query(
      'UPDATE expenses SET is_voided = true WHERE id = $1', [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Expense not found.' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── RECEIVABLES ──────────────────────────────────────────────
const mapReceivable = r => ({
  id:             r.id,
  orderId:        r.order_id || r.related_order_id,
  customerId:     r.customer_id,
  customerName:   r.customer_name,
  amount:         parseFloat(r.amount),
  originalAmount: parseFloat(r.original_amount || r.amount),
  amountPaid:     parseFloat(r.amount_paid     || 0),
  balanceDue:     parseFloat(r.balance_due      ?? r.amount),
  status:         r.status,
  dueDate:        r.due_date,
  notes:          r.notes,
  createdAt:      r.created_at
});

router.get('/admin/receivables', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM receivables ORDER BY created_at DESC');
    res.json(rows.map(mapReceivable));
  } catch (err) { next(err); }
});

router.post('/admin/receivables', requireLogin, requireAdmin, async (req, res, next) => {
  const { customerName, amount, status, dueDate, notes, relatedOrderId, customerId } = req.body;
  if (!customerName || !amount)
    return res.status(400).json({ error: 'Customer name and amount are required.' });
  try {
    const { rows } = await query(`
      INSERT INTO receivables
        (order_id, related_order_id, customer_id, customer_name, amount, original_amount,
         balance_due, status, due_date, notes)
      VALUES ($1,$1,$2,$3,$4,$4,$4,$5,$6,$7) RETURNING *
    `, [
      relatedOrderId || null,
      customerId     || null,
      customerName.trim(),
      parseFloat(amount),
      status  || 'current',
      dueDate || '',
      (notes  || '').trim()
    ]);
    res.json({ success: true, receivable: mapReceivable(rows[0]) });
  } catch (err) { next(err); }
});

router.put('/admin/receivables/:id', requireLogin, requireAdmin, async (req, res, next) => {
  const { customerName, amount, status, dueDate, notes, amountPaid } = req.body;
  try {
    const { rows: cur } = await query('SELECT * FROM receivables WHERE id = $1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ error: 'Receivable not found.' });
    const c = cur[0];

    const newAmountPaid = amountPaid !== undefined ? parseFloat(amountPaid) : parseFloat(c.amount_paid || 0);
    const origAmount    = amount ? parseFloat(amount) : parseFloat(c.original_amount || c.amount);
    const balanceDue    = Math.max(0, origAmount - newAmountPaid);
    const newStatus     = status || (balanceDue <= 0 ? 'paid' : c.status);

    const { rows } = await query(`
      UPDATE receivables SET
        customer_name   = COALESCE($1, customer_name),
        amount          = COALESCE($2, amount),
        original_amount = COALESCE($2, original_amount),
        amount_paid     = $3,
        balance_due     = $4,
        status          = $5,
        due_date        = COALESCE($6, due_date),
        notes           = COALESCE($7, notes)
      WHERE id = $8 RETURNING *
    `, [
      customerName ? customerName.trim() : null,
      amount ? parseFloat(amount) : null,
      newAmountPaid, balanceDue, newStatus,
      dueDate !== undefined ? dueDate : null,
      notes   !== undefined ? notes.trim() : null,
      req.params.id
    ]);
    res.json({ success: true, receivable: mapReceivable(rows[0]) });
  } catch (err) { next(err); }
});

router.delete('/admin/receivables/:id', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const result = await query('DELETE FROM receivables WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Receivable not found.' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Sync receivables from confirmed orders (admin utility)
router.post('/admin/finance/sync-receivables', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const ordersRes = await query(
      `SELECT * FROM orders WHERE status = ANY($1) AND is_voided = false`,
      [['confirmed','shipped','delivered']]
    );
    const recRes = await query(
      'SELECT order_id FROM receivables WHERE order_id IS NOT NULL'
    );
    const existing = new Set(recRes.rows.map(r => r.order_id));
    let created = 0;
    for (const o of ordersRes.rows) {
      if (!existing.has(o.id)) {
        const balance = parseFloat(o.balance_due ?? o.total);
        await query(`
          INSERT INTO receivables
            (order_id, related_order_id, customer_id, customer_name, amount,
             original_amount, amount_paid, balance_due, status)
          VALUES ($1,$1,$2,$3,$4,$4,$5,$6,$7)
        `, [
          o.id, o.user_id, o.customer_name, o.total,
          parseFloat(o.amount_paid || 0),
          balance,
          balance <= 0 ? 'paid' : 'current'
        ]);
        created++;
      }
    }
    res.json({ success: true, created });
  } catch (err) { next(err); }
});

// ── PAYABLES ─────────────────────────────────────────────────
const mapPayable = r => ({
  id:             r.id,
  purchaseId:     r.purchase_id,
  supplierName:   r.supplier_name,
  description:    r.description,
  amount:         parseFloat(r.amount),
  originalAmount: parseFloat(r.original_amount || r.amount),
  amountPaid:     parseFloat(r.amount_paid     || 0),
  balanceDue:     parseFloat(r.balance_due      ?? r.amount),
  status:         r.status,
  dueDate:        r.due_date,
  notes:          r.notes,
  createdAt:      r.created_at
});

router.get('/admin/payables', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM payables ORDER BY created_at DESC');
    res.json(rows.map(mapPayable));
  } catch (err) { next(err); }
});

router.post('/admin/payables', requireLogin, requireAdmin, async (req, res, next) => {
  const { supplierName, description, amount, status, dueDate, notes } = req.body;
  if (!supplierName || !amount)
    return res.status(400).json({ error: 'Supplier name and amount are required.' });
  try {
    const { rows } = await query(`
      INSERT INTO payables (supplier_name, description, amount, original_amount, balance_due, status, due_date, notes)
      VALUES ($1,$2,$3,$3,$3,$4,$5,$6) RETURNING *
    `, [
      supplierName.trim(),
      (description || '').trim(),
      parseFloat(amount),
      status  || 'unpaid',
      dueDate || '',
      (notes  || '').trim()
    ]);
    res.json({ success: true, payable: mapPayable(rows[0]) });
  } catch (err) { next(err); }
});

router.put('/admin/payables/:id', requireLogin, requireAdmin, async (req, res, next) => {
  const { supplierName, description, amount, status, dueDate, notes } = req.body;
  try {
    const { rows } = await query(`
      UPDATE payables SET
        supplier_name = COALESCE($1, supplier_name),
        description   = COALESCE($2, description),
        amount        = COALESCE($3, amount),
        status        = COALESCE($4, status),
        due_date      = COALESCE($5, due_date),
        notes         = COALESCE($6, notes)
      WHERE id = $7 RETURNING *
    `, [
      supplierName ? supplierName.trim()  : null,
      description !== undefined ? description.trim() : null,
      amount       ? parseFloat(amount)   : null,
      status       || null,
      dueDate !== undefined ? dueDate     : null,
      notes   !== undefined ? notes.trim(): null,
      req.params.id
    ]);
    if (!rows.length) return res.status(404).json({ error: 'Payable not found.' });
    res.json({ success: true, payable: mapPayable(rows[0]) });
  } catch (err) { next(err); }
});

router.delete('/admin/payables/:id', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const result = await query('DELETE FROM payables WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Payable not found.' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
