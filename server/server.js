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
// Safe to re-run on every deploy — all SQL files use IF NOT EXISTS / ON CONFLICT guards.
async function runMigrations() {
  const fs           = require('fs');
  const { query, getClient } = require('./db');

  // ── v1 inline guards ─────────────────────────────────────────
  await query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS shipping_fee    NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE users    ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'approved'`);
  await query(`ALTER TABLE users    ADD COLUMN IF NOT EXISTS avatar_url      TEXT NOT NULL DEFAULT ''`);
  await query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS facebook_url    TEXT NOT NULL DEFAULT ''`);
  await query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS instagram_url   TEXT NOT NULL DEFAULT ''`);
  await query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS telegram_url    TEXT NOT NULL DEFAULT ''`);
  console.log('[migrate] v1 OK');

  // ── v2: run migrate_v2.sql (every statement is idempotent) ───
  const sqlPath = path.join(__dirname, '../db/migrate_v2.sql');
  if (fs.existsSync(sqlPath)) {
    const sql = fs.readFileSync(sqlPath, 'utf8');
    // Strip single-line comments, split on semicolons, skip BEGIN/COMMIT
    const statements = sql
      .split('\n')
      .map(line => line.replace(/--.*$/, ''))   // strip inline comments
      .join('\n')
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !/^(BEGIN|COMMIT)$/i.test(s));

    const client = await getClient();
    try {
      await client.query('BEGIN');
      for (const stmt of statements) {
        await client.query(stmt);
      }
      await client.query('COMMIT');
      console.log(`[migrate] v2 OK (${statements.length} statements)`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
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
