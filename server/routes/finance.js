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

// ── LEGACY overview (kept for existing admin.js) ─────────────
// New code should use GET /api/admin/reports/dashboard instead.
router.get('/admin/finance/overview', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { getDashboardKPIs } = require('../services/reportService');
    const period = req.query.period === 'thisYear' ? 'thisYear'
                 : req.query.period === 'thisMonth' ? 'thisMonth'
                 : 'allTime';
    const kpis = await getDashboardKPIs(period);
    // Shape response to match what existing admin.js expects
    res.json({
      period,
      totalRevenue:          kpis.netSales,
      grossProfit:           kpis.grossProfit,
      operatingProfit:       kpis.netProfit,
      cogs:                  kpis.cogs,
      totalExpenses:         kpis.totalOpEx,
      inventoryValue:        kpis.inventoryValue,
      cashBalance:           kpis.cashBalance,
      outstandingReceivables: kpis.accountsReceivable,
      outstandingPayables:   kpis.accountsPayable,
      totalProducts:         0,
      totalOrders:           0
    });
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
