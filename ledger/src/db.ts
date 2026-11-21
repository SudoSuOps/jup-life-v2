import type { FeeStatus } from './money';
import { netFromParts } from './money';

export type Channel = 'shopify' | 'tiktok' | 'stripe_direct' | 'other';

export type EntryInput = {
  channel: Channel;
  source_id: string;
  line_id: string;
  date: string;
  order_id: string;
  sku: string | null;
  product: string | null;
  variant: string | null;
  qty: number | null;
  gross_cents: number | null;
  discounts_cents: number | null;
  shipping_charged_cents: number | null;
  tax_collected_cents: number | null;
  platform_fee_cents: number | null;
  processor_fee_cents: number | null;
  shipping_label_cost_cents: number | null;
  refunds_cents: number | null;
  chargebacks_cents: number | null;
  payout_id: string | null;
  payout_date: string | null;
  source_url: string | null;
  source_tag: string;
  status: string;
  row_kind: string;
  link_charge_id: string | null;
  link_payment_intent: string | null;
  raw_json: string | null;
};

export type IngestCounts = { stored: number; duplicate: number; dropped: number };

export function emptyCounts(): IngestCounts {
  return { stored: 0, duplicate: 0, dropped: 0 };
}

export async function insertEntry(db: D1Database, row: EntryInput, importedAt: string): Promise<boolean> {
  const { net_cents, fees_status } = netFromParts(row);
  const result = await db
    .prepare(
      `INSERT INTO entries (
        channel, source_id, line_id, date, order_id, sku, product, variant, qty,
        gross_cents, discounts_cents, shipping_charged_cents, tax_collected_cents,
        platform_fee_cents, processor_fee_cents, shipping_label_cost_cents,
        refunds_cents, chargebacks_cents, net_cents, fees_status,
        payout_id, payout_date, source_url, source_tag, status, row_kind,
        link_charge_id, link_payment_intent, raw_json, imported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (channel, source_id, line_id) DO NOTHING`,
    )
    .bind(
      row.channel,
      row.source_id,
      row.line_id,
      row.date,
      row.order_id,
      row.sku,
      row.product,
      row.variant,
      row.qty,
      row.gross_cents,
      row.discounts_cents,
      row.shipping_charged_cents,
      row.tax_collected_cents,
      row.platform_fee_cents,
      row.processor_fee_cents,
      row.shipping_label_cost_cents,
      row.refunds_cents,
      row.chargebacks_cents,
      net_cents,
      fees_status satisfies FeeStatus,
      row.payout_id,
      row.payout_date,
      row.source_url,
      row.source_tag,
      row.status,
      row.row_kind,
      row.link_charge_id,
      row.link_payment_intent,
      row.raw_json,
      importedAt,
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function readCursor(db: D1Database, source: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT cursor FROM ingest_cursors WHERE source = ? ORDER BY id DESC LIMIT 1`)
    .bind(source)
    .first<{ cursor: string }>();
  return row?.cursor ?? null;
}

export async function writeCursor(db: D1Database, source: string, cursor: string, updatedAt: string): Promise<void> {
  await db
    .prepare(`INSERT INTO ingest_cursors (source, cursor, updated_at) VALUES (?, ?, ?)`)
    .bind(source, cursor, updatedAt)
    .run();
}
