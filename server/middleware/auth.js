// ============================================================
// middleware/auth.js — JWT-based authentication
//
// Decision: JWT over PostgreSQL sessions.
// Reason: Render spins down free-tier servers and sessions stored
// in memory are lost on restart. A PostgreSQL session store adds
// an extra table and a DB round-trip on every request. JWT is
// stateless — the server just validates a signed token, no DB
// hit required for auth checks. We store it in an HTTP-only
// SameSite=strict cookie so it's invisible to JavaScript (XSS
// safe) and CSRF is mitigated by the SameSite policy.
// ============================================================

const jwt = require('jsonwebtoken');

const JWT_SECRET  = process.env.JWT_SECRET || 'change-me-before-production';
const COOKIE_NAME = 'blazeup_token';
const MAX_AGE_MS  = 1000 * 60 * 60 * 24; // 24 hours

/**
 * Issue a signed JWT and set it as an HTTP-only cookie.
 * Called after successful login or registration.
 */
function issueToken(res, user) {
  const token = jwt.sign(
    { sub: user.id, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,                      // not readable by JS
    secure:   !!process.env.RENDER,      // HTTPS only on Render
    sameSite: 'strict',                  // blocks cross-site request forgery
    maxAge:   MAX_AGE_MS
  });
}

/**
 * Clear the auth cookie (logout).
 */
function clearToken(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict' });
}

/**
 * Middleware: require a valid JWT cookie.
 * Attaches req.user = { id, role } on success.
 * Returns 401 without hitting the database.
 */
function requireLogin(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not logged in.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    clearToken(res);
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

/**
 * Middleware: require admin role.
 * Always use AFTER requireLogin — depends on req.user being set.
 */
function requireAdmin(req, res, next) {
  if (!req.user)                 return res.status(401).json({ error: 'Not logged in.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access only.' });
  next();
}

/**
 * Try to identify the current user without hard-failing.
 * Sets req.user if a valid token exists, otherwise leaves it undefined.
 * Used on routes that allow both guests and logged-in users (e.g. POST /api/orders).
 */
function optionalLogin(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = { id: payload.sub, role: payload.role };
    } catch { /* guest — req.user stays undefined */ }
  }
  next();
}

module.exports = { issueToken, clearToken, requireLogin, requireAdmin, optionalLogin, JWT_SECRET, COOKIE_NAME };
