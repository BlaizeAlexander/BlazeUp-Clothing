// ============================================================
// reportService.js — Financial report calculations
//
// Correct formulas (hard law — never deviate):
//   Net Sales       = Gross Sales - Sales Discounts - Sales Returns
//   Gross Profit    = Net Sales - COGS
//   Net Profit      = Gross Profit - Operating Expenses
//   Inventory Value = Σ (stock_qty × weighted_avg_cost)
//   Cash Balance    = Σ debits on cash accounts - Σ credits
//   (Cash ≠ Net Profit minus payables — never)
// ============================================================

const { query } = require('../db');

// ── Date helpers ──────────────────────────────────────────────
function periodBounds(period, customStart, customEnd) {
  const now = new Date();
  if (period === 'thisMonth')
    return [
      new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
      new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
    ];
  if (period === 'lastMonth') {
    const m = now.getMonth() - 1;
    return [
      new Date(now.getFullYear(), m, 1).toISOString().slice(0, 10),
      new Date(now.getFullYear(), m + 1, 0).toISOString().slice(0, 10)
    ];
  }
  if (period === 'thisYear')
    return [
      new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10),
      new Date(now.getFullYear(), 11, 31).toISOString().slice(0, 10)
    ];
  if (period === 'custom' && customStart && customEnd)
    return [customStart, customEnd];
  return ['1970-01-01', '2999-12-31'];
}

// ── Profit & Loss ─────────────────────────────────────────────
async function getProfitAndLoss(period = 'thisMonth', customStart, customEnd) {
  const [start, end] = periodBounds(period, customStart, customEnd);

  // All figures come from journal entry lines — single source of truth
  const accountSummary = await query(`
    SELECT
      a.code,
      a.name,
      a.type,
      COALESCE(SUM(jel.debit),  0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit
    FROM accounts a
    LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
      AND je.is_voided = false
      AND je.date BETWEEN $1 AND $2
    WHERE a.type IN ('revenue','expense')
    GROUP BY a.code, a.name, a.type, a.normal_balance
    ORDER BY a.code
  `, [start, end]);

  const get = (code) => {
    const row = accountSummary.rows.find(r => r.code === code);
    if (!row) return 0;
    // Revenue accounts: normal credit → balance = credit - debit
    // Expense accounts: normal debit  → balance = debit - credit
    return row.type === 'revenue'
      ? parseFloat(row.total_credit) - parseFloat(row.total_debit)
      : parseFloat(row.total_debit)  - parseFloat(row.total_credit);
  };

  const grossSales     = get('4000');
  const salesDiscounts = get('4010');
  const salesReturns   = get('4020');
  const netSales       = grossSales - salesDiscounts - salesReturns;
  const cogs           = get('5000');
  const grossProfit    = netSales - cogs;
  const grossMargin    = netSales > 0 ? (grossProfit / netSales) * 100 : 0;

  const expenseLines = accountSummary.rows
    .filter(r => r.type === 'expense' && r.code !== '5000')
    .map(r => ({
      code:   r.code,
      name:   r.name,
      amount: parseFloat(r.total_debit) - parseFloat(r.total_credit)
    }));
  const totalOpEx  = expenseLines.reduce((s, e) => s + e.amount, 0);
  const netProfit  = grossProfit - totalOpEx;
  const netMargin  = netSales > 0 ? (netProfit / netSales) * 100 : 0;

  return {
    period: { label: period, start, end },
    grossSales, salesDiscounts, salesReturns, netSales,
    cogs, grossProfit, grossMargin: +grossMargin.toFixed(2),
    operatingExpenses: expenseLines,
    totalOperatingExpenses: totalOpEx,
    netProfit, netMargin: +netMargin.toFixed(2)
  };
}

// ── Balance Sheet ─────────────────────────────────────────────
async function getBalanceSheet(asOf) {
  const date = asOf || new Date().toISOString().slice(0, 10);

  const { rows } = await query(`
    SELECT
      a.code, a.name, a.type, a.normal_balance,
      COALESCE(SUM(jel.debit),  0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit
    FROM accounts a
    LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
      AND je.is_voided = false
      AND je.date <= $1
    GROUP BY a.code, a.name, a.type, a.normal_balance
    ORDER BY a.code
  `, [date]);

  const balance = (row) => row.normal_balance === 'debit'
    ? parseFloat(row.total_debit) - parseFloat(row.total_credit)
    : parseFloat(row.total_credit) - parseFloat(row.total_debit);

  const assets      = rows.filter(r => r.type === 'asset').map(r => ({ code: r.code, name: r.name, amount: balance(r) }));
  const liabilities = rows.filter(r => r.type === 'liability').map(r => ({ code: r.code, name: r.name, amount: balance(r) }));
  const equity      = rows.filter(r => r.type === 'equity').map(r => ({ code: r.code, name: r.name, amount: balance(r) }));

  // Retained earnings = all revenue - all expenses (cumulative, up to date)
  const revenue  = rows.filter(r => r.type === 'revenue').reduce((s, r) => s + balance(r), 0);
  const expenses = rows.filter(r => r.type === 'expense').reduce((s, r) => s + balance(r), 0);
  const retainedEarnings = revenue - expenses;

  const totalAssets      = assets.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
  const totalEquity      = equity.reduce((s, r) => s + r.amount, 0) + retainedEarnings;

  return {
    asOf: date,
    assets,      totalAssets,
    liabilities, totalLiabilities,
    equity: [...equity, { code: 'RE', name: 'Retained Earnings', amount: retainedEarnings }],
    totalEquity,
    isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.02
  };
}

// ── Cash Flow Summary ─────────────────────────────────────────
async function getCashFlow(period = 'thisMonth', customStart, customEnd) {
  const [start, end] = periodBounds(period, customStart, customEnd);

  // Cash accounts: 1000 (cash on hand), 1010 (gcash/bank)
  const { rows } = await query(`
    SELECT
      a.code, a.name,
      COALESCE(SUM(jel.debit),  0) AS inflows,
      COALESCE(SUM(jel.credit), 0) AS outflows
    FROM accounts a
    JOIN journal_entry_lines jel ON jel.account_id = a.id
    JOIN journal_entries je ON je.id = jel.journal_entry_id
      AND je.is_voided = false
      AND je.date BETWEEN $1 AND $2
    WHERE a.code IN ('1000','1010')
    GROUP BY a.code, a.name
  `, [start, end]);

  const totalInflows  = rows.reduce((s, r) => s + parseFloat(r.inflows), 0);
  const totalOutflows = rows.reduce((s, r) => s + parseFloat(r.outflows), 0);
  const netCashFlow   = totalInflows - totalOutflows;

  // Current cash balance (cumulative, all time up to end of period)
  const { rows: balRows } = await query(`
    SELECT
      COALESCE(SUM(jel.debit),  0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE a.code IN ('1000','1010')
      AND je.is_voided = false
      AND je.date <= $1
  `, [end]);

  const cashBalance = parseFloat(balRows[0].total_debit) - parseFloat(balRows[0].total_credit);

  return {
    period: { label: period, start, end },
    accounts: rows,
    totalInflows, totalOutflows, netCashFlow, cashBalance
  };
}

// ── Receivables Aging ─────────────────────────────────────────
async function getReceivablesAging() {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await query(`
    SELECT
      r.*,
      CASE
        WHEN r.balance_due <= 0        THEN 'paid'
        WHEN r.due_date = ''           THEN 'current'
        WHEN r.due_date >= $1          THEN 'current'
        WHEN r.due_date < $1
          AND (($1::date - r.due_date::date) <= 30) THEN '1-30 days'
        WHEN ($1::date - r.due_date::date) <= 60    THEN '31-60 days'
        WHEN ($1::date - r.due_date::date) <= 90    THEN '61-90 days'
        ELSE 'over 90 days'
      END AS aging_bucket,
      ($1::date - NULLIF(r.due_date,'')::date) AS days_overdue
    FROM receivables r
    WHERE r.balance_due > 0
    ORDER BY r.due_date ASC NULLS LAST
  `, [today]);

  const buckets = {};
  rows.forEach(r => {
    const b = r.aging_bucket;
    if (!buckets[b]) buckets[b] = { count: 0, total: 0 };
    buckets[b].count++;
    buckets[b].total += parseFloat(r.balance_due);
  });

  return { asOf: today, receivables: rows, buckets, totalOutstanding: rows.reduce((s, r) => s + parseFloat(r.balance_due), 0) };
}

// ── Payables Aging ────────────────────────────────────────────
async function getPayablesAging() {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await query(`
    SELECT
      p.*,
      CASE
        WHEN COALESCE(p.balance_due, p.amount) <= 0 THEN 'paid'
        WHEN p.due_date = '' OR p.due_date IS NULL   THEN 'current'
        WHEN p.due_date >= $1                        THEN 'current'
        WHEN ($1::date - p.due_date::date) <= 30     THEN '1-30 days'
        WHEN ($1::date - p.due_date::date) <= 60     THEN '31-60 days'
        WHEN ($1::date - p.due_date::date) <= 90     THEN '61-90 days'
        ELSE 'over 90 days'
      END AS aging_bucket
    FROM payables p
    WHERE COALESCE(p.balance_due, p.amount) > 0
    ORDER BY p.due_date ASC NULLS LAST
  `, [today]);

  const totalOutstanding = rows.reduce((s, r) => s + parseFloat(r.balance_due ?? r.amount), 0);
  return { asOf: today, payables: rows, totalOutstanding };
}

// ── Inventory Valuation ───────────────────────────────────────
async function getInventoryValuation() {
  const { getInventoryValuation: val } = require('./inventoryService');
  return val();
}

// ── Sales Report ──────────────────────────────────────────────
async function getSalesReport(period = 'thisMonth', customStart, customEnd) {
  const [start, end] = periodBounds(period, customStart, customEnd);

  const [ordersRes, topProductsRes, dailyRes] = await Promise.all([
    query(`
      SELECT
        COUNT(*)                                        AS total_orders,
        SUM(o.total)                                    AS gross_revenue,
        SUM(o.discount_amount)                          AS total_discounts,
        SUM(o.total - o.discount_amount)                AS net_revenue,
        AVG(o.total)                                    AS avg_order_value,
        COUNT(*) FILTER (WHERE o.payment_status='paid') AS paid_orders,
        SUM(o.total) FILTER (WHERE o.payment_status='paid') AS collected_revenue
      FROM orders o
      WHERE o.is_voided = false
        AND o.status NOT IN ('cancelled','pending')
        AND o.created_at::date BETWEEN $1 AND $2
    `, [start, end]),

    query(`
      SELECT
        oi.name,
        SUM(oi.quantity)   AS units_sold,
        SUM(oi.line_total) AS revenue,
        SUM(oi.line_cogs)  AS cogs
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.is_voided = false
        AND o.status NOT IN ('cancelled','pending')
        AND o.created_at::date BETWEEN $1 AND $2
      GROUP BY oi.name
      ORDER BY units_sold DESC
      LIMIT 10
    `, [start, end]),

    query(`
      SELECT
        o.created_at::date AS sale_date,
        COUNT(*)           AS orders,
        SUM(o.total)       AS revenue
      FROM orders o
      WHERE o.is_voided = false
        AND o.status NOT IN ('cancelled','pending')
        AND o.created_at::date BETWEEN $1 AND $2
      GROUP BY o.created_at::date
      ORDER BY sale_date
    `, [start, end])
  ]);

  const s = ordersRes.rows[0];
  return {
    period: { label: period, start, end },
    summary: {
      totalOrders:      parseInt(s.total_orders, 10),
      grossRevenue:     parseFloat(s.gross_revenue || 0),
      totalDiscounts:   parseFloat(s.total_discounts || 0),
      netRevenue:       parseFloat(s.net_revenue || 0),
      avgOrderValue:    parseFloat(s.avg_order_value || 0),
      paidOrders:       parseInt(s.paid_orders, 10),
      collectedRevenue: parseFloat(s.collected_revenue || 0)
    },
    topProducts: topProductsRes.rows,
    dailyBreakdown: dailyRes.rows
  };
}

// ── Dashboard KPIs (fast single call) ────────────────────────
async function getDashboardKPIs(period = 'thisMonth') {
  const [pnl, cf, recAging, payAging, inv] = await Promise.all([
    getProfitAndLoss(period),
    getCashFlow(period),
    getReceivablesAging(),
    getPayablesAging(),
    getInventoryValuation()
  ]);

  const lowStock = inv.items.filter(i => i.is_low_stock);

  // Overdue: receivables with a real due_date in the past
  const overdueReceivables = recAging.receivables.filter(r =>
    r.aging_bucket !== 'current' && r.aging_bucket !== 'paid'
  );

  return {
    period,
    // Performance
    netSales:          pnl.netSales,
    grossProfit:       pnl.grossProfit,
    grossMargin:       pnl.grossMargin,
    netProfit:         pnl.netProfit,
    netMargin:         pnl.netMargin,
    cogs:              pnl.cogs,
    totalOpEx:         pnl.totalOperatingExpenses,
    // Financial position
    cashBalance:       cf.cashBalance,
    accountsReceivable: recAging.totalOutstanding,
    accountsPayable:   payAging.totalOutstanding,
    inventoryValue:    inv.totalValue,
    // Alerts
    lowStockCount:     lowStock.length,
    lowStockItems:     lowStock.slice(0, 10),
    overdueReceivablesCount:  overdueReceivables.length,
    overdueReceivablesAmount: overdueReceivables.reduce((s, r) => s + parseFloat(r.balance_due), 0),
    // Cash flow
    cashInflows:  cf.totalInflows,
    cashOutflows: cf.totalOutflows,
    netCashFlow:  cf.netCashFlow
  };
}

module.exports = {
  getProfitAndLoss,
  getBalanceSheet,
  getCashFlow,
  getReceivablesAging,
  getPayablesAging,
  getInventoryValuation,
  getSalesReport,
  getDashboardKPIs
};
