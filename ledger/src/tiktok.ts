import { etDate, nowIso } from './dates';
import { emptyCounts, insertEntry, type EntryInput, type IngestCounts } from './db';
import { dollarsToCents } from './money';
import { recordPayout, reconcilePayout } from './reconcile';

// Provisional Seller Center headers. No sample export was available.
// This is the only column map. Adjust it when a real file shows up.
export const TIKTOK_COLUMNS = {
  orders: {
    order_id: ['Order ID'],
    line_id: ['SKU ID', 'Seller SKU'],
    sku: ['Seller SKU', 'SKU ID'],
    product: ['Product Name'],
    variant: ['Variation', 'SKU Variation'],
    qty: ['Quantity'],
    created: ['Paid Time', 'Created Time', 'Order Created Time'],
    status: ['Order Status'],
    gross_total: ['SKU Subtotal Before Discount', 'SKU Subtotal'],
    unit_price: ['SKU Unit Original Price', 'SKU Unit Price'],
    discounts: ['SKU Platform Discount', 'SKU Seller Discount', 'SKU Discount'],
    shipping: ['Shipping Fee After Discount', 'Shipping Fee'],
    tax: ['Taxes', 'Tax'],
  },
  settlement: {
    order_id: ['Related order ID', 'Order ID', 'Order/adjustment ID'],
    line_id: ['Statement ID', 'Settlement ID', 'Order/adjustment ID'],
    date: ['Statement Date', 'Settlement Date', 'Order settled time'],
    platform_fee: ['Platform commission', 'Platform Commission', 'Affiliate commission'],
    processor_fee: ['Transaction fee', 'Payment fee', 'Transaction Fee'],
    shipping_label: ['Shipping fee', 'Actual shipping fee'],
    settlement: ['Settlement Amount', 'Total settlement amount', 'Settlement amount'],
    subsidy: ['Platform discount rebate', 'Shipping subsidy', 'Customer shipping fee offset'],
  },
} as const;

export type TikTokKind = 'orders' | 'settlement';

type DraftLine = {
  lineId: string;
  sku: string | null;
  product: string | null;
  variant: string | null;
  qty: number;
  gross: number;
  discount: number;
  shipping: number;
  tax: number;
  date: string;
  raw: string;
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

function headerIndex(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((header, index) => map.set(header.trim().toLowerCase(), index));
  return map;
}

function cell(map: Map<string, number>, row: string[], names: readonly string[]): string | null {
  for (const name of names) {
    const index = map.get(name.toLowerCase());
    if (index === undefined) continue;
    const value = row[index]?.trim() ?? '';
    if (value) return value;
  }
  return null;
}

function sumMoney(map: Map<string, number>, row: string[], names: readonly string[]): number | null {
  let seen = false;
  let total = 0;
  for (const name of names) {
    const index = map.get(name.toLowerCase());
    if (index === undefined) continue;
    const cents = dollarsToCents(row[index] ?? '');
    if (cents === null) continue;
    seen = true;
    total += cents;
  }
  return seen ? total : null;
}

function calendarDate(raw: string | null): string {
  if (!raw) return etDate(new Date());
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return etDate(new Date(parsed));
  return etDate(new Date());
}

async function put(db: D1Database, counts: IngestCounts, row: EntryInput, importedAt: string): Promise<void> {
  const inserted = await insertEntry(db, row, importedAt);
  if (inserted) counts.stored += 1;
  else counts.duplicate += 1;
}

export async function importTikTok(db: D1Database, csv: string, kind: TikTokKind, importedAt = nowIso()): Promise<IngestCounts> {
  if (kind === 'orders') return importOrders(db, csv, importedAt);
  return importSettlement(db, csv, importedAt);
}

async function importOrders(db: D1Database, csv: string, importedAt: string): Promise<IngestCounts> {
  const counts = emptyCounts();
  const table = parseCsv(csv);
  const headers = table[0];
  if (!headers) return counts;
  const map = headerIndex(headers);
  const grouped = new Map<string, DraftLine[]>();
  for (const row of table.slice(1)) {
    const status = (cell(map, row, TIKTOK_COLUMNS.orders.status) ?? '').toLowerCase();
    if (status.includes('cancel')) continue;
    const orderId = cell(map, row, TIKTOK_COLUMNS.orders.order_id);
    if (!orderId) continue;
    const qty = Number(cell(map, row, TIKTOK_COLUMNS.orders.qty) ?? '1');
    const safeQty = Number.isFinite(qty) ? qty : 0;
    const grossTotal = sumMoney(map, row, TIKTOK_COLUMNS.orders.gross_total);
    const unit = sumMoney(map, row, TIKTOK_COLUMNS.orders.unit_price);
    const gross = grossTotal ?? (unit !== null ? unit * safeQty : 0);
    const draft: DraftLine = {
      lineId: cell(map, row, TIKTOK_COLUMNS.orders.line_id) ?? `line:${grouped.get(orderId)?.length ?? 0}`,
      sku: cell(map, row, TIKTOK_COLUMNS.orders.sku),
      product: cell(map, row, TIKTOK_COLUMNS.orders.product),
      variant: cell(map, row, TIKTOK_COLUMNS.orders.variant),
      qty: safeQty,
      gross,
      discount: sumMoney(map, row, TIKTOK_COLUMNS.orders.discounts) ?? 0,
      shipping: sumMoney(map, row, TIKTOK_COLUMNS.orders.shipping) ?? 0,
      tax: sumMoney(map, row, TIKTOK_COLUMNS.orders.tax) ?? 0,
      date: calendarDate(cell(map, row, TIKTOK_COLUMNS.orders.created)),
      raw: JSON.stringify(Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))),
    };
    const list = grouped.get(orderId) ?? [];
    list.push(draft);
    grouped.set(orderId, list);
  }
  for (const [orderId, lines] of grouped) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      await put(db, counts, {
        channel: 'tiktok',
        source_id: orderId,
        line_id: line.lineId,
        date: line.date,
        order_id: orderId,
        sku: line.sku,
        product: line.product,
        variant: line.variant,
        qty: line.qty,
        gross_cents: line.gross,
        discounts_cents: line.discount,
        shipping_charged_cents: index === 0 ? line.shipping : 0,
        tax_collected_cents: index === 0 ? line.tax : 0,
        platform_fee_cents: 0,
        processor_fee_cents: 0,
        shipping_label_cost_cents: null,
        refunds_cents: 0,
        chargebacks_cents: 0,
        payout_id: null,
        payout_date: null,
        source_url: null,
        source_tag: 'csv_import',
        status: 'open',
        row_kind: 'sale',
        link_charge_id: null,
        link_payment_intent: null,
        raw_json: line.raw,
      }, importedAt);
    }
    const first = lines[0];
    if (!first) continue;
    await put(db, counts, {
      channel: 'tiktok',
      source_id: orderId,
      line_id: '_order_fee',
      date: first.date,
      order_id: orderId,
      sku: null,
      product: 'Order fees',
      variant: null,
      qty: 0,
      gross_cents: 0,
      discounts_cents: 0,
      shipping_charged_cents: 0,
      tax_collected_cents: 0,
      platform_fee_cents: null,
      processor_fee_cents: null,
      shipping_label_cost_cents: null,
      refunds_cents: 0,
      chargebacks_cents: 0,
      payout_id: null,
      payout_date: null,
      source_url: null,
      source_tag: 'csv_import',
      status: 'open',
      row_kind: 'order_fee',
      link_charge_id: null,
      link_payment_intent: null,
      raw_json: first.raw,
    }, importedAt);
  }
  return counts;
}

async function importSettlement(db: D1Database, csv: string, importedAt: string): Promise<IngestCounts> {
  const counts = emptyCounts();
  const table = parseCsv(csv);
  const headers = table[0];
  if (!headers) return counts;
  const map = headerIndex(headers);
  const cols = TIKTOK_COLUMNS.settlement;
  for (const row of table.slice(1)) {
    const orderId = cell(map, row, cols.order_id);
    if (!orderId) continue;
    const statementId = cell(map, row, cols.line_id) ?? orderId;
    const date = calendarDate(cell(map, row, cols.date));
    const platform = sumMoney(map, row, cols.platform_fee);
    const processor = sumMoney(map, row, cols.processor_fee);
    const label = sumMoney(map, row, cols.shipping_label);
    const settlement = sumMoney(map, row, cols.settlement);
    const subsidy = sumMoney(map, row, cols.subsidy);
    const raw = JSON.stringify(Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
    if (platform !== null || processor !== null) {
      await put(db, counts, {
        channel: 'tiktok',
        source_id: orderId,
        line_id: '_order_fee_settled',
        date,
        order_id: orderId,
        sku: null,
        product: 'Order fees',
        variant: null,
        qty: 0,
        gross_cents: 0,
        discounts_cents: 0,
        shipping_charged_cents: 0,
        tax_collected_cents: 0,
        platform_fee_cents: platform,
        processor_fee_cents: processor,
        shipping_label_cost_cents: label,
        refunds_cents: 0,
        chargebacks_cents: 0,
        payout_id: settlement !== null ? statementId : null,
        payout_date: settlement !== null ? date : null,
        source_url: null,
        source_tag: 'tiktok_settlement',
        status: 'paid_out',
        row_kind: 'order_fee',
        link_charge_id: null,
        link_payment_intent: null,
        raw_json: raw,
      }, importedAt);
    }
    if (subsidy !== null && subsidy !== 0) {
      await put(db, counts, {
        channel: 'tiktok',
        source_id: statementId,
        line_id: 'subsidy',
        date,
        order_id: orderId,
        sku: null,
        product: 'Platform subsidy',
        variant: null,
        qty: null,
        gross_cents: subsidy,
        discounts_cents: 0,
        shipping_charged_cents: 0,
        tax_collected_cents: 0,
        platform_fee_cents: 0,
        processor_fee_cents: 0,
        shipping_label_cost_cents: null,
        refunds_cents: 0,
        chargebacks_cents: 0,
        payout_id: settlement !== null ? statementId : null,
        payout_date: settlement !== null ? date : null,
        source_url: null,
        source_tag: 'tiktok_settlement',
        status: 'paid_out',
        row_kind: 'subsidy',
        link_charge_id: null,
        link_payment_intent: null,
        raw_json: raw,
      }, importedAt);
    }
    if (settlement !== null) {
      await recordPayout(db, 'tiktok', statementId, date, settlement, 'usd', raw, importedAt);
      await put(db, counts, {
        channel: 'tiktok',
        source_id: statementId,
        line_id: 'payout',
        date,
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
        payout_id: statementId,
        payout_date: date,
        source_url: null,
        source_tag: 'tiktok_settlement',
        status: 'paid_out',
        row_kind: 'payout_link',
        link_charge_id: null,
        link_payment_intent: null,
        raw_json: raw,
      }, importedAt);
      await reconcilePayout(db, 'tiktok', statementId, date, settlement, raw, importedAt, true);
    }
  }
  return counts;
}
