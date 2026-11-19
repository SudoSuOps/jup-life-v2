import {
  isJupLifeSession,
  isShopifyOrigin,
  metadataBrand,
  priceAllowlist,
  shopifyOnStripe,
  type SessionLike,
} from './brand';
import { etDate, nowIso } from './dates';
import { emptyCounts, insertEntry, readCursor, writeCursor, type EntryInput, type IngestCounts } from './db';
import type { Env } from './env';
import { json } from './http';
import { log } from './log';
import { reconcilePayout, recordPayout } from './reconcile';
import { verifyStripeSignature } from './signatures';

const STRIPE_EVENTS = ['checkout.session.completed', 'charge.refunded', 'charge.dispute.created', 'payout.paid'] as const;
type StripeEventName = (typeof STRIPE_EVENTS)[number];

const READ_PATH =
  /^\/v1\/(checkout\/sessions(\/[^/]+(\/line_items)?)?|balance_transactions|payouts|charges\/[^/]+|refunds|disputes)$/;

type Rec = Record<string, unknown>;

export type StripeIngestOpts = {
  allowlist: Set<string>;
  dedupeShopify: boolean;
  importedAt: string;
};

function asRec(value: unknown): Rec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Rec;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function metadataOf(value: unknown): Record<string, string> | null {
  const rec = asRec(value);
  if (!rec) return null;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(rec)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

function isStripeEvent(type: string): type is StripeEventName {
  return (STRIPE_EVENTS as readonly string[]).includes(type);
}

function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  return str(asRec(value)?.id);
}

export async function stripeGet(key: string, pathAndQuery: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const path = pathAndQuery.split('?')[0] ?? '';
  if (!READ_PATH.test(path)) throw new Error('blocked stripe path');
  const response = await fetchImpl(`https://api.stripe.com${pathAndQuery}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`stripe read failed ${response.status}`);
  return response.json();
}

function sessionLike(rec: Rec): SessionLike {
  const items = asRec(rec.line_items);
  const data = Array.isArray(items?.data) ? items.data : [];
  return {
    success_url: str(rec.success_url),
    cancel_url: str(rec.cancel_url),
    metadata: metadataOf(rec.metadata),
    line_items: { data: data.map((row) => ({ price: asRec(row)?.price })) },
  };
}

function paymentRefs(rec: Rec): { pi: string | null; charge: string | null } {
  const pi = rec.payment_intent;
  if (typeof pi === 'string') return { pi, charge: null };
  const obj = asRec(pi);
  if (!obj) return { pi: null, charge: null };
  return { pi: str(obj.id), charge: idOf(obj.latest_charge) };
}

async function findOrderId(db: D1Database, chargeId: string | null, pi: string | null): Promise<string | null> {
  if (chargeId) {
    const row = await db
      .prepare(`SELECT order_id FROM entries WHERE link_charge_id = ? LIMIT 1`)
      .bind(chargeId)
      .first<{ order_id: string }>();
    if (row?.order_id) return row.order_id;
  }
  if (pi) {
    const row = await db
      .prepare(`SELECT order_id FROM entries WHERE link_payment_intent = ? LIMIT 1`)
      .bind(pi)
      .first<{ order_id: string }>();
    if (row?.order_id) return row.order_id;
  }
  return null;
}

async function put(db: D1Database, counts: IngestCounts, row: EntryInput, importedAt: string): Promise<void> {
  const inserted = await insertEntry(db, row, importedAt);
  if (inserted) counts.stored += 1;
  else counts.duplicate += 1;
}

function baseRow(partial: EntryInput): EntryInput {
  return partial;
}

export async function ingestStripeSession(db: D1Database, session: unknown, opts: StripeIngestOpts): Promise<IngestCounts> {
  const counts = emptyCounts();
  const rec = asRec(session);
  if (!rec) {
    counts.dropped += 1;
    return counts;
  }
  const id = str(rec.id);
  if (!id) {
    counts.dropped += 1;
    return counts;
  }
  const like = sessionLike(rec);
  if (!isJupLifeSession(like, opts.allowlist)) {
    counts.dropped += 1;
    log('stripe_drop', { reason: 'brand', id });
    return counts;
  }
  if (opts.dedupeShopify && isShopifyOrigin({ metadata: like.metadata, description: str(rec.description) })) {
    counts.dropped += 1;
    log('stripe_drop', { reason: 'shopify_dedupe', id });
    return counts;
  }
  if ((str(rec.currency) ?? 'usd').toLowerCase() !== 'usd') {
    counts.dropped += 1;
    log('stripe_drop', { reason: 'non_usd', id });
    return counts;
  }
  if (str(rec.payment_status) !== 'paid') {
    counts.dropped += 1;
    log('stripe_drop', { reason: 'unpaid', id });
    return counts;
  }
  const created = num(rec.created);
  if (created === null) {
    counts.dropped += 1;
    return counts;
  }
  const refs = paymentRefs(rec);
  const raw = JSON.stringify(rec);
  const date = etDate(created);
  const details = asRec(rec.total_details);
  const lines = lineRecords(rec);
  let lineDiscount = 0;
  if (lines.length === 0) {
    const gross = num(rec.amount_subtotal) ?? 0;
    const discount = num(details?.amount_discount) ?? 0;
    lineDiscount = discount;
    await put(db, counts, saleRow({
      sourceId: id,
      lineId: 'session',
      date,
      orderId: id,
      sku: null,
      product: 'Checkout session',
      variant: null,
      qty: 1,
      gross,
      discount,
      refs,
      raw,
      url: stripeUrl(refs),
    }), opts.importedAt);
  } else {
    for (const line of lines) {
      const price = asRec(line.price);
      const qty = num(line.quantity) ?? 0;
      const unit = num(price?.unit_amount);
      const gross = unit !== null ? unit * qty : (num(line.amount_subtotal) ?? 0);
      const discount = num(line.amount_discount) ?? 0;
      lineDiscount += discount;
      const priceMeta = metadataOf(price?.metadata);
      const productObj = asRec(price?.product);
      await put(db, counts, saleRow({
        sourceId: id,
        lineId: str(line.id) ?? `line:${counts.stored}`,
        date,
        orderId: id,
        sku: str(priceMeta?.sku),
        product: str(productObj?.name) ?? str(line.description),
        variant: str(price?.nickname),
        qty,
        gross,
        discount,
        refs,
        raw,
        url: stripeUrl(refs),
      }), opts.importedAt);
    }
  }
  const orderDiscount = num(details?.amount_discount) ?? lineDiscount;
  const extraDiscount = Math.max(0, orderDiscount - lineDiscount);
  await putOrderFee(db, counts, {
    sourceId: id,
    orderId: id,
    date,
    shipping: num(details?.amount_shipping) ?? 0,
    tax: num(details?.amount_tax) ?? 0,
    extraDiscount,
    processor: null,
    refs,
    raw,
    url: stripeUrl(refs),
    importedAt: opts.importedAt,
  });
  return counts;
}

function lineRecords(rec: Rec): Rec[] {
  const items = asRec(rec.line_items);
  if (!Array.isArray(items?.data)) return [];
  return items.data.map(asRec).filter((row): row is Rec => row !== null);
}

function stripeUrl(refs: { pi: string | null; charge: string | null }): string | null {
  if (refs.pi) return `https://dashboard.stripe.com/payments/${refs.pi}`;
  if (refs.charge) return `https://dashboard.stripe.com/payments/${refs.charge}`;
  return null;
}

function saleRow(input: {
  sourceId: string;
  lineId: string;
  date: string;
  orderId: string;
  sku: string | null;
  product: string | null;
  variant: string | null;
  qty: number;
  gross: number;
  discount: number;
  refs: { pi: string | null; charge: string | null };
  raw: string;
  url: string | null;
}): EntryInput {
  return baseRow({
    channel: 'stripe_direct',
    source_id: input.sourceId,
    line_id: input.lineId,
    date: input.date,
    order_id: input.orderId,
    sku: input.sku,
    product: input.product,
    variant: input.variant,
    qty: input.qty,
    gross_cents: input.gross,
    discounts_cents: input.discount,
    shipping_charged_cents: 0,
    tax_collected_cents: 0,
    platform_fee_cents: 0,
    processor_fee_cents: 0,
    shipping_label_cost_cents: null,
    refunds_cents: 0,
    chargebacks_cents: 0,
    payout_id: null,
    payout_date: null,
    source_url: input.url,
    source_tag: 'stripe_api',
    status: 'open',
    row_kind: 'sale',
    link_charge_id: input.refs.charge,
    link_payment_intent: input.refs.pi,
    raw_json: input.raw,
  });
}

async function putOrderFee(
  db: D1Database,
  counts: IngestCounts,
  input: {
    sourceId: string;
    orderId: string;
    date: string;
    shipping: number;
    tax: number;
    extraDiscount: number;
    processor: number | null;
    refs: { pi: string | null; charge: string | null };
    raw: string;
    url: string | null;
    importedAt: string;
    payoutId?: string | null;
    payoutDate?: string | null;
  },
): Promise<void> {
  const existing = await db
    .prepare(
      `SELECT fees_status FROM entries
       WHERE channel = 'stripe_direct' AND order_id = ? AND row_kind = 'order_fee' AND fees_status = 'settled' LIMIT 1`,
    )
    .bind(input.orderId)
    .first<{ fees_status: string }>();
  if (existing && input.processor !== null) return;
  const pending = await db
    .prepare(
      `SELECT shipping_charged_cents, tax_collected_cents, discounts_cents FROM entries
       WHERE channel = 'stripe_direct' AND source_id = ? AND line_id = '_order_fee' LIMIT 1`,
    )
    .bind(input.sourceId)
    .first<{ shipping_charged_cents: number; tax_collected_cents: number; discounts_cents: number }>();
  const lineId = pending && input.processor !== null ? '_order_fee_settled' : '_order_fee';
  if (lineId === '_order_fee' && input.processor === null && pending) return;
  const shipping = input.shipping === 0 && pending ? pending.shipping_charged_cents : input.shipping;
  const tax = input.tax === 0 && pending ? pending.tax_collected_cents : input.tax;
  const extraDiscount = input.extraDiscount === 0 && pending ? pending.discounts_cents : input.extraDiscount;
  await put(db, counts, {
    channel: 'stripe_direct',
    source_id: input.sourceId,
    line_id: lineId,
    date: input.date,
    order_id: input.orderId,
    sku: null,
    product: 'Order fees',
    variant: null,
    qty: 0,
    gross_cents: 0,
    discounts_cents: extraDiscount,
    shipping_charged_cents: shipping,
    tax_collected_cents: tax,
    platform_fee_cents: 0,
    processor_fee_cents: input.processor,
    shipping_label_cost_cents: null,
    refunds_cents: 0,
    chargebacks_cents: 0,
    payout_id: input.payoutId ?? null,
    payout_date: input.payoutDate ?? null,
    source_url: input.url,
    source_tag: 'stripe_api',
    status: input.payoutId ? 'paid_out' : 'open',
    row_kind: 'order_fee',
    link_charge_id: input.refs.charge,
    link_payment_intent: input.refs.pi,
    raw_json: input.raw,
  }, input.importedAt);
}

function chargeIsJup(rec: Rec, dedupeShopify: boolean): boolean {
  const metadata = metadataOf(rec.metadata);
  const brand = metadataBrand(metadata);
  if (brand && brand !== 'juplife') return false;
  if (dedupeShopify && isShopifyOrigin({ metadata, description: str(rec.description) })) return false;
  if (brand === 'juplife') return true;
  const pi = asRec(rec.payment_intent);
  const piBrand = metadataBrand(metadataOf(pi?.metadata));
  if (piBrand && piBrand !== 'juplife') return false;
  return piBrand === 'juplife';
}

export async function ingestStripeChargeRefund(
  db: D1Database,
  charge: unknown,
  opts: StripeIngestOpts,
): Promise<IngestCounts> {
  const counts = emptyCounts();
  const rec = asRec(charge);
  if (!rec) {
    counts.dropped += 1;
    return counts;
  }
  const chargeId = str(rec.id);
  const pi = idOf(rec.payment_intent);
  const metadata = metadataOf(rec.metadata);
  const brand = metadataBrand(metadata);
  if (brand && brand !== 'juplife') {
    counts.dropped += 1;
    log('stripe_drop', { reason: 'brand', id: chargeId ?? '' });
    return counts;
  }
  if (opts.dedupeShopify && isShopifyOrigin({ metadata, description: str(rec.description) })) {
    counts.dropped += 1;
    log('stripe_drop', { reason: 'shopify_dedupe', id: chargeId ?? '' });
    return counts;
  }
  const linked = await findOrderId(db, chargeId, pi);
  if (!linked && brand !== 'juplife') {
    counts.dropped += 1;
    log('stripe_drop', { reason: 'brand', id: chargeId ?? '' });
    return counts;
  }
  const orderId = linked ?? chargeId ?? pi ?? 'unknown';
  const refunds = asRec(rec.refunds);
  const rows = Array.isArray(refunds?.data) ? refunds.data : [];
  for (const item of rows) {
    const refund = asRec(item);
    if (!refund) continue;
    const refundId = str(refund.id);
    const created = num(refund.created);
    const amount = num(refund.amount);
    if (!refundId || created === null || amount === null) continue;
    const bt = asRec(refund.balance_transaction);
    const fee = bt ? num(bt.fee) : null;
    const raw = JSON.stringify(refund);
    if (fee !== null && fee < 0) {
      await put(db, counts, refundRow(refundId, orderId, etDate(created), amount, 0, chargeId, pi, raw), opts.importedAt);
      await put(db, counts, {
        channel: 'stripe_direct',
        source_id: refundId,
        line_id: 'fee_reversal',
        date: etDate(created),
        order_id: orderId,
        sku: null,
        product: 'Refunded processor fee',
        variant: null,
        qty: null,
        gross_cents: 0,
        discounts_cents: 0,
        shipping_charged_cents: 0,
        tax_collected_cents: 0,
        platform_fee_cents: 0,
        processor_fee_cents: fee,
        shipping_label_cost_cents: null,
        refunds_cents: 0,
        chargebacks_cents: 0,
        payout_id: null,
        payout_date: null,
        source_url: chargeId ? `https://dashboard.stripe.com/payments/${chargeId}` : null,
        source_tag: 'stripe_api',
        status: 'refunded',
        row_kind: 'fee_reversal',
        link_charge_id: chargeId,
        link_payment_intent: pi,
        raw_json: raw,
      }, opts.importedAt);
    } else {
      await put(db, counts, refundRow(refundId, orderId, etDate(created), amount, fee, chargeId, pi, raw), opts.importedAt);
    }
  }
  return counts;
}

function refundRow(
  refundId: string,
  orderId: string,
  date: string,
  amount: number,
  processor: number | null,
  chargeId: string | null,
  pi: string | null,
  raw: string,
): EntryInput {
  return {
    channel: 'stripe_direct',
    source_id: refundId,
    line_id: refundId,
    date,
    order_id: orderId,
    sku: null,
    product: 'Refund',
    variant: null,
    qty: null,
    gross_cents: 0,
    discounts_cents: 0,
    shipping_charged_cents: 0,
    tax_collected_cents: 0,
    platform_fee_cents: 0,
    processor_fee_cents: processor,
    shipping_label_cost_cents: null,
    refunds_cents: amount,
    chargebacks_cents: 0,
    payout_id: null,
    payout_date: null,
    source_url: chargeId ? `https://dashboard.stripe.com/payments/${chargeId}` : null,
    source_tag: 'stripe_api',
    status: 'refunded',
    row_kind: 'refund',
    link_charge_id: chargeId,
    link_payment_intent: pi,
    raw_json: raw,
  };
}

export async function ingestStripeDispute(db: D1Database, dispute: unknown, opts: StripeIngestOpts): Promise<IngestCounts> {
  const counts = emptyCounts();
  const rec = asRec(dispute);
  if (!rec) {
    counts.dropped += 1;
    return counts;
  }
  const id = str(rec.id);
  const chargeId = idOf(rec.charge);
  const created = num(rec.created);
  const amount = num(rec.amount);
  if (!id || created === null || amount === null) {
    counts.dropped += 1;
    return counts;
  }
  const orderId = await findOrderId(db, chargeId, null);
  if (!orderId) {
    counts.dropped += 1;
    log('stripe_drop', { reason: 'brand', id });
    return counts;
  }
  const txns = Array.isArray(rec.balance_transactions) ? rec.balance_transactions : [];
  let fee: number | null = txns.length === 0 ? null : 0;
  for (const txn of txns) {
    const row = asRec(txn);
    const part = row ? num(row.fee) : null;
    if (part === null) fee = null;
    else if (fee !== null) fee += part;
  }
  await put(db, counts, {
    channel: 'stripe_direct',
    source_id: id,
    line_id: id,
    date: etDate(created),
    order_id: orderId,
    sku: null,
    product: 'Chargeback',
    variant: null,
    qty: null,
    gross_cents: -amount,
    discounts_cents: 0,
    shipping_charged_cents: 0,
    tax_collected_cents: 0,
    platform_fee_cents: fee === null ? null : 0,
    processor_fee_cents: fee === null ? null : 0,
    shipping_label_cost_cents: null,
    refunds_cents: 0,
    chargebacks_cents: fee,
    payout_id: null,
    payout_date: null,
    source_url: chargeId ? `https://dashboard.stripe.com/payments/${chargeId}` : null,
    source_tag: 'stripe_api',
    status: 'disputed',
    row_kind: 'chargeback',
    link_charge_id: chargeId,
    link_payment_intent: null,
    raw_json: JSON.stringify(rec),
  }, opts.importedAt);
  return counts;
}

export async function ingestStripePayout(db: D1Database, payout: unknown, importedAt: string): Promise<IngestCounts> {
  const counts = emptyCounts();
  const rec = asRec(payout);
  if (!rec) {
    counts.dropped += 1;
    return counts;
  }
  const id = str(rec.id);
  const amount = num(rec.amount);
  const arrival = num(rec.arrival_date) ?? num(rec.created);
  if (!id || amount === null || arrival === null) {
    counts.dropped += 1;
    return counts;
  }
  if ((str(rec.currency) ?? 'usd').toLowerCase() !== 'usd') {
    counts.dropped += 1;
    log('stripe_drop', { reason: 'non_usd', id });
    return counts;
  }
  const inserted = await recordPayout(db, 'stripe_direct', id, etDate(arrival), amount, 'usd', JSON.stringify(rec), importedAt);
  if (inserted) counts.stored += 1;
  else counts.duplicate += 1;
  return counts;
}

async function dispatch(db: D1Database, type: StripeEventName, obj: Rec, opts: StripeIngestOpts): Promise<IngestCounts> {
  switch (type) {
    case 'checkout.session.completed':
      return ingestStripeSession(db, obj, opts);
    case 'charge.refunded':
      return ingestStripeChargeRefund(db, obj, opts);
    case 'charge.dispute.created':
      return ingestStripeDispute(db, obj, opts);
    case 'payout.paid':
      return ingestStripePayout(db, obj, opts.importedAt);
    default: {
      const neverType: never = type;
      return neverType;
    }
  }
}

export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  const ok = await verifyStripeSignature(raw, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET ?? '');
  if (!ok) return json({ ok: false, error: 'invalid signature' }, 400);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: 'bad payload' }, 400);
  }
  const event = asRec(parsed);
  const type = str(event?.type);
  const obj = asRec(asRec(event?.data)?.object);
  if (!type || !obj) return json({ ok: false, error: 'bad payload' }, 400);
  if (!isStripeEvent(type)) return json({ ok: true, stored: 0, duplicate: 0, dropped: 0 });
  const counts = await dispatch(env.DB, type, obj, {
    allowlist: priceAllowlist(env.JUP_PRICE_IDS),
    dedupeShopify: shopifyOnStripe(env.SHOPIFY_ON_STRIPE),
    importedAt: nowIso(),
  });
  return json({ ok: true, ...counts });
}

async function eachStripePage(
  key: string,
  path: string,
  query: URLSearchParams,
  visit: (row: Rec) => Promise<void>,
): Promise<void> {
  let starting: string | null = null;
  for (let page = 0; page < 200; page += 1) {
    const params = new URLSearchParams(query);
    if (starting) params.set('starting_after', starting);
    const body = asRec(await stripeGet(key, `${path}?${params.toString()}`));
    const data = Array.isArray(body?.data) ? body.data : [];
    const rows = data.map(asRec).filter((row): row is Rec => row !== null);
    for (const row of rows) await visit(row);
    if (body?.has_more !== true) return;
    const last = str(rows[rows.length - 1]?.id);
    if (!last) return;
    starting = last;
  }
}

async function applyBalanceTransaction(
  env: Env,
  bt: Rec,
  opts: StripeIngestOpts,
): Promise<void> {
  const btId = str(bt.id);
  if (!btId) return;
  const sourceId = idOf(bt.source);
  const payoutId = idOf(bt.payout);
  const fee = num(bt.fee);
  const created = num(bt.created);
  const type = str(bt.type);
  const category = str(bt.reporting_category);
  if (!sourceId || created === null) return;
  const payoutDate = payoutId ? etDate(created) : null;
  if (type === 'payout') return;

  if (type === 'charge' || category === 'charge') {
    let orderId = await findOrderId(env.DB, sourceId, null);
    if (!orderId && env.STRIPE_READ_KEY) {
      let charge: Rec | null = null;
      try {
        charge = asRec(await stripeGet(env.STRIPE_READ_KEY, `/v1/charges/${sourceId}`));
      } catch (error) {
        log('stripe_charge_read_failed', { id: sourceId, message: error instanceof Error ? error.message : 'error' });
        return;
      }
      if (!charge || !chargeIsJup(charge, opts.dedupeShopify)) {
        log('stripe_drop', { reason: 'brand', id: sourceId });
        return;
      }
      const pi = idOf(charge.payment_intent);
      orderId = await findOrderId(env.DB, sourceId, pi);
      if (!orderId) {
        const amount = num(charge.amount) ?? num(bt.amount) ?? 0;
        const raw = JSON.stringify(charge);
        const counts = emptyCounts();
        await put(env.DB, counts, saleRow({
          sourceId,
          lineId: 'charge',
          date: etDate(num(charge.created) ?? created),
          orderId: sourceId,
          sku: null,
          product: str(charge.description) ?? 'Stripe charge',
          variant: null,
          qty: 1,
          gross: amount,
          discount: 0,
          refs: { pi, charge: sourceId },
          raw,
          url: stripeUrl({ pi, charge: sourceId }),
        }), opts.importedAt);
        orderId = sourceId;
      }
    }
    if (!orderId) {
      log('stripe_drop', { reason: 'brand', id: sourceId });
      return;
    }
    if (fee !== null) {
      const counts = emptyCounts();
      await putOrderFee(env.DB, counts, {
        sourceId: orderId,
        orderId,
        date: etDate(created),
        shipping: 0,
        tax: 0,
        extraDiscount: 0,
        processor: fee,
        refs: { pi: null, charge: sourceId },
        raw: JSON.stringify(bt),
        url: stripeUrl({ pi: null, charge: sourceId }),
        importedAt: opts.importedAt,
        payoutId,
        payoutDate,
      });
    }
    if (payoutId && payoutDate) await putPayoutLink(env.DB, orderId, btId, payoutId, payoutDate, JSON.stringify(bt), opts.importedAt);
    return;
  }

  if (category === 'dispute_reversal') {
    const known = await env.DB
      .prepare(`SELECT order_id FROM entries WHERE channel = 'stripe_direct' AND source_id = ? AND row_kind = 'chargeback' LIMIT 1`)
      .bind(sourceId)
      .first<{ order_id: string }>();
    if (!known) {
      log('stripe_drop', { reason: 'brand', id: sourceId });
      return;
    }
    const amount = num(bt.amount) ?? 0;
    await insertEntry(env.DB, {
      channel: 'stripe_direct',
      source_id: btId,
      line_id: 'reversal',
      date: etDate(created),
      order_id: known.order_id,
      sku: null,
      product: 'Dispute reversal',
      variant: null,
      qty: null,
      gross_cents: amount,
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
      source_tag: 'stripe_api',
      status: 'paid_out',
      row_kind: 'dispute_reversal',
      link_charge_id: null,
      link_payment_intent: null,
      raw_json: JSON.stringify(bt),
    }, opts.importedAt);
  }
}

async function putPayoutLink(
  db: D1Database,
  orderId: string,
  btId: string,
  payoutId: string,
  payoutDate: string,
  raw: string,
  importedAt: string,
): Promise<void> {
  await insertEntry(db, {
    channel: 'stripe_direct',
    source_id: btId,
    line_id: 'payout',
    date: payoutDate,
    order_id: orderId,
    sku: null,
    product: null,
    variant: null,
    qty: null,
    gross_cents: 0,
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
    source_tag: 'stripe_api',
    status: 'paid_out',
    row_kind: 'payout_link',
    link_charge_id: null,
    link_payment_intent: null,
    raw_json: raw,
  }, importedAt);
}

export async function backfillStripe(env: Env, opts: { full: boolean }): Promise<void> {
  const key = env.STRIPE_READ_KEY;
  if (!key) {
    log('stripe_backfill_skip', { reason: 'no_key' });
    return;
  }
  const importedAt = nowIso();
  const ingestOpts: StripeIngestOpts = {
    allowlist: priceAllowlist(env.JUP_PRICE_IDS),
    dedupeShopify: shopifyOnStripe(env.SHOPIFY_ON_STRIPE),
    importedAt,
  };
  const cursor = opts.full ? null : await readCursor(env.DB, 'stripe_created_gte');
  const gte = cursor ?? '0';
  const sessionQuery = new URLSearchParams({ limit: '100' });
  sessionQuery.set('created[gte]', gte);
  sessionQuery.append('expand[]', 'data.line_items');
  sessionQuery.append('expand[]', 'data.payment_intent');
  await eachStripePage(key, '/v1/checkout/sessions', sessionQuery, async (row) => {
    await ingestStripeSession(env.DB, row, ingestOpts);
  });
  const btQuery = new URLSearchParams({ limit: '100' });
  btQuery.set('created[gte]', gte);
  await eachStripePage(key, '/v1/balance_transactions', btQuery, async (row) => {
    await applyBalanceTransaction(env, row, ingestOpts);
  });
  const payoutQuery = new URLSearchParams({ limit: '100', status: 'paid' });
  await eachStripePage(key, '/v1/payouts', payoutQuery, async (row) => {
    await ingestStripePayout(env.DB, row, importedAt);
  });
  await reconcileStoredPayouts(env, opts.full);
  await writeCursor(env.DB, 'stripe_created_gte', String(Math.floor(Date.now() / 1000)), importedAt);
}

async function reconcileStoredPayouts(env: Env, postScan: boolean): Promise<void> {
  const rows = await env.DB
    .prepare(`SELECT payout_id, payout_date, amount_cents, raw_json FROM payouts WHERE channel = 'stripe_direct'`)
    .all<{ payout_id: string; payout_date: string; amount_cents: number; raw_json: string | null }>();
  for (const payout of rows.results) {
    await reconcilePayout(
      env.DB,
      'stripe_direct',
      payout.payout_id,
      payout.payout_date,
      payout.amount_cents,
      payout.raw_json,
      nowIso(),
      postScan,
    );
  }
}
