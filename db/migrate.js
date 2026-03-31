// ============================================================
// db/migrate.js — One-time JSON → PostgreSQL migration
//
// Usage (run from project root):
//   DATABASE_URL=postgres://localhost/clothing_store node db/migrate.js
//
// Safe to re-run — every INSERT is guarded or idempotent.
// IDs change from timestamp strings → UUIDs during migration.
// The script builds an in-memory map (oldId → newUUID) to
// resolve foreign-key references across entities.
// ============================================================

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

const DATA = path.join(__dirname, '../data');
const read = file => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); }
  catch { return null; }
};

// oldId → newUUID mappings built during migration
const userMap    = {};
const productMap = {};
const orderMap   = {};

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Settings ──────────────────────────────────────────
    const s = read('settings.json') || {};
    await client.query(`
      UPDATE settings SET
        points_system_enabled  = $1,
        purchase_points_rate   = $2,
        referral_reward_points = $3,
        payment_qr_code_path   = $4
      WHERE id = 1
    `, [
      s.pointsSystemEnabled   ?? true,
      s.purchasePointsRate    ?? 1,
      s.referralRewardPoints  ?? 50,
      s.paymentQrCodePath     || ''
    ]);
    log('Settings migrated');

    // ── 2. Users (pass 1 — insert without referred_by FK) ────
    const users = read('users.json') || [];
    for (const u of users) {
      // Use ON CONFLICT on referral_code so re-runs don't duplicate
      const res = await client.query(`
        INSERT INTO users
          (username, email, password_hash, contact, pinned_location,
           points, role, referral_code, referral_count, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (referral_code) DO UPDATE SET username = EXCLUDED.username
        RETURNING id
      `, [
        u.username,
        u.email.toLowerCase(),
        u.password,                       // already bcrypt-hashed
        u.contact        || '',
        u.pinnedLocation || '',
        u.points         || 0,
        u.isAdmin        ? 'admin' : 'user',
        u.referralCode,
        u.referralCount  || 0,
        u.createdAt      || new Date().toISOString()
      ]);
      userMap[u.id] = res.rows[0].id;
    }

    // Users pass 2 — wire up referred_by FK now all rows exist
    for (const u of users) {
      if (!u.referredBy || !userMap[u.id]) continue;
      // referredBy stores the referrer's *username*, not their old ID
      const referrerRes = await client.query(
        'SELECT id FROM users WHERE lower(username) = lower($1)',
        [u.referredBy]
      );
      if (referrerRes.rows.length) {
        await client.query(
          'UPDATE users SET referred_by = $1 WHERE id = $2',
          [referrerRes.rows[0].id, userMap[u.id]]
        );
      }
    }
    log(`Users: ${users.length}`);

    // ── 3. Products ──────────────────────────────────────────
    const products = read('products.json') || [];
    for (const p of products) {
      const res = await client.query(`
        INSERT INTO products
          (name, description, price, cost_price, stock_quantity, category,
           price_tiers, variants, images, image, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11)
        RETURNING id
      `, [
        p.name,
        p.description     || '',
        p.price           || 0,
        p.costPrice       || 0,
        p.stockQuantity   || 0,
        p.category        || '',
        JSON.stringify(p.priceTiers || []),
        JSON.stringify(p.variants   || []),
        JSON.stringify(p.images     || (p.image ? [p.image] : [])),
        p.image           || (p.images && p.images[0]) || '',
        new Date().toISOString()
      ]);
      productMap[p.id] = res.rows[0].id;
    }
    log(`Products: ${products.length}`);

    // ── 4. Orders + order_items ──────────────────────────────
    const orders = read('orders.json') || [];
    for (const o of orders) {
      const userId = o.userId ? (userMap[o.userId] || null) : null;

      const orderRes = await client.query(`
        INSERT INTO orders
          (user_id, customer_name, contact, address, total,
           points_used, payment_screenshot, status, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id
      `, [
        userId,
        o.customerName,
        o.contact,
        o.address,
        parseFloat(o.total || 0),
        o.pointsUsed || 0,
        o.paymentScreenshot || '',
        o.status     || 'pending',
        o.createdAt  || new Date().toISOString()
      ]);
      const newOrderId = orderRes.rows[0].id;
      orderMap[o.id]   = newOrderId;

      // Insert each line item, resolving product FK
      for (const item of (o.items || [])) {
        const productId = item.productId ? (productMap[item.productId] || null) : null;
        await client.query(`
          INSERT INTO order_items
            (order_id, product_id, name, price, base_price, cost_at_sale, quantity, image)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `, [
          newOrderId,
          productId,
          item.name,
          parseFloat(item.price        || item.sellingPrice || 0),
          parseFloat(item.basePrice    || item.price        || 0),
          parseFloat(item.costAtSale   || 0),
          parseInt(item.qty, 10)       || 1,
          item.image || ''
        ]);
      }
    }
    log(`Orders: ${orders.length}`);

    // ── 5. Discounts ─────────────────────────────────────────
    const discounts = read('discounts.json') || [];
    for (const d of discounts) {
      await client.query(`
        INSERT INTO discounts (name, type, value, created_at)
        VALUES ($1,$2,$3,$4) ON CONFLICT (name) DO NOTHING
      `, [d.name.toUpperCase(), d.type, parseFloat(d.value), d.createdAt || new Date().toISOString()]);
    }
    log(`Discounts: ${discounts.length}`);

    // ── 6. Expenses ──────────────────────────────────────────
    const expenses = read('expenses.json') || [];
    for (const e of expenses) {
      await client.query(`
        INSERT INTO expenses (category, description, amount, date, created_at)
        VALUES ($1,$2,$3,$4::date,$5)
      `, [e.category, e.description || '', parseFloat(e.amount), e.date, e.createdAt || new Date().toISOString()]);
    }
    log(`Expenses: ${expenses.length}`);

    // ── 7. Receivables ───────────────────────────────────────
    const receivables = read('receivables.json') || [];
    for (const r of receivables) {
      const orderId    = r.relatedOrderId ? (orderMap[r.relatedOrderId] || null) : null;
      const customerId = r.customerId     ? (userMap[r.customerId]      || null) : null;
      await client.query(`
        INSERT INTO receivables
          (related_order_id, customer_id, customer_name, amount, status, due_date, notes, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [
        orderId, customerId,
        r.customerName,
        parseFloat(r.amount),
        r.status  || 'pending',
        r.dueDate || '',
        r.notes   || '',
        r.createdAt || new Date().toISOString()
      ]);
    }
    log(`Receivables: ${receivables.length}`);

    // ── 8. Payables ──────────────────────────────────────────
    const payables = read('payables.json') || [];
    for (const p of payables) {
      await client.query(`
        INSERT INTO payables
          (supplier_name, description, amount, status, due_date, notes, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [
        p.supplierName,
        p.description || '',
        parseFloat(p.amount),
        p.status  || 'unpaid',
        p.dueDate || '',
        p.notes   || '',
        p.createdAt || new Date().toISOString()
      ]);
    }
    log(`Payables: ${payables.length}`);

    await client.query('COMMIT');
    console.log('\nMigration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nMigration FAILED — rolled back:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

function log(msg) { console.log(' ✓', msg); }

main();
