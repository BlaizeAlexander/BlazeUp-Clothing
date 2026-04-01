// One-time script to apply schema.sql to the database.
// Usage: DATABASE_URL=your_url node db/setup.js

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: Set DATABASE_URL before running this script.');
  console.error('Example: DATABASE_URL=postgres://... node db/setup.js');
  process.exit(1);
}

const pool = new Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('Schema applied successfully.');
  } catch (err) {
    console.error('Error applying schema:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
