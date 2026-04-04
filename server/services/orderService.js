// ============================================================
// orderService.js — Order posting, confirmation, and voiding
//
// Posting flow on order CONFIRMATION:
//   1. Compute COGS per item (WAC at time of sale)
//   2. Deduct inventory via inventoryService
//   3. Journal: Dr AR / Cr Sales Revenue + Cr Sales Discounts (contra)
//   4. Journal: Dr COGS / Cr Inventory
//   5. Upsert receivable (if balance_due > 0)
//
// Posting flow on PAYMENT (handled in paymentService):
//   6. Journal: Dr Cash/GCash / Cr AR
//   7. Update order amount_paid, balance_due, payment_status
//   8. Update receivable
// ============================================================

const { postEntry, voidEntry } = require('./journalService');
const { adjustStock }          = require('./inventoryService');
const { query: poolQuery, getClient } = require('../db');

// ── Helpers ───────────────────────────────────────────────────

async function upsertReceivable(order, client) {
  if (order.balance_due <= 0) {
    // Fully paid — mark any existing receivable as paid
    await client.query(`
      UPDATE receivables
      SET status = 'paid', amount_paid = original_amount, balance_due = 0
      WHERE order_id = $1
    `, [order.id]);
    return;
  }

  const { rows } = await client.query(
    'SELECT id FROM receivables WHERE order_id = $1', [order.id]
  );

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const dueDateStr = dueDate.toISOString().slice(0, 10);

  if (rows.length) {
    await client.query(`
      UPDATE receivables SET
        original_amount = $1,
        amount_paid     = $2,
        balance_due     = $3,
        status          = CASE
          WHEN $3 <= 0 THEN 'paid'
          WHEN due_date <> '' AND due_date < CURRENT_DATE::text THEN 'overdue'
          ELSE 'current' END
      WHERE order_id = $4
    `, [order.total, order.amount_paid, order.balance_due, order.id]);
  } else {
    await client.query(`
      INSERT INTO receivables
        (order_id, customer_id, customer_name, amount, original_amount,
         amount_paid, balance_due, status, due_date, notes)
      VALUES ($1,$2,$3,$4,$4,$5,$6,'current',$7,'Auto-created on order confirmation')
    `, [
      order.id,
      order.user_id || null,
      order.customer_name,
      order.total,
      order.amount_paid,
      order.balance_due,
      dueDateStr
    ]);
  }
}

// ── confirmOrder ──────────────────────────────────────────────
/**
 * Confirm an order: recognize revenue + COGS, deduct inventory,
 * upsert receivable. Runs inside its own transaction.
 *
 * @param orderId   - orders.id
 * @param adminId   - users.id of the admin performing the action
 * @param options   - { discountAmount, shippingFee, notes }
 */
async function confirmOrder(orderId, adminId, options = {}) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock and fetch order
    const { rows: orderRows } = await client.query(
      'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]
    );
    if (!orderRows.length) throw new Error('Order not found.');
    const order = orderRows[0];

    if (order.is_voided)           throw new Error('Order is voided.');
    if (order.status === 'cancelled') throw new Error('Order is cancelled.');
    if (order.posted_at)           throw new Error('Order already confirmed/posted.');

    // Fetch items
    const { rows: items } = await client.query(
      'SELECT * FROM order_items WHERE order_id = $1', [orderId]
    );

    // ── Compute subtotal from items if not already set ────────
    const subtotal = items.reduce(
      (s, it) => s + parseFloat(it.price) * it.quantity, 0
    );
    const discountAmount = parseFloat(options.discountAmount ?? order.discount_amount ?? 0);
    const shippingFee    = parseFloat(order.shipping_fee ?? 0);
    const total          = subtotal - discountAmount + shippingFee;

    // ── Deduct inventory + collect COGS per item ──────────────
    let totalCogs = 0;
    for (const item of items) {
      if (!item.variant_id) {
        // No variant linked — use snapshotted cost_at_sale
        const lineCogs = parseFloat(item.cost_at_sale) * item.quantity;
        totalCogs += lineCogs;
        await client.query(
          'UPDATE order_items SET line_cogs = $1, line_total = $2 WHERE id = $3',
          [lineCogs, parseFloat(item.price) * item.quantity, item.id]
        );
        continue;
      }

      const { cogsAmount } = await adjustStock({
        variantId:  item.variant_id,
        type:       'sale',
        qtyChange:  -item.quantity,
        unitCost:   0,            // inventoryService uses WAC
        refType:    'order',
        refId:      orderId,
        notes:      `Sale: order ${orderId}`,
        createdBy:  adminId
      }, client);

      const unitCogs = item.quantity > 0 ? cogsAmount / item.quantity : 0;
      const lineTotal = parseFloat(item.price) * item.quantity;
      await client.query(`
        UPDATE order_items SET
          cost_at_sale = $1,
          line_cogs    = $2,
          line_total   = $3
        WHERE id = $4
      `, [unitCogs, cogsAmount, lineTotal, item.id]);

      totalCogs += cogsAmount;
    }

    // ── Update order totals ───────────────────────────────────
    const balanceDue = Math.max(0, total - parseFloat(order.amount_paid));
    await client.query(`
      UPDATE orders SET
        subtotal        = $1,
        discount_amount = $2,
        total           = $3,
        balance_due     = $4,
        payment_status  = CASE WHEN $4 <= 0 THEN 'paid' WHEN $5 > 0 THEN 'partial' ELSE 'unpaid' END,
        status          = 'confirmed',
        posted_at       = NOW()
      WHERE id = $6
    `, [subtotal, discountAmount, total, balanceDue, parseFloat(order.amount_paid), orderId]);

    // ── Journal Entry 1: Revenue recognition ─────────────────
    // Dr Accounts Receivable (1100)          = total
    // Cr Sales Revenue      (4000)           = subtotal + shippingFee
    // Dr Sales Discounts    (4010) [contra]  = discountAmount
    const revenueLines = [
      { accountCode: '1100', debit: total,          credit: 0,              description: `AR: ${order.customer_name}` },
      { accountCode: '4000', debit: 0,              credit: subtotal + shippingFee, description: 'Gross Sales' },
    ];
    if (discountAmount > 0) {
      revenueLines.push(
        { accountCode: '4010', debit: discountAmount, credit: 0, description: 'Sales Discount' }
      );
    }
    await postEntry({
      date:        new Date(),
      description: `Sale confirmed — Order #${orderId.slice(-8).toUpperCase()}`,
      refType:     'order',
      refId:       orderId,
      postedBy:    adminId,
      lines:       revenueLines
    }, client);

    // ── Journal Entry 2: COGS ─────────────────────────────────
    if (totalCogs > 0) {
      await postEntry({
        date:        new Date(),
        description: `COGS — Order #${orderId.slice(-8).toUpperCase()}`,
        refType:     'order',
        refId:       orderId,
        postedBy:    adminId,
        lines: [
          { accountCode: '5000', debit: totalCogs, credit: 0,         description: 'COGS recognized' },
          { accountCode: '1200', debit: 0,         credit: totalCogs, description: 'Inventory reduction' }
        ]
      }, client);
    }

    // ── Upsert Receivable ─────────────────────────────────────
    const updatedOrder = {
      id:            orderId,
      user_id:       order.user_id,
      customer_name: order.customer_name,
      total,
      amount_paid:   parseFloat(order.amount_paid),
      balance_due:   balanceDue
    };
    await upsertReceivable(updatedOrder, client);

    // ── Award loyalty points ──────────────────────────────────
    if (order.user_id) {
      const { rows: settingsRows } = await client.query('SELECT * FROM settings WHERE id = 1');
      const s = settingsRows[0];
      if (s && s.points_system_enabled) {
        const earned = Math.floor(total / 100 * parseFloat(s.purchase_points_rate));
        if (earned > 0) {
          await client.query(
            'UPDATE users SET points = points + $1 WHERE id = $2', [earned, order.user_id]
          );
        }
      }
    }

    await client.query('COMMIT');
    return { success: true, totalCogs, balanceDue };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── voidOrder ─────────────────────────────────────────────────
/**
 * Void a confirmed order: reverse all journal entries, restore inventory.
 */
async function voidOrder(orderId, { reason, adminId }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]
    );
    if (!rows.length) throw new Error('Order not found.');
    const order = rows[0];
    if (order.is_voided) throw new Error('Order is already voided.');

    // Void all journal entries for this order
    const { rows: jes } = await client.query(
      "SELECT id FROM journal_entries WHERE ref_type = 'order' AND ref_id = $1 AND is_voided = false",
      [orderId]
    );
    for (const je of jes) {
      await voidEntry(je.id, { reason, voidedBy: adminId }, client);
    }

    // Restore inventory for variants that were deducted
    const { rows: items } = await client.query(
      'SELECT * FROM order_items WHERE order_id = $1', [orderId]
    );
    for (const item of items) {
      if (!item.variant_id) continue;
      await adjustStock({
        variantId: item.variant_id,
        type:      'return_in',
        qtyChange: item.quantity,
        unitCost:  item.cost_at_sale,
        refType:   'order_void',
        refId:     orderId,
        notes:     `Void: order ${orderId}`,
        createdBy: adminId
      }, client);
    }

    // Mark order voided
    await client.query(`
      UPDATE orders SET is_voided = true, void_reason = $1, status = 'cancelled' WHERE id = $2
    `, [reason, orderId]);

    // Mark receivable paid/closed
    await client.query(
      "UPDATE receivables SET status = 'paid', balance_due = 0 WHERE order_id = $1",
      [orderId]
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

module.exports = { confirmOrder, voidOrder, upsertReceivable };
