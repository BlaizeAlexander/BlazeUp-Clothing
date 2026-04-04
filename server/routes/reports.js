// ============================================================
// routes/reports.js — All financial report endpoints
// ============================================================

const express = require('express');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const {
  getProfitAndLoss,
  getBalanceSheet,
  getCashFlow,
  getReceivablesAging,
  getPayablesAging,
  getInventoryValuation,
  getSalesReport,
  getDashboardKPIs
} = require('../services/reportService');

const router = express.Router();

// Helper: parse period from query
function getPeriodParams(q) {
  return {
    period:      q.period || 'thisMonth',
    customStart: q.start  || null,
    customEnd:   q.end    || null
  };
}

// ── GET /api/admin/reports/dashboard ─────────────────────────
router.get('/admin/reports/dashboard', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { period } = getPeriodParams(req.query);
    res.json(await getDashboardKPIs(period));
  } catch (err) { next(err); }
});

// ── GET /api/admin/reports/pnl ───────────────────────────────
router.get('/admin/reports/pnl', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { period, customStart, customEnd } = getPeriodParams(req.query);
    res.json(await getProfitAndLoss(period, customStart, customEnd));
  } catch (err) { next(err); }
});

// ── GET /api/admin/reports/balance-sheet ─────────────────────
router.get('/admin/reports/balance-sheet', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    res.json(await getBalanceSheet(req.query.asOf || null));
  } catch (err) { next(err); }
});

// ── GET /api/admin/reports/cash-flow ─────────────────────────
router.get('/admin/reports/cash-flow', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { period, customStart, customEnd } = getPeriodParams(req.query);
    res.json(await getCashFlow(period, customStart, customEnd));
  } catch (err) { next(err); }
});

// ── GET /api/admin/reports/sales ─────────────────────────────
router.get('/admin/reports/sales', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { period, customStart, customEnd } = getPeriodParams(req.query);
    res.json(await getSalesReport(period, customStart, customEnd));
  } catch (err) { next(err); }
});

// ── GET /api/admin/reports/receivables-aging ─────────────────
router.get('/admin/reports/receivables-aging', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    res.json(await getReceivablesAging());
  } catch (err) { next(err); }
});

// ── GET /api/admin/reports/payables-aging ────────────────────
router.get('/admin/reports/payables-aging', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    res.json(await getPayablesAging());
  } catch (err) { next(err); }
});

// ── GET /api/admin/reports/inventory ─────────────────────────
router.get('/admin/reports/inventory', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    res.json(await getInventoryValuation());
  } catch (err) { next(err); }
});

// ── GET /api/admin/accounts ───────────────────────────────────
// Chart of accounts — for manual journal entry forms
router.get('/admin/accounts', requireLogin, requireAdmin, async (req, res, next) => {
  const { query } = require('../db');
  try {
    const { rows } = await query(
      'SELECT id, code, name, type, normal_balance FROM accounts WHERE is_active = true ORDER BY code'
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/admin/journal-entries ───────────────────────────
router.get('/admin/journal-entries', requireLogin, requireAdmin, async (req, res, next) => {
  const { query } = require('../db');
  try {
    const limit  = Math.min(parseInt(req.query.limit  || 100, 10), 500);
    const offset = parseInt(req.query.offset || 0, 10);
    const { rows } = await query(`
      SELECT
        je.*,
        u.username AS posted_by_name,
        json_agg(json_build_object(
          'account_code', a.code,
          'account_name', a.name,
          'debit',        jel.debit,
          'credit',       jel.credit,
          'description',  jel.description
        ) ORDER BY jel.created_at) AS lines
      FROM journal_entries je
      LEFT JOIN users u ON u.id = je.posted_by
      LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
      LEFT JOIN accounts a ON a.id = jel.account_id
      WHERE je.is_voided = false
      GROUP BY je.id, u.username
      ORDER BY je.date DESC, je.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
