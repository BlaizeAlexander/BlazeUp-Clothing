// ============================================================
// journalService.js — Double-entry journal engine
//
// All posting functions accept a pg client so they can
// participate in the caller's transaction (BEGIN/COMMIT/ROLLBACK
// lives in the route or higher-level service).
// ============================================================

const { query: poolQuery } = require('../db');

// ── Account code → UUID lookup (cached per process) ──────────
const _accountCache = {};

async function accountId(code, client) {
  if (_accountCache[code]) return _accountCache[code];
  const q = client || poolQuery;
  const fn = client ? (sql, p) => client.query(sql, p) : poolQuery;
  const { rows } = await fn(
    'SELECT id FROM accounts WHERE code = $1 AND is_active = true', [code]
  );
  if (!rows.length) throw new Error(`Account code "${code}" not found.`);
  _accountCache[code] = rows[0].id;
  return rows[0].id;
}

/**
 * Create a balanced journal entry inside the caller's transaction.
 *
 * lines: [{ accountCode, debit, credit, description }]
 *
 * Throws if debits ≠ credits (to the cent).
 */
async function postEntry({ date, description, refType, refId, postedBy, lines }, client) {
  // Validate balance
  const totalDebit  = lines.reduce((s, l) => s + (l.debit  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
    throw new Error(
      `Journal entry is not balanced: debits=${totalDebit} credits=${totalCredit}`
    );
  }

  // Resolve account codes → UUIDs
  const resolved = await Promise.all(
    lines.map(async l => ({
      account_id:  await accountId(l.accountCode, client),
      debit:       l.debit  || 0,
      credit:      l.credit || 0,
      description: l.description || ''
    }))
  );

  // Insert journal entry header
  const { rows: [je] } = await client.query(`
    INSERT INTO journal_entries (date, description, ref_type, ref_id, posted_by)
    VALUES ($1, $2, $3, $4, $5) RETURNING id
  `, [date || new Date(), description, refType || null, refId || null, postedBy || null]);

  // Insert lines
  for (const line of resolved) {
    await client.query(`
      INSERT INTO journal_entry_lines
        (journal_entry_id, account_id, debit, credit, description)
      VALUES ($1,$2,$3,$4,$5)
    `, [je.id, line.account_id, line.debit, line.credit, line.description]);
  }

  return je.id;
}

/**
 * Void a journal entry — marks it voided and posts a reversing entry.
 * Both operations happen inside the caller's transaction.
 */
async function voidEntry(journalEntryId, { reason, voidedBy }, client) {
  const { rows } = await client.query(
    'SELECT * FROM journal_entries WHERE id = $1', [journalEntryId]
  );
  if (!rows.length) throw new Error('Journal entry not found.');
  if (rows[0].is_voided) throw new Error('Journal entry is already voided.');

  const je = rows[0];

  // Mark original as voided
  await client.query(`
    UPDATE journal_entries
    SET is_voided = true, void_reason = $1, voided_at = NOW(), voided_by = $2
    WHERE id = $3
  `, [reason, voidedBy, journalEntryId]);

  // Fetch original lines
  const { rows: lines } = await client.query(
    'SELECT * FROM journal_entry_lines WHERE journal_entry_id = $1', [journalEntryId]
  );

  // Post reversal (swap debit/credit)
  const reversalLines = lines.map(l => ({
    accountCode: null,        // we'll use account_id directly below
    _account_id: l.account_id,
    debit:  l.credit,
    credit: l.debit,
    description: `Reversal: ${l.description}`
  }));

  const { rows: [rev] } = await client.query(`
    INSERT INTO journal_entries
      (date, description, ref_type, ref_id, posted_by)
    VALUES (NOW()::date, $1, 'reversal', $2, $3) RETURNING id
  `, [`VOID: ${je.description}`, journalEntryId, voidedBy]);

  for (const line of reversalLines) {
    await client.query(`
      INSERT INTO journal_entry_lines
        (journal_entry_id, account_id, debit, credit, description)
      VALUES ($1,$2,$3,$4,$5)
    `, [rev.id, line._account_id, line.debit, line.credit, line.description]);
  }

  return rev.id;
}

/**
 * Get current balance for an account (debit-normal = debit - credit).
 * Used by reportService.
 */
async function getAccountBalance(accountCode, { startDate, endDate } = {}) {
  let sql = `
    SELECT
      COALESCE(SUM(jel.debit),  0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE a.code = $1
      AND je.is_voided = false
  `;
  const params = [accountCode];
  if (startDate) { params.push(startDate); sql += ` AND je.date >= $${params.length}`; }
  if (endDate)   { params.push(endDate);   sql += ` AND je.date <= $${params.length}`; }

  const { rows } = await poolQuery(sql, params);
  const { total_debit, total_credit } = rows[0];
  return parseFloat(total_debit) - parseFloat(total_credit); // debit-normal balance
}

module.exports = { postEntry, voidEntry, getAccountBalance, accountId };
