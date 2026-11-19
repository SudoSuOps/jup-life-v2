import { dollarsToCents } from './money';
import { etDate, nowIso } from './dates';
import { emptyCounts, insertEntry, readCursor, writeCursor, type EntryInput, type IngestCounts } from './db';
import type { Env } from './env';
import { json } from './http';
import { log } from './log';
import { verifyShopifyHmac } from './signatures';

const TOPICS = ['orders/paid', 'refunds/create'] as const;
type ShopifyTopic = (typeof TOPICS)[number];

type Rec = Record<string, unknown>;

export type NormalizedLine = {
  id: string;
  sku: string | null;
  product: string | null;
  variant: string | null;
  qty: number;
  grossCents: number;
  discountCents: number;
};

export type NormalizedOrder = {
  id: string;
  name: string;
  createdAt: string;
  currency: string;
  lines: NormalizedLine[];
  shippingCents: number;
  taxCents: number;
  extraDiscountCents: number;
  processorFeeCents: number | null;
  platformFeeCents: number | null;
  raw: string;
};

export type NormalizedRefund = {
  id: string;
  orderId: string;
  createdAt: string;
  lines: Array<{ id: string; amountCents: number }>;
  raw: string;
};

function asRec(value: unknown): Rec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Rec;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function shopifyId(id: string | number): string {
  const text = String(id);
  const match = text.match(/(\d+)$/);
  return match?.[1] ?? text;
}

function moneyAmount(value: unknown): number | null {
  if (typeof value === 'number' || typeof value === 'string') return dollarsToCents(value);
  const rec = asRec(value);
  if (!rec) return null;
  const shop = asRec(rec.shop_money) ?? asRec(rec.shopMoney);
  if (shop && (typeof shop.amount === 'string' || typeof shop.amount === 'number')) return dollarsToCents(shop.amount);
  if (typeof rec.amount === 'string' || typeof rec.amount === 'number') return dollarsToCents(rec.amount);
  return null;
}

function isTopic(value: string): value is ShopifyTopic {
  return (TOPICS as readonly string[]).includes(value);
}

async function put(db: D1Database, counts: IngestCounts, row: EntryInput, importedAt: string): Promise<void> {
  const inserted = await insertEntry(db, row, importedAt);
  if (inserted) counts.stored += 1;
  else counts.duplicate += 1;
}

export async function ingestShopifyOrder(db: D1Database, order: NormalizedOrder, shop: string, importedAt: string): Promise<IngestCounts> {
  const counts = emptyCounts();
  if (order.currency.toLowerCase() !== 'usd') {
    counts.dropped += 1;
    log('shopify_drop', { reason: 'non_usd', id: order.id });
    return counts;
  }
  const date = etDate(order.createdAt);
  const url = `https://${shop}/admin/orders/${order.id}`;
  for (const line of order.lines) {
    await put(db, counts, {
      channel: 'shopify',
      source_id: order.id,
      line_id: line.id,
      date,
      order_id: order.id,
      sku: line.sku,
      product: line.product,
      variant: line.variant,
      qty: line.qty,
      gross_cents: line.grossCents,
      discounts_cents: line.discountCents,
      shipping_charged_cents: 0,
      tax_collected_cents: 0,
      platform_fee_cents: 0,
      processor_fee_cents: 0,
      shipping_label_cost_cents: null,
      refunds_cents: 0,
      chargebacks_cents: 0,
      payout_id: null,
      payout_date: null,
      source_url: url,
      source_tag: 'shopify_api',
      status: 'open',
      row_kind: 'sale',
      link_charge_id: null,
      link_payment_intent: null,
      raw_json: order.raw,
    }, importedAt);
  }
  const feeKnown = order.processorFeeCents !== null && order.platformFeeCents !== null;
  const pending = await db
    .prepare(`SELECT 1 AS ok FROM entries WHERE channel = 'shopify' AND source_id = ? AND line_id = '_order_fee' LIMIT 1`)
    .bind(order.id)
    .first<{ ok: number }>();
  const lineId = pending && feeKnown ? '_order_fee_settled' : '_order_fee';
  if (!(lineId === '_order_fee' && !feeKnown && pending)) {
    await put(db, counts, {
      channel: 'shopify',
      source_id: order.id,
      line_id: lineId,
      date,
      order_id: order.id,
      sku: null,
      product: 'Order fees',
      variant: null,
      qty: 0,
      gross_cents: 0,
      discounts_cents: order.extraDiscountCents,
      shipping_charged_cents: order.shippingCents,
      tax_collected_cents: order.taxCents,
      platform_fee_cents: order.platformFeeCents,
      processor_fee_cents: order.processorFeeCents,
      shipping_label_cost_cents: null,
      refunds_cents: 0,
      chargebacks_cents: 0,
      payout_id: null,
      payout_date: null,
      source_url: url,
      source_tag: 'shopify_api',
      status: 'open',
      row_kind: 'order_fee',
      link_charge_id: null,
      link_payment_intent: null,
      raw_json: order.raw,
    }, importedAt);
  }
  return counts;
}

export async function ingestShopifyRefund(db: D1Database, refund: NormalizedRefund, shop: string, importedAt: string): Promise<IngestCounts> {
  const counts = emptyCounts();
  const date = etDate(refund.createdAt);
  const url = `https://${shop}/admin/orders/${refund.orderId}`;
  const lines = refund.lines.length > 0 ? refund.lines : [];
  if (lines.length === 0) {
    counts.dropped += 1;
    return counts;
  }
  for (const line of lines) {
    await put(db, counts, {
      channel: 'shopify',
      source_id: refund.id,
      line_id: line.id,
      date,
      order_id: refund.orderId,
      sku: null,
      product: 'Refund',
      variant: null,
      qty: null,
      gross_cents: 0,
      discounts_cents: 0,
      shipping_charged_cents: 0,
      tax_collected_cents: 0,
      platform_fee_cents: 0,
      processor_fee_cents: 0,
      shipping_label_cost_cents: null,
      refunds_cents: line.amountCents,
      chargebacks_cents: 0,
      payout_id: null,
      payout_date: null,
      source_url: url,
      source_tag: 'shopify_api',
      status: 'refunded',
      row_kind: 'refund',
      link_charge_id: null,
      link_payment_intent: null,
      raw_json: refund.raw,
    }, importedAt);
  }
  return counts;
}

export function orderFromRest(body: unknown): NormalizedOrder | null {
  const rec = asRec(body);
  if (!rec || rec.id === undefined || !str(rec.created_at)) return null;
  const lineItems = Array.isArray(rec.line_items) ? rec.line_items : [];
  const lines: NormalizedLine[] = [];
  let lineDiscount = 0;
  for (const item of lineItems) {
    const line = asRec(item);
    if (!line || line.id === undefined) continue;
    const qty = typeof line.quantity === 'number' ? line.quantity : Number(line.quantity ?? 0);
    const unit = dollarsToCents(typeof line.price === 'string' || typeof line.price === 'number' ? line.price : null) ?? 0;
    const discount = dollarsToCents(typeof line.total_discount === 'string' || typeof line.total_discount === 'number' ? line.total_discount : null) ?? 0;
    lineDiscount += discount;
    lines.push({
      id: shopifyId(line.id as string | number),
      sku: str(line.sku),
      product: str(line.title),
      variant: str(line.variant_title),
      qty: Number.isFinite(qty) ? qty : 0,
      grossCents: unit * (Number.isFinite(qty) ? qty : 0),
      discountCents: discount,
    });
  }
  const shipping = moneyAmount(rec.total_shipping_price_set) ?? sumShipping(rec.shipping_lines);
  const tax = dollarsToCents(typeof rec.total_tax === 'string' || typeof rec.total_tax === 'number' ? rec.total_tax : null) ?? 0;
  const totalDiscount = dollarsToCents(typeof rec.total_discounts === 'string' || typeof rec.total_discounts === 'number' ? rec.total_discounts : null) ?? lineDiscount;
  return {
    id: shopifyId(rec.id as string | number),
    name: str(rec.name) ?? shopifyId(rec.id as string | number),
    createdAt: str(rec.created_at) ?? '',
    currency: (str(rec.currency) ?? 'USD').toLowerCase(),
    lines,
    shippingCents: shipping,
    taxCents: tax,
    extraDiscountCents: Math.max(0, totalDiscount - lineDiscount),
    processorFeeCents: null,
    platformFeeCents: null,
    raw: JSON.stringify(rec),
  };
}

function sumShipping(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  let total = 0;
  for (const item of value) {
    const line = asRec(item);
    const amount = line ? dollarsToCents(typeof line.price === 'string' || typeof line.price === 'number' ? line.price : null) : null;
    if (amount !== null) total += amount;
  }
  return total;
}

export function refundFromRest(body: unknown): NormalizedRefund | null {
  const rec = asRec(body);
  if (!rec || rec.id === undefined || rec.order_id === undefined || !str(rec.created_at)) return null;
  const lines: Array<{ id: string; amountCents: number }> = [];
  const items = Array.isArray(rec.refund_line_items) ? rec.refund_line_items : [];
  for (const item of items) {
    const line = asRec(item);
    if (!line || line.id === undefined) continue;
    const amount = dollarsToCents(typeof line.subtotal === 'string' || typeof line.subtotal === 'number' ? line.subtotal : null) ?? 0;
    lines.push({ id: shopifyId(line.id as string | number), amountCents: amount });
  }
  if (lines.length === 0) {
    const txns = Array.isArray(rec.transactions) ? rec.transactions : [];
    let total = 0;
    for (const item of txns) {
      const txn = asRec(item);
      if (!txn || str(txn.kind) !== 'refund') continue;
      if (str(txn.status) && str(txn.status) !== 'success') continue;
      total += dollarsToCents(typeof txn.amount === 'string' || typeof txn.amount === 'number' ? txn.amount : null) ?? 0;
    }
    if (total > 0) lines.push({ id: shopifyId(rec.id as string | number), amountCents: total });
  }
  return {
    id: shopifyId(rec.id as string | number),
    orderId: shopifyId(rec.order_id as string | number),
    createdAt: str(rec.created_at) ?? '',
    lines,
    raw: JSON.stringify(rec),
  };
}

function gqlMoney(value: unknown): number | null {
  const rec = asRec(value);
  const shop = asRec(rec?.shopMoney);
  if (!shop) return null;
  return dollarsToCents(typeof shop.amount === 'string' || typeof shop.amount === 'number' ? shop.amount : null);
}

function nodesOf(value: unknown): Rec[] {
  if (Array.isArray(value)) return value.map(asRec).filter((row): row is Rec => row !== null);
  const rec = asRec(value);
  if (!rec || !Array.isArray(rec.nodes)) return [];
  return rec.nodes.map(asRec).filter((row): row is Rec => row !== null);
}

export function orderFromGraphql(node: unknown): NormalizedOrder | null {
  const rec = asRec(node);
  if (!rec || !str(rec.id) || !str(rec.createdAt)) return null;
  const lines: NormalizedLine[] = [];
  let lineDiscount = 0;
  for (const line of nodesOf(rec.lineItems)) {
    if (!str(line.id)) continue;
    const qty = typeof line.quantity === 'number' ? line.quantity : 0;
    const unit = gqlMoney(line.originalUnitPriceSet) ?? 0;
    const discount = gqlMoney(line.totalDiscountSet) ?? 0;
    lineDiscount += discount;
    lines.push({
      id: shopifyId(str(line.id) ?? ''),
      sku: str(line.sku),
      product: str(line.name) ?? str(line.title),
      variant: str(line.variantTitle),
      qty,
      grossCents: unit * qty,
      discountCents: discount,
    });
  }
  let processor: number | null = null;
  for (const txn of nodesOf(rec.transactions)) {
    if (!Array.isArray(txn.fees)) continue;
    for (const fee of txn.fees) {
      const amount = gqlMoney(asRec(fee)?.amount) ?? dollarsToCents(str(asRec(asRec(fee)?.amount)?.amount));
      if (amount === null) continue;
      processor = (processor ?? 0) + amount;
    }
  }
  const totalDiscount = gqlMoney(rec.totalDiscountsSet) ?? lineDiscount;
  return {
    id: shopifyId(str(rec.id) ?? ''),
    name: str(rec.name) ?? shopifyId(str(rec.id) ?? ''),
    createdAt: str(rec.createdAt) ?? '',
    currency: (str(rec.currencyCode) ?? 'USD').toLowerCase(),
    lines,
    shippingCents: gqlMoney(rec.totalShippingPriceSet) ?? 0,
    taxCents: gqlMoney(rec.totalTaxSet) ?? 0,
    extraDiscountCents: Math.max(0, totalDiscount - lineDiscount),
    processorFeeCents: processor,
    platformFeeCents: processor === null ? null : 0,
    raw: JSON.stringify(rec),
  };
}

export function refundsFromGraphql(node: unknown): NormalizedRefund[] {
  const rec = asRec(node);
  if (!rec || !str(rec.id)) return [];
  const orderId = shopifyId(str(rec.id) ?? '');
  const out: NormalizedRefund[] = [];
  for (const refund of nodesOf(rec.refunds)) {
    if (!str(refund.id) || !str(refund.createdAt)) continue;
    const lines = nodesOf(refund.refundLineItems).map((line) => ({
      id: shopifyId(str(line.id) ?? ''),
      amountCents: gqlMoney(line.subtotalSet) ?? 0,
    }));
    if (lines.length === 0) {
      const total = gqlMoney(refund.totalRefundedSet);
      if (total) lines.push({ id: shopifyId(str(refund.id) ?? ''), amountCents: total });
    }
    out.push({
      id: shopifyId(str(refund.id) ?? ''),
      orderId,
      createdAt: str(refund.createdAt) ?? '',
      lines,
      raw: JSON.stringify(refund),
    });
  }
  return out;
}

export async function handleShopifyWebhook(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  const topicHeader = request.headers.get('X-Shopify-Topic');
  const shopHeader = request.headers.get('X-Shopify-Shop-Domain');
  if (shopHeader && shopHeader.toLowerCase() !== env.SHOPIFY_SHOP.toLowerCase()) {
    return json({ ok: false, error: 'unexpected shop' }, 401);
  }
  const ok = await verifyShopifyHmac(raw, request.headers.get('X-Shopify-Hmac-Sha256'), env.SHOPIFY_WEBHOOK_SECRET ?? '');
  if (!ok) return json({ ok: false, error: 'invalid signature' }, 401);
  if (!topicHeader || !isTopic(topicHeader)) return json({ ok: true, stored: 0, duplicate: 0, dropped: 0 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: 'bad payload' }, 400);
  }
  const importedAt = nowIso();
  const counts = await dispatchShopify(env, topicHeader, body, importedAt);
  return json({ ok: true, ...counts });
}

async function dispatchShopify(env: Env, topic: ShopifyTopic, body: unknown, importedAt: string): Promise<IngestCounts> {
  switch (topic) {
    case 'orders/paid': {
      const order = orderFromRest(body);
      if (!order) return { stored: 0, duplicate: 0, dropped: 1 };
      return ingestShopifyOrder(env.DB, order, env.SHOPIFY_SHOP, importedAt);
    }
    case 'refunds/create': {
      const refund = refundFromRest(body);
      if (!refund) return { stored: 0, duplicate: 0, dropped: 1 };
      return ingestShopifyRefund(env.DB, refund, env.SHOPIFY_SHOP, importedAt);
    }
    default: {
      const neverTopic: never = topic;
      return neverTopic;
    }
  }
}

const ORDERS_QUERY = `query LedgerOrders($cursor: String) {
  orders(first: 40, after: $cursor, sortKey: CREATED_AT, query: "financial_status:paid OR financial_status:partially_refunded OR financial_status:refunded") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      createdAt
      currencyCode
      totalDiscountsSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      totalTaxSet { shopMoney { amount } }
      lineItems(first: 60) {
        nodes { id sku name variantTitle quantity originalUnitPriceSet { shopMoney { amount } } totalDiscountSet { shopMoney { amount } } }
      }
      transactions { kind status }
      refunds {
        id
        createdAt
        totalRefundedSet { shopMoney { amount } }
        refundLineItems(first: 40) { nodes { id subtotalSet { shopMoney { amount } } } }
      }
    }
  }
}`;

export async function backfillShopify(env: Env, opts: { full: boolean }): Promise<void> {
  const token = env.SHOPIFY_ADMIN_TOKEN;
  if (!token) {
    log('shopify_backfill_skip', { reason: 'no_token' });
    return;
  }
  if (/\bmutation\b/i.test(ORDERS_QUERY)) throw new Error('shopify writes are blocked');
  const importedAt = nowIso();
  let cursor = opts.full ? null : await readCursor(env.DB, 'shopify_orders');
  for (let page = 0; page < 200; page += 1) {
    const payload = await shopifyGraphql(env, token, ORDERS_QUERY, { cursor });
    const data = asRec(asRec(payload)?.data);
    const orders = asRec(data?.orders);
    if (!orders) {
      log('shopify_backfill_error', { message: 'empty orders page' });
      return;
    }
    for (const node of nodesOf(orders.nodes)) {
      const order = orderFromGraphql(node);
      if (order) await ingestShopifyOrder(env.DB, order, env.SHOPIFY_SHOP, importedAt);
      for (const refund of refundsFromGraphql(node)) {
        await ingestShopifyRefund(env.DB, refund, env.SHOPIFY_SHOP, importedAt);
      }
    }
    const pageInfo = asRec(orders.pageInfo);
    const end = str(pageInfo?.endCursor);
    if (end) await writeCursor(env.DB, 'shopify_orders', end, importedAt);
    if (pageInfo?.hasNextPage !== true || !end) return;
    cursor = end;
  }
}

async function shopifyGraphql(env: Env, token: string, query: string, variables: { cursor: string | null }): Promise<unknown> {
  const response = await fetch(`https://${env.SHOPIFY_SHOP}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`shopify read failed ${response.status}`);
  const body = (await response.json()) as { errors?: unknown };
  if (body.errors) throw new Error('shopify graphql error');
  return body;
}
