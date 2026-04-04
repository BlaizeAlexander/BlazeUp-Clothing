// ============================================================
// purchaseService.js — Supplier purchase posting
//
// Flow on purchase RECEIPT:
//   1. Insert purchase + purchase_items
//   2. For each item: adjustStock (purchase, +qty, update WAC)
//   3. Journal: Dr Inventory (1200) / Cr AP (2000) [if unpaid]
//              or Dr Inventory / Cr Cash   [if cash purchase]
//   4. Auto-create payable if balance_due > 0
//
// Flow on supplier PAYMENT:
//   1. Validate amount ≤ balance_due
//   2. Insert supplier_payments record
//   3. Update purchase amount_paid, balance_due, payment_status
//   4. Update payable
//   5. Journal: Dr AP (2000) / Cr Cash/GCash
// ============================================================

const { postEntry, voidEntry } = require('./journalService');
const { adjustStock }          = require('./inventoryService');
const { getClient }            = require('../db');

const METHOD_ACCOUNT = { cash: '1000', gcash: '1010', bank: '1010', other: '1000' };

// ── upsertPayable ─────────────────────────────────────────────
async function upsertPayable(purchase, client) {
  if (purchase.balance_due <= 0) {
    await client.query(
      "UPDATE payables SET status = 'paid', amount_paid = original_amount, balance_due = 0 WHERE purchase_id = $1",
      [purchase.id]
    );
    return;
  }

  const { rows } = await client.query(
    'SELECT id FROM payables WHERE purchase_id = $1', [purchase.id]
  );

  if (rows.length) {
    await client.query(`
      UPDATE payables SET
        original_amount = $1,
        amount_paid     = $2,
        balance_due     = $3,
        status          = CASE WHEN $3 <= 0 THEN 'paid' ELSE 'unpaid' END
      WHERE purchase_id = $4
    `, [purchase.total, purchase.amount_paid, purchase.balance_due, purchase.id]);
  } else {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    await client.query(`
      INSERT INTO payables
        (purchase_id, supplier_name, description, amount, original_amount,
         amount_paid, balance_due, status, due_date, notes)
      VALUES ($1,$2,$3,$4,$4,$5,$6,'unpaid',$7,'Auto-created from purchase')
    `, [
      purchase.id,
      purchase.supplier_name,
      `Purchase from ${purchase.supplier_name}`,
      purchase.total,
      purchase.amount_paid,
      purchase.balance_due,
      dueDate.toISOString().slice(0, 10)
    ]);
  }
}

// ── receivePurchase ───────────────────────────────────────────
/**
 * Record a supplier purchase receipt — receives goods, updates inventory WAC,
 * posts journal entry, and creates payable if credit purchase.
 *
 * @param {object} data
 *   supplierName, supplierRef, date, items, amountPaid, method, notes
 *   items: [{ productId, variantId, name, qty, unitCost }]
 * @param {string} adminId
 */
async function receivePurchase(data, adminId) {
  const {
    supplierName, supplierRef, date,
    items, amountPaid: amtPaid, method, notes
  } = data;

  if (!items || !items.length) throw new Error('Purchase must have at least one item.');

  const amountPaid = parseFloat(amtPaid) || 0;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Compute totals
    const parsedItems = items.map(it => ({
      ...it,
      qty:       parseInt(it.qty, 10),
      unitCost:  parseFloat(it.unitCost),
      lineTotal: parseInt(it.qty, 10) * parseFloat(it.unitCost)
    }));
    const subtotal   = parsedItems.reduce((s, it) => s + it.lineTotal, 0);
    const total      = subtotal;
    const balanceDue = Math.max(0, total - amountPaid);
    const paymentStatus = balanceDue <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid';

    // Insert purchase header
    const { rows: [purchase] } = await client.query(`
      INSERT INTO purchases
        (supplier_name, supplier_ref, date, subtotal, total,
         amount_paid, balance_due, payment_status, status, notes, posted_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'received',$9,$10) RETURNING *
    `, [
      supplierName,
      supplierRef || '',
      date || new Date().toISOString().slice(0, 10),
      subtotal, total, amountPaid, balanceDue, paymentStatus,
      notes || '',
      adminId
    ]);

    // Insert items + adjust inventory
    for (const item of parsedItems) {
      await client.query(`
        INSERT INTO purchase_items
          (purchase_id, product_id, variant_id, name, qty, unit_cost, line_total)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [
        purchase.id,
        item.productId  || null,
        item.variantId  || null,
        item.name,
        item.qty, item.unitCost, item.lineTotal
      ]);

      if (item.variantId) {
        await adjustStock({
          variantId: item.variantId,
          type:      'purchase',
          qtyChange: item.qty,
          unitCost:  item.unitCost,
          refType:   'purchase',
          refId:     purchase.id,
          notes:     `Purchase from ${supplierName}`,
          createdBy: adminId
        }, client);
      }
    }

    // Journal entries
    const cashAccount = METHOD_ACCOUNT[method] || '1000';
    if (amountPaid > 0 && balanceDue <= 0) {
      // Full cash purchase: Dr Inventory / Cr Cash
      await postEntry({
        date:        date || new Date(),
        description: `Purchase — ${supplierName}`,
        refType:     'purchase', refId: purchase.id, postedBy: adminId,
        lines: [
          { accountCode: '1200', debit: total, credit: 0,     description: 'Inventory received' },
          { accountCode: cashAccount, debit: 0, credit: total, description: `Cash paid to ${supplierName}` }
        ]
      }, client);
    } else if (amountPaid > 0 && balanceDue > 0) {
      // Partial cash: Dr Inventory / Cr Cash + Cr AP
      await postEntry({
        date:        date || new Date(),
        description: `Purchase (partial payment) — ${supplierName}`,
        refType:     'purchase', refId: purchase.id, postedBy: adminId,
        lines: [
          { accountCode: '1200',       debit: total,       credit: 0,           description: 'Inventory received' },
          { accountCode: cashAccount,  debit: 0,           credit: amountPaid,  description: `Cash paid` },
          { accountCode: '2000',       debit: 0,           credit: balanceDue,  description: `AP: ${supplierName}` }
        ]
      }, client);
    } else {
      // Full credit: Dr Inventory / Cr AP
      await postEntry({
        date:        date || new Date(),
        description: `Purchase on credit — ${supplierName}`,
        refType:     'purchase', refId: purchase.id, postedBy: adminId,
        lines: [
          { accountCode: '1200', debit: total, credit: 0,     description: 'Inventory received' },
          { accountCode: '2000', debit: 0,     credit: total, description: `AP: ${supplierName}` }
        ]
      }, client);
    }

    // Auto-create payable if unpaid balance exists
    if (balanceDue > 0) {
      await upsertPayable(
        { id: purchase.id, supplier_name: supplierName, total, amount_paid: amountPaid, balance_due: balanceDue },
        client
      );
    }

    // If there was an upfront cash payment, record it in supplier_payments
    if (amountPaid > 0) {
      await client.query(`
        INSERT INTO supplier_payments
          (purchase_id, date, amount, method, notes, posted_by)
        VALUES ($1,$2,$3,$4,'Paid on receipt',$5)
      `, [purchase.id, date || new Date().toISOString().slice(0, 10), amountPaid, method || 'cash', adminId]);
    }

    await client.query('COMMIT');
    return { success: true, purchaseId: purchase.id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── postSupplierPayment ───────────────────────────────────────
async function postSupplierPayment(data, adminId) {
  const { purchaseId, date, amount, method, referenceNumber, notes } = data;
  const pmtAmount = parseFloat(amount);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT * FROM purchases WHERE id = $1 FOR UPDATE', [purchaseId]
    );
    if (!rows.length) throw new Error('Purchase not found.');
    const purchase = rows[0];
    if (purchase.is_voided) throw new Error('Purchase is voided.');

    const currentBalance = parseFloat(purchase.balance_due);
    if (pmtAmount > currentBalance + 0.005) {
      throw new Error(`Payment (${pmtAmount}) exceeds balance due (${currentBalance.toFixed(2)}).`);
    }

    // Insert supplier payment
    const { rows: [sp] } = await client.query(`
      INSERT INTO supplier_payments
        (purchase_id, date, amount, method, reference_number, notes, posted_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
    `, [
      purchaseId,
      date || new Date().toISOString().slice(0, 10),
      pmtAmount, method || 'cash',
      referenceNumber || '', notes || '', adminId
    ]);

    // Update purchase
    const newAmountPaid = parseFloat(purchase.amount_paid) + pmtAmount;
    const newBalanceDue = Math.max(0, parseFloat(purchase.total) - newAmountPaid);
    const paymentStatus = newBalanceDue <= 0 ? 'paid' : newAmountPaid > 0 ? 'partial' : 'unpaid';

    await client.query(`
      UPDATE purchases SET amount_paid = $1, balance_due = $2, payment_status = $3 WHERE id = $4
    `, [newAmountPaid, newBalanceDue, paymentStatus, purchaseId]);

    // Update payable
    await upsertPayable(
      { id: purchaseId, supplier_name: purchase.supplier_name, total: purchase.total, amount_paid: newAmountPaid, balance_due: newBalanceDue },
      client
    );

    // Journal: Dr AP / Cr Cash
    const cashAccount = METHOD_ACCOUNT[method] || '1000';
    await postEntry({
      date:        date || new Date(),
      description: `Supplier payment — ${purchase.supplier_name}`,
      refType:     'supplier_payment', refId: sp.id, postedBy: adminId,
      lines: [
        { accountCode: '2000',       debit: pmtAmount, credit: 0,          description: `AP: ${purchase.supplier_name}` },
        { accountCode: cashAccount,  debit: 0,         credit: pmtAmount,  description: `${method} payment` }
      ]
    }, client);

    await client.query('COMMIT');
    return { success: true, supplierPaymentId: sp.id, newBalanceDue, paymentStatus };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { receivePurchase, postSupplierPayment, upsertPayable };
