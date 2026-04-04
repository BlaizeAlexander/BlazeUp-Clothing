// ============================================================
// expenseService.js — Operating expense posting
//
// Flow (paid expense):
//   Dr [Expense Account] / Cr Cash/GCash
//
// Flow (unpaid/accrued expense):
//   Dr [Expense Account] / Cr Accrued Expenses (2100)
//
// Key rule: inventory purchases are NOT expenses.
// Expenses are operating costs: rent, salaries, delivery, etc.
// ============================================================

const { postEntry, voidEntry } = require('./journalService');
const { getClient, query: poolQuery } = require('../db');

const CATEGORY_ACCOUNT = {
  rent:          '6000',
  packaging:     '6010',
  delivery:      '6020',
  'ads/marketing': '6030',
  utilities:     '6040',
  salaries:      '6050',
  miscellaneous: '6090'
};

const METHOD_ACCOUNT = { cash: '1000', gcash: '1010', bank: '1010', other: '1000' };

/**
 * Post an operating expense.
 * @param {object} data - { category, description, amount, date, paymentStatus, paymentMethod, referenceNumber }
 * @param {string} adminId
 */
async function postExpense(data, adminId) {
  const {
    category, description, amount, date,
    paymentStatus = 'paid', paymentMethod = 'cash', referenceNumber
  } = data;

  const expenseAmount = parseFloat(amount);
  if (expenseAmount <= 0) throw new Error('Expense amount must be positive.');

  const expenseAccountCode = CATEGORY_ACCOUNT[category?.toLowerCase()];
  if (!expenseAccountCode) {
    throw new Error(`Unknown expense category: "${category}". ` +
      `Valid: ${Object.keys(CATEGORY_ACCOUNT).join(', ')}`);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Insert expense record
    const { rows: [exp] } = await client.query(`
      INSERT INTO expenses
        (category, description, amount, date, payment_status, payment_method, account_id)
      VALUES ($1,$2,$3,$4::date,$5,$6,(SELECT id FROM accounts WHERE code = $7))
      RETURNING id
    `, [
      category.toLowerCase(),
      description || '',
      expenseAmount,
      date || new Date().toISOString().slice(0, 10),
      paymentStatus,
      paymentMethod,
      expenseAccountCode
    ]);

    // Determine credit account
    const creditAccount = paymentStatus === 'paid'
      ? (METHOD_ACCOUNT[paymentMethod] || '1000')
      : '2100'; // Accrued Expenses for unpaid

    await postEntry({
      date:        date || new Date(),
      description: `Expense: ${category} — ${description || ''}`,
      refType:     'expense', refId: exp.id, postedBy: adminId,
      lines: [
        { accountCode: expenseAccountCode, debit: expenseAmount, credit: 0,             description: description || category },
        { accountCode: creditAccount,       debit: 0,             credit: expenseAmount, description: paymentStatus === 'paid' ? `${paymentMethod} payment` : 'Accrued' }
      ]
    }, client);

    await client.query('COMMIT');
    return { success: true, expenseId: exp.id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Void an expense — reverses journal entry, marks expense voided.
 */
async function voidExpense(expenseId, { reason, adminId }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT * FROM expenses WHERE id = $1 FOR UPDATE', [expenseId]
    );
    if (!rows.length) throw new Error('Expense not found.');
    if (rows[0].is_voided) throw new Error('Expense already voided.');

    const { rows: jes } = await client.query(
      "SELECT id FROM journal_entries WHERE ref_type = 'expense' AND ref_id = $1 AND is_voided = false",
      [expenseId]
    );
    for (const je of jes) {
      await voidEntry(je.id, { reason, voidedBy: adminId }, client);
    }

    await client.query(
      'UPDATE expenses SET is_voided = true, void_reason = $1 WHERE id = $2',
      [reason, expenseId]
    );

    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { postExpense, voidExpense, CATEGORY_ACCOUNT };
