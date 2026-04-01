// ============================================================
// routes/auth.js — Register, login, logout, /me, /admin/check
// ============================================================

const express = require('express');
const bcrypt  = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { query }  = require('../db');
const { issueToken, clearToken, requireLogin, JWT_SECRET, COOKIE_NAME } = require('../middleware/auth');
const jwt = require('jsonwebtoken');

const router = express.Router();

// ── Input validation schemas ─────────────────────────────────
const registerRules = [
  body('username').trim().isLength({ min: 2, max: 30 }).withMessage('Username must be 2–30 characters.'),
  body('email').isEmail().normalizeEmail().withMessage('A valid email is required.'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
  body('contact').trim().notEmpty().withMessage('Contact number is required.')
];

const loginRules = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
];

function firstError(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return true;
  }
  return false;
}

// ── Referral code generator ───────────────────────────────────
function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function uniqueReferralCode() {
  let code;
  let taken = true;
  while (taken) {
    code = generateCode();
    const { rows } = await query('SELECT id FROM users WHERE referral_code = $1', [code]);
    taken = rows.length > 0;
  }
  return code;
}

// ── POST /api/register ────────────────────────────────────────
router.post('/register', registerRules, async (req, res, next) => {
  if (firstError(req, res)) return;

  const { username, email, password, referralCode, contact } = req.body;
  try {
    // Uniqueness checks
    const [emailCheck, nameCheck] = await Promise.all([
      query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]),
      query('SELECT id FROM users WHERE lower(username) = lower($1)', [username])
    ]);
    if (emailCheck.rows.length) return res.status(400).json({ error: 'Email already registered.' });
    if (nameCheck.rows.length)  return res.status(400).json({ error: 'Username already taken.' });

    // bcrypt rounds: 12 (vs original 10) — better brute-force resistance
    const passwordHash = await bcrypt.hash(password, 12);
    const refCode      = await uniqueReferralCode();

    let referredById = null;
    if (referralCode) {
      const referrerRes = await query(
        'SELECT id FROM users WHERE referral_code = $1',
        [referralCode.toUpperCase()]
      );
      if (referrerRes.rows.length) {
        referredById = referrerRes.rows[0].id;
      }
    }

    await query(`
      INSERT INTO users (username, email, password_hash, contact, referral_code, referred_by, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending')
    `, [username, email.toLowerCase(), passwordHash, contact, refCode, referredById]);

    // No JWT issued — account must be approved by admin first
    res.json({ success: true, pending: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/login ───────────────────────────────────────────
router.post('/login', loginRules, async (req, res, next) => {
  const { email, password } = req.body;
  try {
    const { rows } = await query(
      'SELECT * FROM users WHERE lower(email) = lower($1)',
      [email]
    );
    const user = rows[0];

    // Always run bcrypt.compare to prevent timing-based user enumeration.
    // If the user doesn't exist we compare against a dummy hash so the
    // response time is the same either way.
    const DUMMY = '$2a$12$invalidhashfortimingnormalization00000000000000000000000';
    const match = await bcrypt.compare(password, user ? user.password_hash : DUMMY);

    if (!user || !match) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is pending admin approval.' });
    }
    if (user.status === 'denied') {
      return res.status(403).json({ error: 'Your registration was denied. Contact the store for help.' });
    }

    issueToken(res, user);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/logout ──────────────────────────────────────────
router.post('/logout', (req, res) => {
  clearToken(res);
  res.json({ success: true });
});

// ── GET /api/me ───────────────────────────────────────────────
router.get('/me', requireLogin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, username, email, contact, pinned_location, points,
              role, referral_code, referral_count, referred_by, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    const u = rows[0];
    res.json({
      id:            u.id,
      username:      u.username,
      email:         u.email,
      contact:       u.contact,
      pinnedLocation: u.pinned_location,
      points:        u.points,
      isAdmin:       u.role === 'admin',
      referralCode:  u.referral_code,
      referralCount: u.referral_count,
      referredBy:    u.referred_by,
      createdAt:     u.created_at
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/admin/check ──────────────────────────────────────
// Used by the frontend to show/hide the Admin nav link.
// Does NOT hit the database — just reads the JWT cookie.
router.get('/admin/check', (req, res) => {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.json({ isAdmin: false });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ isAdmin: payload.role === 'admin' });
  } catch {
    res.json({ isAdmin: false });
  }
});

// ── GET /api/admin/users/pending ─────────────────────────────
router.get('/admin/users/pending', requireLogin, async (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
  try {
    const { rows } = await query(
      `SELECT id, username, email, contact, created_at FROM users WHERE status = 'pending' ORDER BY created_at ASC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/admin/users/:id/approve ────────────────────────
router.post('/admin/users/:id/approve', requireLogin, async (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
  try {
    const { rows } = await query(
      `UPDATE users SET status = 'approved' WHERE id = $1 AND status = 'pending' RETURNING id, referred_by`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pending user not found.' });

    // Award referral points now that the account is approved
    if (rows[0].referred_by) {
      const settingsRes = await query('SELECT * FROM settings WHERE id = 1');
      const s = settingsRes.rows[0];
      if (s && s.points_system_enabled) {
        await query(
          'UPDATE users SET points = points + $1, referral_count = referral_count + 1 WHERE id = $2',
          [s.referral_reward_points, rows[0].referred_by]
        );
      }
    }

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/admin/users/:id/deny ───────────────────────────
router.post('/admin/users/:id/deny', requireLogin, async (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
  try {
    const { rows } = await query(
      `UPDATE users SET status = 'denied' WHERE id = $1 AND status = 'pending' RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pending user not found.' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
