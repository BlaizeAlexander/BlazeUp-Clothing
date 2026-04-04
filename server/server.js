// ============================================================
// server.js — BlazeUp Clothing Store
// Refactored: PostgreSQL + JWT auth + production security
// ============================================================

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express      = require('express');
const path         = require('path');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security headers (helmet) ────────────────────────────────
// Helmet sets ~15 protective HTTP headers in one call.
// We relax CSP slightly because the existing frontend uses inline
// <script> and <style> blocks that we cannot change right now.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:', 'https://*.supabase.co']
    }
  }
}));

app.set('trust proxy', 1); // required when behind Render's reverse proxy

// ── Rate limiting ────────────────────────────────────────────
// Global: 200 req / 15 min per IP (generous for a shop)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});

// Auth endpoints: 10 attempts / 15 min — slows brute-force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
});

app.use(globalLimiter);

// ── Core middleware ──────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// ── Routes ──────────────────────────────────────────────────
const authRoutes          = require('./routes/auth');
const productRoutes       = require('./routes/products');
const orderRoutes         = require('./routes/orders');
const discountRoutes      = require('./routes/discounts');
const financeRoutes       = require('./routes/finance');
const settingsRoutes      = require('./routes/settings');
const profileRoutes       = require('./routes/profile');
// ── v2 accounting modules ────────────────────────────────────
const paymentRoutes       = require('./routes/payments');
const purchaseRoutes      = require('./routes/purchases');
const inventoryRoutes     = require('./routes/inventory');
const reportRoutes        = require('./routes/reports');

// Tight rate limit only on login and register — not /me or /logout
app.use('/api/login', authLimiter);
app.use('/api/register', authLimiter);
app.use('/api', authRoutes);
app.use('/api', productRoutes);
app.use('/api', orderRoutes);
app.use('/api', discountRoutes);
app.use('/api', financeRoutes);
app.use('/api', settingsRoutes);
app.use('/api', profileRoutes);
// ── v2 accounting routes ─────────────────────────────────────
app.use('/api', paymentRoutes);
app.use('/api', purchaseRoutes);
app.use('/api', inventoryRoutes);
app.use('/api', reportRoutes);

// ── Global error handler ─────────────────────────────────────
// Catches any error passed via next(err).
// Never leaks stack traces to the client in production.
app.use((err, req, res, next) => {
  const isDev = process.env.NODE_ENV === 'development';
  console.error('[Error]', err.message, isDev ? err.stack : '');
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: isDev ? err.message : 'An internal error occurred.'
  });
});

// ── Startup migrations ───────────────────────────────────────
// Safe to re-run on every deploy — IF NOT EXISTS guards each step.
async function runMigrations() {
  const { query } = require('./db');
  // ── v1 migrations ────────────────────────────────────────────
  await query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT ''`);
  await query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS facebook_url  TEXT NOT NULL DEFAULT ''`);
  await query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS instagram_url TEXT NOT NULL DEFAULT ''`);
  await query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS telegram_url  TEXT NOT NULL DEFAULT ''`);
  // ── v2 accounting migrations ──────────────────────────────────
  // Create new tables if they don't exist yet (safe to re-run)
  await query(`CREATE TABLE IF NOT EXISTS accounts (
    id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    code           TEXT    NOT NULL UNIQUE,
    name           TEXT    NOT NULL,
    type           TEXT    NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
    normal_balance TEXT    NOT NULL CHECK (normal_balance IN ('debit','credit')),
    is_system      BOOLEAN NOT NULL DEFAULT false,
    parent_code    TEXT,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`INSERT INTO accounts (code, name, type, normal_balance, is_system) VALUES
    ('1000','Cash on Hand',           'asset',     'debit',  true),
    ('1010','GCash / Bank',           'asset',     'debit',  true),
    ('1100','Accounts Receivable',    'asset',     'debit',  true),
    ('1200','Merchandise Inventory',  'asset',     'debit',  true),
    ('2000','Accounts Payable',       'liability', 'credit', true),
    ('2100','Accrued Expenses',       'liability', 'credit', true),
    ('3000','Owner''s Capital',       'equity',    'credit', true),
    ('3100','Owner''s Drawings',      'equity',    'debit',  true),
    ('4000','Sales Revenue',          'revenue',   'credit', true),
    ('4010','Sales Discounts',        'revenue',   'debit',  true),
    ('4020','Sales Returns',          'revenue',   'debit',  true),
    ('5000','Cost of Goods Sold',     'expense',   'debit',  true),
    ('6000','Rent Expense',           'expense',   'debit',  true),
    ('6010','Packaging Expense',      'expense',   'debit',  true),
    ('6020','Delivery Expense',       'expense',   'debit',  true),
    ('6030','Advertising & Marketing','expense',   'debit',  true),
    ('6040','Utilities Expense',      'expense',   'debit',  true),
    ('6050','Salaries Expense',       'expense',   'debit',  true),
    ('6090','Miscellaneous Expense',  'expense',   'debit',  true)
  ON CONFLICT (code) DO NOTHING`);
  await query(`CREATE TABLE IF NOT EXISTS journal_entries (
    id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    date        DATE    NOT NULL DEFAULT CURRENT_DATE,
    description TEXT    NOT NULL,
    ref_type    TEXT,
    ref_id      UUID,
    posted_by   UUID    REFERENCES users(id) ON DELETE SET NULL,
    is_voided   BOOLEAN NOT NULL DEFAULT false,
    void_reason TEXT,
    voided_at   TIMESTAMPTZ,
    voided_by   UUID    REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID          NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id       UUID          NOT NULL REFERENCES accounts(id),
    debit            NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
    credit           NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    description      TEXT          NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS product_variants (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id        UUID          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku               TEXT          NOT NULL DEFAULT '',
    size              TEXT          NOT NULL DEFAULT '',
    color             TEXT          NOT NULL DEFAULT '',
    selling_price     NUMERIC(12,2) NOT NULL,
    cost_price        NUMERIC(12,2) NOT NULL DEFAULT 0,
    weighted_avg_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
    stock_qty         INTEGER       NOT NULL DEFAULT 0,
    reorder_level     INTEGER       NOT NULL DEFAULT 5,
    is_active         BOOLEAN       NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
  )`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_paid     NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS balance_due     NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status  TEXT          NOT NULL DEFAULT 'unpaid'`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes           TEXT          NOT NULL DEFAULT ''`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_voided       BOOLEAN       NOT NULL DEFAULT false`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS void_reason     TEXT`);
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS posted_at       TIMESTAMPTZ`);
  await query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id      UUID`);
  await query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS line_total      NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS line_cogs       NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE expenses    ADD COLUMN IF NOT EXISTS payment_status  TEXT NOT NULL DEFAULT 'paid'`);
  await query(`ALTER TABLE expenses    ADD COLUMN IF NOT EXISTS payment_method  TEXT NOT NULL DEFAULT 'cash'`);
  await query(`ALTER TABLE expenses    ADD COLUMN IF NOT EXISTS account_id      UUID`);
  await query(`ALTER TABLE expenses    ADD COLUMN IF NOT EXISTS is_voided       BOOLEAN NOT NULL DEFAULT false`);
  await query(`ALTER TABLE expenses    ADD COLUMN IF NOT EXISTS void_reason     TEXT`);
  await query(`ALTER TABLE receivables ADD COLUMN IF NOT EXISTS order_id        UUID`);
  await query(`ALTER TABLE receivables ADD COLUMN IF NOT EXISTS original_amount NUMERIC(12,2)`);
  await query(`ALTER TABLE receivables ADD COLUMN IF NOT EXISTS amount_paid     NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE receivables ADD COLUMN IF NOT EXISTS balance_due     NUMERIC(12,2)`);
  await query(`ALTER TABLE payables    ADD COLUMN IF NOT EXISTS purchase_id     UUID`);
  await query(`ALTER TABLE payables    ADD COLUMN IF NOT EXISTS original_amount NUMERIC(12,2)`);
  await query(`ALTER TABLE payables    ADD COLUMN IF NOT EXISTS amount_paid     NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE payables    ADD COLUMN IF NOT EXISTS balance_due     NUMERIC(12,2)`);
  console.log('[migrate] v2 column guards OK');
}

function startServer(port) {
  const server = app.listen(port, () => console.log(`BlazeUp running on port ${port}`));
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} in use, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('[server] Could not start:', err.message);
      process.exit(1);
    }
  });
}

runMigrations()
  .catch(err => console.warn('[migrate] FAILED (non-fatal):', err.message))
  .then(() => startServer(PORT));
