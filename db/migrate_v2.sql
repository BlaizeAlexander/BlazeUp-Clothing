-- ============================================================
-- migrate_v2.sql — BlazeUp Accounting System Upgrade
-- Run: psql $DATABASE_URL -f db/migrate_v2.sql
-- Safe to re-run: all DDL uses IF NOT EXISTS / IF EXISTS guards
-- ============================================================

BEGIN;

-- ── 1. CHART OF ACCOUNTS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT    NOT NULL UNIQUE,
  name           TEXT    NOT NULL,
  type           TEXT    NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  normal_balance TEXT    NOT NULL CHECK (normal_balance IN ('debit','credit')),
  is_system      BOOLEAN NOT NULL DEFAULT false,
  parent_code    TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO accounts (code, name, type, normal_balance, is_system) VALUES
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
ON CONFLICT (code) DO NOTHING;

-- ── 2. JOURNAL ENTRIES (double-entry) ────────────────────────
CREATE TABLE IF NOT EXISTS journal_entries (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  date        DATE    NOT NULL DEFAULT CURRENT_DATE,
  description TEXT    NOT NULL,
  ref_type    TEXT,   -- 'order' | 'payment' | 'purchase' | 'supplier_payment' | 'expense' | 'manual'
  ref_id      UUID,
  posted_by   UUID    REFERENCES users(id) ON DELETE SET NULL,
  is_voided   BOOLEAN NOT NULL DEFAULT false,
  void_reason TEXT,
  voided_at   TIMESTAMPTZ,
  voided_by   UUID    REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID          NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id       UUID          NOT NULL REFERENCES accounts(id),
  debit            NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit           NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description      TEXT          NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS je_ref_idx      ON journal_entries (ref_type, ref_id);
CREATE INDEX IF NOT EXISTS jel_entry_idx   ON journal_entry_lines (journal_entry_id);
CREATE INDEX IF NOT EXISTS jel_account_idx ON journal_entry_lines (account_id);

-- ── 3. PRODUCT VARIANTS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_variants (
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
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (product_id, size, color)
);

CREATE INDEX IF NOT EXISTS pv_product_idx ON product_variants (product_id);

-- ── 4. INVENTORY MOVEMENTS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_movements (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id  UUID          NOT NULL REFERENCES product_variants(id),
  type        TEXT          NOT NULL CHECK (type IN
                ('purchase','sale','return_in','return_out','adjustment','damage')),
  qty_change  INTEGER       NOT NULL,  -- positive = stock in, negative = stock out
  unit_cost   NUMERIC(12,4) NOT NULL DEFAULT 0,
  total_cost  NUMERIC(12,2) NOT NULL DEFAULT 0,
  qty_after   INTEGER       NOT NULL DEFAULT 0,
  ref_type    TEXT,
  ref_id      UUID,
  notes       TEXT          NOT NULL DEFAULT '',
  created_by  UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS im_variant_idx ON inventory_movements (variant_id);

-- ── 5. ORDERS — new columns ───────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_fee    NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_paid     NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS balance_due     NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status  TEXT          NOT NULL DEFAULT 'unpaid';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes           TEXT          NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_voided       BOOLEAN       NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS void_reason     TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS posted_at       TIMESTAMPTZ;

-- ── 6. ORDER ITEMS — new columns ─────────────────────────────
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id      UUID    REFERENCES product_variants(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS line_total      NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS line_cogs       NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Backfill line_total for existing rows
UPDATE order_items SET line_total = price * quantity WHERE line_total = 0;
-- Backfill line_cogs for existing rows
UPDATE order_items SET line_cogs  = cost_at_sale * quantity WHERE line_cogs = 0;

-- ── 7. CUSTOMER PAYMENTS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID          NOT NULL REFERENCES orders(id),
  date             DATE          NOT NULL DEFAULT CURRENT_DATE,
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method           TEXT          NOT NULL DEFAULT 'gcash'
                     CHECK (method IN ('cash','gcash','bank','other')),
  reference_number TEXT          NOT NULL DEFAULT '',
  screenshot_url   TEXT          NOT NULL DEFAULT '',
  notes            TEXT          NOT NULL DEFAULT '',
  posted_by        UUID          REFERENCES users(id) ON DELETE SET NULL,
  is_voided        BOOLEAN       NOT NULL DEFAULT false,
  void_reason      TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pay_order_idx ON payments (order_id);

-- ── 8. PURCHASES (from suppliers) ────────────────────────────
CREATE TABLE IF NOT EXISTS purchases (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name  TEXT          NOT NULL,
  supplier_ref   TEXT          NOT NULL DEFAULT '',
  date           DATE          NOT NULL DEFAULT CURRENT_DATE,
  subtotal       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total          NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid    NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_due    NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status TEXT          NOT NULL DEFAULT 'unpaid'
                   CHECK (payment_status IN ('unpaid','partial','paid')),
  status         TEXT          NOT NULL DEFAULT 'received'
                   CHECK (status IN ('draft','received','cancelled')),
  notes          TEXT          NOT NULL DEFAULT '',
  posted_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  is_voided      BOOLEAN       NOT NULL DEFAULT false,
  void_reason    TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID          NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id  UUID          REFERENCES products(id) ON DELETE SET NULL,
  variant_id  UUID          REFERENCES product_variants(id) ON DELETE SET NULL,
  name        TEXT          NOT NULL,
  qty         INTEGER       NOT NULL CHECK (qty > 0),
  unit_cost   NUMERIC(12,4) NOT NULL,
  line_total  NUMERIC(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS pi_purchase_idx ON purchase_items (purchase_id);

-- ── 9. SUPPLIER PAYMENTS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_payments (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id      UUID          NOT NULL REFERENCES purchases(id),
  date             DATE          NOT NULL DEFAULT CURRENT_DATE,
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method           TEXT          NOT NULL DEFAULT 'cash'
                     CHECK (method IN ('cash','gcash','bank','other')),
  reference_number TEXT          NOT NULL DEFAULT '',
  notes            TEXT          NOT NULL DEFAULT '',
  posted_by        UUID          REFERENCES users(id) ON DELETE SET NULL,
  is_voided        BOOLEAN       NOT NULL DEFAULT false,
  void_reason      TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sp_purchase_idx ON supplier_payments (purchase_id);

-- ── 10. RECEIVABLES — upgrade ─────────────────────────────────
ALTER TABLE receivables ADD COLUMN IF NOT EXISTS order_id       UUID REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE receivables ADD COLUMN IF NOT EXISTS original_amount NUMERIC(12,2);
ALTER TABLE receivables ADD COLUMN IF NOT EXISTS amount_paid    NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE receivables ADD COLUMN IF NOT EXISTS balance_due    NUMERIC(12,2);
-- Backfill: treat existing 'amount' as both original_amount and balance_due
UPDATE receivables SET original_amount = amount WHERE original_amount IS NULL;
UPDATE receivables SET balance_due     = amount WHERE balance_due     IS NULL;

-- ── 11. PAYABLES — upgrade ────────────────────────────────────
ALTER TABLE payables ADD COLUMN IF NOT EXISTS purchase_id     UUID REFERENCES purchases(id) ON DELETE SET NULL;
ALTER TABLE payables ADD COLUMN IF NOT EXISTS original_amount NUMERIC(12,2);
ALTER TABLE payables ADD COLUMN IF NOT EXISTS amount_paid     NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payables ADD COLUMN IF NOT EXISTS balance_due     NUMERIC(12,2);
UPDATE payables SET original_amount = amount WHERE original_amount IS NULL;
UPDATE payables SET balance_due     = amount WHERE balance_due     IS NULL;

-- ── 12. EXPENSES — upgrade ────────────────────────────────────
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_status  TEXT    NOT NULL DEFAULT 'paid'
                       CHECK (payment_status IN ('paid','unpaid'));
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_method  TEXT    NOT NULL DEFAULT 'cash'
                       CHECK (payment_method IN ('cash','gcash','bank','other'));
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS account_id      UUID    REFERENCES accounts(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_voided       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS void_reason     TEXT;

-- ── 13. AUDIT LOG ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT        NOT NULL,
  table_name  TEXT        NOT NULL,
  record_id   UUID,
  old_values  JSONB,
  new_values  JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS al_table_record_idx ON audit_log (table_name, record_id);
CREATE INDEX IF NOT EXISTS al_user_idx         ON audit_log (user_id);

COMMIT;
