// ============================================================
// server/db.js — PostgreSQL connection pool
//
// Decision: raw `pg` over Prisma.
// Reason: this codebase has no existing ORM layer, no migrations
// framework, and relatively simple queries. Dropping Prisma in
// would add ~300 MB of generated client, a separate schema file,
// and a whole new mental model. Raw pg keeps every SQL statement
// visible and auditable — important for a finance-touching app.
// ============================================================

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // On Render the URL embeds sslmode=require; locally we skip SSL.
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
  max: 10,                  // max simultaneous connections
  idleTimeoutMillis: 30000, // close idle clients after 30s
  connectionTimeoutMillis: 3000
});

pool.on('error', (err) => {
  console.error('[pg] Unexpected pool error:', err.message);
});

/**
 * Execute a single parameterized query.
 *
 *   const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
 */
async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

/**
 * Get a raw client for manual transaction control.
 *
 *   const client = await getClient();
 *   try {
 *     await client.query('BEGIN');
 *     ...
 *     await client.query('COMMIT');
 *   } catch (e) {
 *     await client.query('ROLLBACK');
 *     throw e;
 *   } finally {
 *     client.release();
 *   }
 */
async function getClient() {
  return pool.connect();
}

module.exports = { query, getClient, pool };
