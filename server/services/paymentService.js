// ============================================================
// paymentService.js — Customer payment posting
//
// Flow on payment:
//   1. Validate: amount ≤ balance_due
//   2. Insert payments record
//   3. Update order amount_paid, balance_due, payment_status
//   4. Update receivable
//   5. Journal: Dr Cash/GCash (1000/1010) / Cr AR (1100)
// ============================================================

const { postEntry, voidEntry } = require('./journalService');
const { upsertReceivable }     = require('./orderService');
const { getClient }            = require('../db');

const METHOD_ACCOUNT = {
  cash:  '1000',
  gcash: '1010',
  bank:  '1010',
  other: '1000'
};

/**
 * Post a customer payment against an order.
 * @param {object} data - { orderId, date, amount, method, referenceNumber, screenshotUrl, notes }
 * @param {string} adminId
 */
async function postPayment(data, adminId) {
  const { orderId, date, amount, method, referenceNumber, screenshotUrl, notes } = data;
  const pmtAmount = parseFloat(amount);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock order
    const { rows } = await client.query(
      'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]
    );
    if (!rows.length) throw new Error('Order not found.');
    const order = rows[0];
    if (order.is_voided) throw new Error('Order is voided — cannot post payment.');

    // Must be at least confirmed to accept payment
    if (!order.posted_at) throw new Error('Confirm the order before recording payment.');

    const currentBalance = parseFloat(order.balance_due);
    if (pmtAmount > currentBalance + 0.005) {
      throw new Error(
        `Payment (${pmtAmount}) exceeds balance due (${currentBalance.toFixed(2)}).`
      );
    }

    // Insert payment record
    const { rows: [pmt] } = await client.query(`
      INSERT INTO payments
        (order_id, date, amount, method, reference_number, screenshot_url, notes, posted_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
    `, [
      orderId,
      date || new Date().toISOString().slice(0, 10),
      pmtAmount,
      method || 'gcash',
      referenceNumber || '',
      screenshotUrl   || '',
      notes           || '',
      adminId
    ]);

    // Update order
    const newAmountPaid  = parseFloat(order.amount_paid) + pmtAmount;
    const newBalanceDue  = Math.max(0, parseFloat(order.total) - newAmountPaid);
    const paymentStatus  = newBalanceDue <= 0 ? 'paid'
                         : newAmountPaid > 0   ? 'partial'
                         : 'unpaid';

    await client.query(`
      UPDATE orders SET
        amount_paid    = $1,
        balance_due    = $2,
        payment_status = $3
      WHERE id = $4
    `, [newAmountPaid, newBalanceDue, paymentStatus, orderId]);

    // Update receivable
    await upsertReceivable(
      { ...order, amount_paid: newAmountPaid, balance_due: newBalanceDue },
      client
    );

    // Journal: Dr Cash/GCash / Cr AR
    const cashAccount = METHOD_ACCOUNT[method] || '1000';
    await postEntry({
      date:        date || new Date(),
      description: `Payment received — Order #${orderId.slice(-8).toUpperCase()} (${method})`,
      refType:     'payment',
      refId:       pmt.id,
      postedBy:    adminId,
      lines: [
        { accountCode: cashAccount, debit: pmtAmount,  credit: 0,          description: `${method} receipt` },
        { accountCode: '1100',      debit: 0,           credit: pmtAmount,  description: `AR: ${order.customer_name}` }
      ]
    }, client);

    await client.query('COMMIT');
    return { success: true, paymentId: pmt.id, newBalanceDue, paymentStatus };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Void a payment: reverse journal entry, restore balance_due.
 */
async function voidPayment(paymentId, { reason, adminId }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]
    );
    if (!rows.length) throw new Error('Payment not found.');
    const pmt = rows[0];
    if (pmt.is_voided) throw new Error('Payment already voided.');

    // Void journal entries for this payment
    const { rows: jes } = await client.query(
      "SELECT id FROM journal_entries WHERE ref_type = 'payment' AND ref_id = $1 AND is_voided = false",
      [paymentId]
    );
    for (const je of jes) {
      await voidEntry(je.id, { reason, voidedBy: adminId }, client);
    }

    // Mark payment voided
    await client.query(
      'UPDATE payments SET is_voided = true, void_reason = $1 WHERE id = $2',
      [reason, paymentId]
    );

    // Restore order balance
    const { rows: [order] } = await client.query(
      'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [pmt.order_id]
    );
    const newAmountPaid = Math.max(0, parseFloat(order.amount_paid) - parseFloat(pmt.amount));
    const newBalanceDue = Math.max(0, parseFloat(order.total) - newAmountPaid);
    const paymentStatus = newBalanceDue <= 0 ? 'paid' : newAmountPaid > 0 ? 'partial' : 'unpaid';

    await client.query(`
      UPDATE orders SET amount_paid = $1, balance_due = $2, payment_status = $3 WHERE id = $4
    `, [newAmountPaid, newBalanceDue, paymentStatus, order.id]);

    await upsertReceivable(
      { ...order, amount_paid: newAmountPaid, balance_due: newBalanceDue },
      client
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

module.exports = { postPayment, voidPayment };
