-- Append-only sales ledger. Application code inserts rows and never updates or deletes them.
-- Money is integer cents. NULL fee columns mean PENDING, not zero.

CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL CHECK (channel IN ('shopify', 'tiktok', 'stripe_direct', 'other')),
  source_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  date TEXT NOT NULL,
  order_id TEXT NOT NULL,
  sku TEXT,
  product TEXT,
  variant TEXT,
  qty INTEGER,
  gross_cents INTEGER,
  discounts_cents INTEGER,
  shipping_charged_cents INTEGER,
  tax_collected_cents INTEGER,
  platform_fee_cents INTEGER,
  processor_fee_cents INTEGER,
  shipping_label_cost_cents INTEGER,
  refunds_cents INTEGER,
  chargebacks_cents INTEGER,
  net_cents INTEGER,
  fees_status TEXT NOT NULL CHECK (fees_status IN ('settled', 'pending')),
  payout_id TEXT,
  payout_date TEXT,
  source_url TEXT,
  source_tag TEXT NOT NULL,
  status TEXT NOT NULL,
  row_kind TEXT NOT NULL,
  link_charge_id TEXT,
  link_payment_intent TEXT,
  raw_json TEXT,
  imported_at TEXT NOT NULL,
  UNIQUE (channel, source_id, line_id)
);

CREATE INDEX idx_entries_order ON entries (channel, order_id);
CREATE INDEX idx_entries_payout ON entries (channel, payout_id);
CREATE INDEX idx_entries_date ON entries (date);
CREATE INDEX idx_entries_charge ON entries (link_charge_id);
CREATE INDEX idx_entries_pi ON entries (link_payment_intent);

-- Pending order-fee rows stay in the table for audit. Reporting skips them once a
-- settled order-fee row exists for the same order.
CREATE VIEW effective_entries AS
SELECT e.*
FROM entries e
WHERE NOT (
  e.fees_status = 'pending'
  AND e.row_kind = 'order_fee'
  AND EXISTS (
    SELECT 1
    FROM entries s
    WHERE s.channel = e.channel
      AND s.order_id = e.order_id
      AND s.row_kind = 'order_fee'
      AND s.fees_status = 'settled'
  )
);

CREATE TABLE unit_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL,
  unit_cost_cents INTEGER NOT NULL,
  landed_extra_cents INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_unit_costs_sku ON unit_costs (sku, effective_from);

CREATE TABLE payouts (
  channel TEXT NOT NULL,
  payout_id TEXT NOT NULL,
  payout_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  raw_json TEXT,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (channel, payout_id)
);

CREATE TABLE ingest_cursors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  cursor TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
