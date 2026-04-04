// ============================================================
// db/reset-password.js — Reset a user's password directly in DB
// Usage: node db/reset-password.js <email> <newPassword>
// ============================================================

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const { query, pool } = require('../server/db');

async function main() {
  const [,, email, newPassword] = process.argv;

  if (!email || !newPassword) {
    console.error('Usage: node db/reset-password.js <email> <newPassword>');
    process.exit(1);
  }

  if (newPassword.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const { rows } = await query('SELECT id, username, role, status FROM users WHERE lower(email) = lower($1)', [email]);
  if (!rows.length) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  const user = rows[0];
  const hash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE users SET password_hash = $1, status = $2 WHERE id = $3', [hash, 'approved', user.id]);

  console.log(`Done! Password reset for ${email}`);
  console.log(`  Username : ${user.username}`);
  console.log(`  Role     : ${user.role}`);
  console.log(`  Status   : approved (was: ${user.status})`);

  await pool.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
