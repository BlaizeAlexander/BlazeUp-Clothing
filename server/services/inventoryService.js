// ============================================================
// inventoryService.js — Weighted Average Cost inventory engine
//
// WAC formula on each purchase receipt:
//   new_wac = (old_qty × old_wac + qty_in × unit_cost)
//             / (old_qty + qty_in)
//
// COGS on each sale = qty_sold × wac_at_time_of_sale
// ============================================================

/**
 * Adjust stock for a variant and log the movement.
 * Must be called inside the caller's pg transaction (client).
 *
 * @param {object} params
 *   variantId   - product_variants.id
 *   type        - 'purchase'|'sale'|'return_in'|'return_out'|'adjustment'|'damage'
 *   qtyChange   - signed integer (positive = in, negative = out)
 *   unitCost    - cost per unit (for purchases/returns; for sales pass 0 — WAC used)
 *   refType     - 'purchase'|'order'|'manual'|...
 *   refId       - UUID of source record
 *   notes       - free text
 *   createdBy   - users.id
 * @returns { cogsAmount, newQty, newWac }
 */
async function adjustStock(
  { variantId, type, qtyChange, unitCost, refType, refId, notes, createdBy },
  client
) {
  // Lock the variant row for the duration of this transaction
  const { rows } = await client.query(
    'SELECT stock_qty, weighted_avg_cost FROM product_variants WHERE id = $1 FOR UPDATE',
    [variantId]
  );
  if (!rows.length) throw new Error(`Variant ${variantId} not found.`);

  const { stock_qty: oldQty, weighted_avg_cost: oldWac } = rows[0];
  const oldQtyNum  = parseInt(oldQty, 10);
  const oldWacNum  = parseFloat(oldWac);

  let newQty = oldQtyNum + qtyChange;
  let newWac = oldWacNum;
  let effectiveUnitCost = parseFloat(unitCost) || 0;
  let cogsAmount = 0;

  if (qtyChange > 0) {
    // Receiving inventory — update WAC
    if (effectiveUnitCost > 0) {
      const totalOldValue = oldQtyNum  * oldWacNum;
      const totalNewValue = qtyChange  * effectiveUnitCost;
      newWac = (oldQtyNum + qtyChange) > 0
        ? (totalOldValue + totalNewValue) / (oldQtyNum + qtyChange)
        : effectiveUnitCost;
    }
    effectiveUnitCost = effectiveUnitCost || oldWacNum;
  } else {
    // Removing inventory — use current WAC as cost
    effectiveUnitCost = oldWacNum;
    cogsAmount = Math.abs(qtyChange) * oldWacNum;
    // WAC does not change on issue
  }

  const totalCost = Math.abs(qtyChange) * effectiveUnitCost;

  // Update variant stock and WAC
  await client.query(`
    UPDATE product_variants
    SET stock_qty         = $1,
        weighted_avg_cost = $2
    WHERE id = $3
  `, [newQty, newWac, variantId]);

  // Log movement
  await client.query(`
    INSERT INTO inventory_movements
      (variant_id, type, qty_change, unit_cost, total_cost, qty_after, ref_type, ref_id, notes, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  `, [
    variantId,
    type,
    qtyChange,
    effectiveUnitCost,
    totalCost,
    newQty,
    refType  || null,
    refId    || null,
    notes    || '',
    createdBy || null
  ]);

  return { cogsAmount, newQty, newWac };
}

/**
 * Get current inventory valuation for all active variants.
 * Returns { totalValue, items }
 */
async function getInventoryValuation(client) {
  const fn = client
    ? (sql, p) => client.query(sql, p)
    : require('../db').query;

  const { rows } = await fn(`
    SELECT
      p.id   AS product_id,
      p.name AS product_name,
      pv.id  AS variant_id,
      pv.sku,
      pv.size,
      pv.color,
      pv.stock_qty,
      pv.reorder_level,
      pv.weighted_avg_cost,
      pv.selling_price,
      (pv.stock_qty * pv.weighted_avg_cost) AS inventory_value,
      CASE WHEN pv.stock_qty <= pv.reorder_level THEN true ELSE false END AS is_low_stock
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.is_active = true
    ORDER BY p.name, pv.size, pv.color
  `);

  const totalValue = rows.reduce((sum, r) => sum + parseFloat(r.inventory_value || 0), 0);
  return { totalValue, items: rows };
}

/**
 * Get movement history for a variant (or all variants if variantId omitted).
 */
async function getMovements({ variantId, limit = 100 } = {}) {
  const { query } = require('../db');
  const params = [];
  let where = '';
  if (variantId) { params.push(variantId); where = 'WHERE im.variant_id = $1'; }

  const { rows } = await query(`
    SELECT
      im.*,
      pv.size, pv.color, pv.sku,
      p.name AS product_name
    FROM inventory_movements im
    JOIN product_variants pv ON pv.id = im.variant_id
    JOIN products p ON p.id = pv.product_id
    ${where}
    ORDER BY im.created_at DESC
    LIMIT ${parseInt(limit, 10)}
  `, params);

  return rows;
}

module.exports = { adjustStock, getInventoryValuation, getMovements };
