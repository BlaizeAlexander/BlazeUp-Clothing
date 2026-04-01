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
const authRoutes     = require('./routes/auth');
const productRoutes  = require('./routes/products');
const orderRoutes    = require('./routes/orders');
const discountRoutes = require('./routes/discounts');
const financeRoutes  = require('./routes/finance');
const settingsRoutes = require('./routes/settings');
const profileRoutes  = require('./routes/profile');

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
  await query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(12,2) NOT NULL DEFAULT 0`);
  console.log('[migrate] settings.shipping_fee OK');
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','denied'))`);
  console.log('[migrate] users.status OK');
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT ''`);
  console.log('[migrate] users.avatar_url OK');
  await query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS facebook_url  TEXT NOT NULL DEFAULT ''`);
  await query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS instagram_url TEXT NOT NULL DEFAULT ''`);
  await query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS telegram_url  TEXT NOT NULL DEFAULT ''`);
  console.log('[migrate] settings.social_urls OK');
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
