// One-time script to create Supabase Storage buckets.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node db/setup-storage.js

const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error('ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_KEY before running.');
  process.exit(1);
}

const supabase = createClient(url, key);

async function run() {
  const buckets = [
    { name: 'products', public: true },
    { name: 'payments', public: true }
  ];

  for (const b of buckets) {
    const { error } = await supabase.storage.createBucket(b.name, { public: b.public });
    if (error && error.message !== 'The resource already exists') {
      console.error(`Failed to create bucket "${b.name}":`, error.message);
    } else {
      console.log(`Bucket "${b.name}" ready.`);
    }
  }
}

run();
