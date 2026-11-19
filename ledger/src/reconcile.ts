import type { Channel } from './db';
import { insertEntry } from './db';
import { nowIso } from './dates';
import { log } from './log';

export type ReconcileResult =
  | { status: 'open' }
  | { status: 'pending' }
  | { status: 'matched'; matched: number }
  | { status: 'variance'; gap: number };

type PayoutRow = {
  payout_id: string;
  payout_date: string;
  amount_cents: number;
  raw_json: string | null;
};

export async function recordPayout(
  db: D1Database,
  channel: Channel,
  payoutId: string,
  payoutDate: string,
  amountCents: number,
  currency: string,
  rawJson: string | null,
  importedAt: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO payouts (channel, payout_id, payout_date, amount_cents, currency, raw_json, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (channel, payout_id) DO NOTHING`,
    )
    .bind(channel, payoutId, payoutDate, amountCents, currency, rawJson, importedAt)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

// Sum of JUP LIFE rows linked to the payout, compared to the payout amount.
// A gap inserts one VARIANCE row. The same gap does not insert twice.
// postScan is set only after balance transactions for the payout were read.
// Without linked rows and without a completed scan, no variance is posted.
export async function reconcilePayout(
  db: D1Database,
  channel: Channel,
  payoutId: string,
  payoutDate: string,
  amountCents: number,
  rawJson: string | null,
  importedAt: string,
  postScan: boolean,
): Promise<ReconcileResult> {
  await recordPayout(db, channel, payoutId, payoutDate, amountCents, 'usd', rawJson, importedAt);

  const link = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM entries
       WHERE channel = ? AND payout_id = ? AND row_kind != 'variance'`,
    )
    .bind(channel, payoutId)
    .first<{ n: number }>();
  const links = Number(link?.n ?? 0);
  if (links === 0 && !postScan) return { status: 'open' };

  const pending = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM effective_entries
       WHERE fees_status = 'pending'
         AND row_kind != 'variance'
         AND order_id IN (
           SELECT order_id FROM entries
           WHERE channel = ? AND payout_id = ? AND row_kind != 'variance'
         )`,
    )
    .bind(channel, payoutId)
    .first<{ n: number }>();
  if (Number(pending?.n ?? 0) > 0) return { status: 'pending' };

  const matchedRow = await db
    .prepare(
      `SELECT COALESCE(SUM(net_cents), 0) AS s FROM effective_entries
       WHERE row_kind != 'variance'
         AND net_cents IS NOT NULL
         AND order_id IN (
           SELECT order_id FROM entries
           WHERE channel = ? AND payout_id = ? AND row_kind != 'variance'
         )`,
    )
    .bind(channel, payoutId)
    .first<{ s: number }>();
  const varianceRow = await db
    .prepare(
      `SELECT COALESCE(SUM(net_cents), 0) AS s FROM entries
       WHERE channel = ? AND payout_id = ? AND row_kind = 'variance'`,
    )
    .bind(channel, payoutId)
    .first<{ s: number }>();
  const matched = Number(matchedRow?.s ?? 0);
  const already = Number(varianceRow?.s ?? 0);
  const gap = amountCents - matched - already;
  if (gap === 0) return { status: 'matched', matched };
  const explanation = JSON.stringify({
    reason: 'payout_gap',
    payout_id: payoutId,
    amount_cents: amountCents,
    matched_cents: matched,
    gap_cents: gap,
  });
  await insertEntry(
    db,
    {
      channel,
      source_id: payoutId,
      line_id: `variance:${matched}:${amountCents}:${already}`,
      date: payoutDate,
      order_id: `payout:${payoutId}`,
      sku: null,
      product: 'Payout variance',
      variant: null,
      qty: null,
      gross_cents: gap,
      discounts_cents: 0,
      shipping_charged_cents: 0,
      tax_collected_cents: 0,
      platform_fee_cents: 0,
      processor_fee_cents: 0,
      shipping_label_cost_cents: null,
      refunds_cents: 0,
      chargebacks_cents: 0,
      payout_id: payoutId,
      payout_date: payoutDate,
      source_url: null,
      source_tag: channel === 'stripe_direct' ? 'stripe_api' : channel === 'shopify' ? 'shopify_api' : 'csv_import',
      status: 'open',
      row_kind: 'variance',
      link_charge_id: null,
      link_payment_intent: null,
      raw_json: explanation,
    },
    importedAt,
  );
  log('payout_variance', { channel, payout_id: payoutId, gap_cents: gap });
  return { status: 'variance', gap };
}

export async function reconcileChannel(db: D1Database, channel: Channel, postScan: boolean): Promise<void> {
  const rows = await db
    .prepare(`SELECT payout_id, payout_date, amount_cents, raw_json FROM payouts WHERE channel = ?`)
    .bind(channel)
    .all<PayoutRow>();
  for (const payout of rows.results) {
    await reconcilePayout(
      db,
      channel,
      payout.payout_id,
      payout.payout_date,
      payout.amount_cents,
      payout.raw_json,
      nowIso(),
      postScan,
    );
  }
}
