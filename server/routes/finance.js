// ============================================================
// routes/finance.js — Overview, expenses, receivables, payables
// ============================================================

const express = require('express');
const { query } = require('../db');
const { requireLogin, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ── Period helper ─────────────────────────────────────────────
function periodBounds(period) {
  const now = new Date();
  if (period === 'thisMonth') {
    return [
      new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()
    ];
  }
  if (period === 'thisYear') {
    return [
      new Date(now.getFullYear(), 0, 1).toISOString(),
      new Date(now.getFullYear() + 1, 0, 1).toISOString()
    ];
  }
  return ['1970-01-01T00:00:00Z', '2999-12-31T23:59:59Z'];
}

// ── GET /api/admin/finance/overview ──────────────────────────
router.get('/admin/finance/overview', requireLogin, requireAdmin, async (req, res, next) => {
  const [start, end] = periodBounds(req.query.period || 'allTime');
  const PAID = ['confirmed', 'shipped', 'delivered'];

  try {
    // Fire all independent aggregates in parallel — much faster than sequential
    const [revRes, pendRes, cogsRes, expRes, invRes, recRes, payRes, cntRes] = await Promise.all([
      // Revenue from paid orders in period
      query(`SELECT COALESCE(SUM(o.total),0) AS total, COUNT(*) AS cnt
             FROM orders o
             WHERE o.status = ANY($1) AND o.created_at >= $2 AND o.created_at < $3`,
        [PAID, start, end]),

      // Pending revenue in period
      query(`SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS cnt
             FROM orders
             WHERE status = 'pending' AND created_at >= $1 AND created_at < $2`,
        [start, end]),

      // Items of paid orders for COGS calculation
      // (we sum in SQL where possible; complex formula stays in JS)
      query(`SELECT oi.cost_at_sale, oi.quantity
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE o.status = ANY($1) AND o.created_at >= $2 AND o.created_at < $3`,
        [PAID, start, end]),

      // Expenses in period (date column is DATE, so use ::date cast)
      query(`SELECT COALESCE(SUM(amount),0) AS total
             FROM expenses
             WHERE date >= $1::date AND date < $2::date`,
        [start.slice(0, 10), end.slice(0, 10)]),

      // Inventory value = Σ(cost_price × stock_quantity)
      query(`SELECT COALESCE(SUM(cost_price * stock_quantity),0) AS total FROM products`),

      // Receivables: grand total + outstanding subset
      query(`SELECT
               COALESCE(SUM(amount),0) AS total,
               COALESCE(SUM(CASE WHEN status = ANY($1) THEN amount ELSE 0 END),0) AS outstanding
             FROM receivables`,
        [['pending','overdue','open','partial']]),

      // Payables: grand total + outstanding subset
      query(`SELECT
               COALESCE(SUM(amount),0) AS total,
               COALESCE(SUM(CASE WHEN status = ANY($1) THEN amount ELSE 0 END),0) AS outstanding
             FROM payables`,
        [['unpaid','partial','overdue']]),

      // Product and order counts
      query(`SELECT
               (SELECT COUNT(*) FROM products) AS total_products,
               (SELECT COUNT(*) FROM orders)   AS total_orders`)
    ]);

    const totalRevenue  = parseFloat(revRes.rows[0].total);
    const paidOrders    = parseInt(revRes.rows[0].cnt, 10);
    const pendingRevenue = parseFloat(pendRes.rows[0].total);
    const pendingOrders  = parseInt(pendRes.rows[0].cnt, 10);

    // COGS: sum costAtSale × quantity for every item in paid orders
    const cogs = cogsRes.rows.reduce(
      (sum, r) => sum + parseFloat(r.cost_at_sale) * r.quantity,
      0
    );

    const totalExpenses           = parseFloat(expRes.rows[0].total);
    const inventoryValue          = parseFloat(invRes.rows[0].total);
    const totalReceivables        = parseFloat(recRes.rows[0].total);
    const outstandingReceivables  = parseFloat(recRes.rows[0].outstanding);
    const totalPayables           = parseFloat(payRes.rows[0].total);
    const outstandingPayables     = parseFloat(payRes.rows[0].outstanding);
    const totalProducts           = parseInt(cntRes.rows[0].total_products, 10);
    const totalOrders             = parseInt(cntRes.rows[0].total_orders, 10);

    const grossProfit     = totalRevenue - cogs;
    const operatingProfit = grossProfit  - totalExpenses;
    const estCashPosition = operatingProfit - outstandingPayables;

    res.json({
      period: req.query.period || 'allTime',
      inventoryValue,
      totalRevenue,
      pendingRevenue,
      cogs,
      grossProfit,
      totalExpenses,
      operatingProfit,
      outstandingReceivables,
      totalReceivables,
      outstandingPayables,
      totalPayables,
      estCashPosition,
      totalProducts,
      totalOrders,
      paidOrders,
      pendingOrders
    });
  } catch (err) { next(err); }
});

// ── EXPENSES ─────────────────────────────────────────────────
const mapExpense = r => ({
  id:          r.id,
  category:    r.category,
  description: r.description,
  amount:      parseFloat(r.amount),
  date:        r.date,
  createdAt:   r.created_at
});

router.get('/admin/expenses', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM expenses ORDER BY created_at DESC');
    res.json(rows.map(mapExpense));
  } catch (err) { next(err); }
});

router.post('/admin/expenses', requireLogin, requireAdmin, async (req, res, next) => {
  const { category, description, amount, date } = req.body;
  if (!category || !amount || !date)
    return res.status(400).json({ error: 'Category, amount, and date are required.' });
  try {
    const { rows } = await query(
      'INSERT INTO expenses (category, description, amount, date) VALUES ($1,$2,$3,$4::date) RETURNING *',
      [category.trim(), (description || '').trim(), parseFloat(amount), date]
    );
    res.json({ success: true, expense: mapExpense(rows[0]) });
  } catch (err) { next(err); }
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
      WHERE id = $5 RETURNING *
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

router.delete('/admin/expenses/:id', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const result = await query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Expense not found.' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── RECEIVABLES ──────────────────────────────────────────────
const mapReceivable = r => ({
  id:             r.id,
  relatedOrderId: r.related_order_id,
  customerId:     r.customer_id,
  customerName:   r.customer_name,
  amount:         parseFloat(r.amount),
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
        (related_order_id, customer_id, customer_name, amount, status, due_date, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [
      relatedOrderId || null,
      customerId     || null,
      customerName.trim(),
      parseFloat(amount),
      status  || 'pending',
      dueDate || '',
      (notes  || '').trim()
    ]);
    res.json({ success: true, receivable: mapReceivable(rows[0]) });
  } catch (err) { next(err); }
});

router.put('/admin/receivables/:id', requireLogin, requireAdmin, async (req, res, next) => {
  const { customerName, amount, status, dueDate, notes } = req.body;
  try {
    const { rows } = await query(`
      UPDATE receivables SET
        customer_name = COALESCE($1, customer_name),
        amount        = COALESCE($2, amount),
        status        = COALESCE($3, status),
        due_date      = COALESCE($4, due_date),
        notes         = COALESCE($5, notes)
      WHERE id = $6 RETURNING *
    `, [
      customerName ? customerName.trim() : null,
      amount       ? parseFloat(amount)  : null,
      status       || null,
      dueDate !== undefined ? dueDate    : null,
      notes   !== undefined ? notes.trim(): null,
      req.params.id
    ]);
    if (!rows.length) return res.status(404).json({ error: 'Receivable not found.' });
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

// POST /api/admin/finance/sync-receivables
router.post('/admin/finance/sync-receivables', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const ordersRes = await query(
      `SELECT * FROM orders WHERE status = ANY($1)`,
      [['confirmed','shipped','delivered']]
    );
    const recRes = await query(
      'SELECT related_order_id FROM receivables WHERE related_order_id IS NOT NULL'
    );
    const existing = new Set(recRes.rows.map(r => r.related_order_id));

    let created = 0;
    for (const o of ordersRes.rows) {
      if (!existing.has(o.id)) {
        await query(`
          INSERT INTO receivables (related_order_id, customer_id, customer_name, amount, status)
          VALUES ($1,$2,$3,$4,$5)
        `, [o.id, o.user_id, o.customer_name, o.total, o.status === 'delivered' ? 'paid' : 'pending']);
        created++;
      }
    }
    res.json({ success: true, created });
  } catch (err) { next(err); }
});

// ── PAYABLES ─────────────────────────────────────────────────
const mapPayable = r => ({
  id:           r.id,
  supplierName: r.supplier_name,
  description:  r.description,
  amount:       parseFloat(r.amount),
  status:       r.status,
  dueDate:      r.due_date,
  notes:        r.notes,
  createdAt:    r.created_at
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
      INSERT INTO payables (supplier_name, description, amount, status, due_date, notes)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
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
