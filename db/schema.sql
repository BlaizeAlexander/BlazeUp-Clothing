-- ============================================================
-- db/schema.sql — BlazeUp Clothing Store
-- Run once:  psql $DATABASE_URL -f db/schema.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username        TEXT        NOT NULL,
  email           TEXT        NOT NULL,
  password_hash   TEXT        NOT NULL,
  contact         TEXT        NOT NULL DEFAULT '',
  pinned_location TEXT        NOT NULL DEFAULT '',
  points          INTEGER     NOT NULL DEFAULT 0,
  role            TEXT        NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  referral_code   TEXT        NOT NULL UNIQUE,
  referral_count  INTEGER     NOT NULL DEFAULT 0,
  referred_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx    ON users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));

-- ── PRODUCTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT          NOT NULL,
  description    TEXT          NOT NULL DEFAULT '',
  price          NUMERIC(12,2) NOT NULL,
  cost_price     NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_quantity INTEGER       NOT NULL DEFAULT 0,
  category       TEXT          NOT NULL DEFAULT '',
  price_tiers    JSONB         NOT NULL DEFAULT '[]',
  variants       JSONB         NOT NULL DEFAULT '[]',
  images         JSONB         NOT NULL DEFAULT '[]',
  image          TEXT          NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── ORDERS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID          REFERENCES users(id) ON DELETE SET NULL,
  customer_name      TEXT          NOT NULL,
  contact            TEXT          NOT NULL,
  address            TEXT          NOT NULL,
  total              NUMERIC(12,2) NOT NULL,
  points_used        INTEGER       NOT NULL DEFAULT 0,
  payment_screenshot TEXT          NOT NULL DEFAULT '',
  status             TEXT          NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','confirmed','shipped','delivered','cancelled')),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_user_id_idx    ON orders (user_id);
CREATE INDEX IF NOT EXISTS orders_status_idx     ON orders (status);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);

-- ── ORDER ITEMS (normalized — one row per product per order) ─
CREATE TABLE IF NOT EXISTS order_items (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   UUID          REFERENCES products(id) ON DELETE SET NULL,
  name         TEXT          NOT NULL,           -- snapshot: "Shirt — Large"
  price        NUMERIC(12,2) NOT NULL,           -- final price charged
  base_price   NUMERIC(12,2) NOT NULL DEFAULT 0, -- pre-discount price
  cost_at_sale NUMERIC(12,2) NOT NULL DEFAULT 0, -- cost snapshot for COGS
  quantity     INTEGER       NOT NULL DEFAULT 1,
  image        TEXT          NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);

-- ── DISCOUNTS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS discounts (
  id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT          NOT NULL UNIQUE,
  type       TEXT          NOT NULL CHECK (type IN ('percent', 'fixed')),
  value      NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── EXPENSES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT          NOT NULL,
  description TEXT          NOT NULL DEFAULT '',
  amount      NUMERIC(12,2) NOT NULL,
  date        DATE          NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses (date DESC);

-- ── RECEIVABLES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS receivables (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  related_order_id UUID          REFERENCES orders(id) ON DELETE SET NULL,
  customer_id      UUID          REFERENCES users(id) ON DELETE SET NULL,
  customer_name    TEXT          NOT NULL,
  amount           NUMERIC(12,2) NOT NULL,
  status           TEXT          NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','paid','overdue','open','partial')),
  due_date         TEXT          NOT NULL DEFAULT '',
  notes            TEXT          NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS receivables_status_idx   ON receivables (status);
CREATE INDEX IF NOT EXISTS receivables_order_id_idx ON receivables (related_order_id);

-- ── PAYABLES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payables (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name TEXT          NOT NULL,
  description   TEXT          NOT NULL DEFAULT '',
  amount        NUMERIC(12,2) NOT NULL,
  status        TEXT          NOT NULL DEFAULT 'unpaid'
                  CHECK (status IN ('unpaid','partial','overdue','paid')),
  due_date      TEXT          NOT NULL DEFAULT '',
  notes         TEXT          NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payables_status_idx ON payables (status);

-- ── SETTINGS (single enforced row) ───────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  id                     INTEGER      PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  points_system_enabled  BOOLEAN      NOT NULL DEFAULT TRUE,
  purchase_points_rate   NUMERIC(8,4) NOT NULL DEFAULT 1,
  referral_reward_points INTEGER      NOT NULL DEFAULT 50,
  payment_qr_code_path   TEXT         NOT NULL DEFAULT '',
  shipping_fee           NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- Seed the one and only row — safe to re-run
INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;
