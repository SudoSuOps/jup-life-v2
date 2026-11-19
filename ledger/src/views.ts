import { formatCents } from './money';

export type Table = {
  title: string;
  note: string;
  headers: string[];
  rows: string[][];
};

type SalesRow = {
  period: string;
  channel: string;
  sku: string;
  units: number;
  gross_cents: number;
  discounts_cents: number;
  fees_cents: number;
  pending_fees: number;
  refunds_cents: number;
  chargebacks_cents: number;
  net_cents: number;
  pending_nets: number;
};

const SALES_HEADERS = ['Period', 'Channel', 'SKU', 'Units', 'Gross', 'Discounts', 'Fees', 'Refunds', 'Chargebacks', 'Net'];

function money(cents: number | null, pending = false): string {
  if (pending) return 'PENDING';
  return formatCents(cents ?? 0);
}

function salesSql(periodExpr: string): string {
  return `SELECT
      ${periodExpr} AS period,
      channel,
      COALESCE(sku, '') AS sku,
      COALESCE(SUM(qty), 0) AS units,
      COALESCE(SUM(gross_cents), 0) AS gross_cents,
      COALESCE(SUM(discounts_cents), 0) AS discounts_cents,
      COALESCE(SUM(platform_fee_cents), 0) + COALESCE(SUM(processor_fee_cents), 0) AS fees_cents,
      COALESCE(SUM(CASE WHEN fees_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_fees,
      COALESCE(SUM(refunds_cents), 0) AS refunds_cents,
      COALESCE(SUM(chargebacks_cents), 0) AS chargebacks_cents,
      COALESCE(SUM(net_cents), 0) AS net_cents,
      COALESCE(SUM(CASE WHEN net_cents IS NULL THEN 1 ELSE 0 END), 0) AS pending_nets
    FROM effective_entries
    WHERE row_kind NOT IN ('variance', 'payout_link')
    GROUP BY period, channel, sku
    ORDER BY period, channel, sku`;
}

async function salesTable(db: D1Database, title: string, note: string, periodExpr: string): Promise<Table> {
  const result = await db.prepare(salesSql(periodExpr)).all<SalesRow>();
  return {
    title,
    note,
    headers: SALES_HEADERS,
    rows: result.results.map((row) => {
      const pending = Number(row.pending_fees) > 0 || Number(row.pending_nets) > 0;
      return [
        row.period,
        row.channel,
        row.sku,
        String(row.units ?? 0),
        money(row.gross_cents),
        money(row.discounts_cents),
        money(row.fees_cents, pending),
        money(row.refunds_cents),
        money(row.chargebacks_cents),
        money(row.net_cents, pending),
      ];
    }),
  };
}

const WEEK = `date(date, '-' || ((cast(strftime('%w', date) as integer) + 6) % 7) || ' days')`;

export function dailyTable(db: D1Database): Promise<Table> {
  return salesTable(db, 'Daily sales', 'One row per day, channel, and SKU. Fees that have not settled read PENDING.', 'date');
}

export function weeklyTable(db: D1Database): Promise<Table> {
  return salesTable(db, 'Weekly sales', 'Weeks run Monday through Sunday, Eastern Time.', WEEK);
}

export function monthlyTable(db: D1Database): Promise<Table> {
  return salesTable(db, 'Monthly sales', 'Calendar month in Eastern Time.', `substr(date, 1, 7)`);
}

type MarginRow = {
  channel: string;
  sku: string;
  units: number;
  net_sales_cents: number;
  missing_cost: number;
  cogs_cents: number;
  unit_min: number | null;
  unit_max: number | null;
  landed_min: number | null;
  landed_max: number | null;
};

export async function marginTable(db: D1Database): Promise<Table> {
  const result = await db
    .prepare(
      `WITH priced AS (
         SELECT e.channel, e.sku, e.qty, e.gross_cents, e.discounts_cents,
           (SELECT unit_cost_cents FROM unit_costs
             WHERE sku = e.sku AND effective_from <= e.date
             ORDER BY effective_from DESC, id DESC LIMIT 1) AS unit_cost_cents,
           (SELECT landed_extra_cents FROM unit_costs
             WHERE sku = e.sku AND effective_from <= e.date
             ORDER BY effective_from DESC, id DESC LIMIT 1) AS landed_extra_cents
         FROM effective_entries e
         WHERE e.row_kind = 'sale' AND e.sku IS NOT NULL AND e.sku != ''
       )
       SELECT channel, sku,
         COALESCE(SUM(qty), 0) AS units,
         COALESCE(SUM(gross_cents - discounts_cents), 0) AS net_sales_cents,
         COALESCE(SUM(CASE WHEN unit_cost_cents IS NULL THEN 1 ELSE 0 END), 0) AS missing_cost,
         COALESCE(SUM(CASE WHEN unit_cost_cents IS NULL THEN 0 ELSE (unit_cost_cents + landed_extra_cents) * qty END), 0) AS cogs_cents,
         MIN(unit_cost_cents) AS unit_min,
         MAX(unit_cost_cents) AS unit_max,
         MIN(unit_cost_cents + landed_extra_cents) AS landed_min,
         MAX(unit_cost_cents + landed_extra_cents) AS landed_max
       FROM priced
       GROUP BY channel, sku
       ORDER BY channel, sku`,
    )
    .all<MarginRow>();
  return {
    title: 'Product margin',
    note: 'Unit cost comes from unit_costs, versioned by effective date. Blank margin means Ledger has not entered a cost yet.',
    headers: ['Channel', 'SKU', 'Units', 'Net sales', 'Unit cost', 'Landed cost', 'COGS', 'Gross margin', 'Gross margin %'],
    rows: result.results.map((row) => {
      const missing = Number(row.missing_cost) > 0;
      const netSales = Number(row.net_sales_cents);
      const cogs = Number(row.cogs_cents);
      const margin = netSales - cogs;
      const pct = !missing && netSales !== 0 ? `${((margin / netSales) * 100).toFixed(1)}%` : '';
      const unit = missing || row.unit_min === null ? '' : row.unit_min === row.unit_max ? money(row.unit_min) : 'varies';
      const landed = missing || row.landed_min === null ? '' : row.landed_min === row.landed_max ? money(row.landed_min) : 'varies';
      return [
        row.channel,
        row.sku,
        String(row.units),
        money(netSales),
        unit,
        landed,
        missing ? '' : money(cogs),
        missing ? '' : money(margin),
        pct,
      ];
    }),
  };
}

type PnlRow = {
  month: string;
  gross_sales_cents: number;
  discounts_cents: number;
  shipping_charged_cents: number;
  refunds_cents: number;
  chargeback_gross_cents: number;
  dispute_fee_cents: number;
  pending_fees: number;
  label_cents: number | null;
  fees_cents: number;
};

export async function pnlTable(db: D1Database): Promise<Table> {
  const result = await db
    .prepare(
      `SELECT substr(date, 1, 7) AS month,
         COALESCE(SUM(CASE WHEN gross_cents > 0 THEN gross_cents ELSE 0 END), 0) AS gross_sales_cents,
         COALESCE(SUM(discounts_cents), 0) AS discounts_cents,
         COALESCE(SUM(shipping_charged_cents), 0) AS shipping_charged_cents,
         COALESCE(SUM(refunds_cents), 0) AS refunds_cents,
         COALESCE(SUM(CASE WHEN gross_cents < 0 THEN -gross_cents ELSE 0 END), 0) AS chargeback_gross_cents,
         COALESCE(SUM(chargebacks_cents), 0) AS dispute_fee_cents,
         COALESCE(SUM(CASE WHEN fees_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_fees,
         SUM(shipping_label_cost_cents) AS label_cents,
         COALESCE(SUM(platform_fee_cents), 0) + COALESCE(SUM(processor_fee_cents), 0) AS fees_cents
       FROM effective_entries
       WHERE row_kind NOT IN ('variance', 'payout_link')
       GROUP BY month
       ORDER BY month`,
    )
    .all<PnlRow>();
  const cogs = await db
    .prepare(
      `SELECT substr(e.date, 1, 7) AS month,
         SUM((SELECT unit_cost_cents + landed_extra_cents FROM unit_costs
              WHERE sku = e.sku AND effective_from <= e.date
              ORDER BY effective_from DESC, id DESC LIMIT 1) * e.qty) AS cogs_cents
       FROM effective_entries e
       WHERE e.row_kind = 'sale' AND e.sku IS NOT NULL
       GROUP BY month`,
    )
    .all<{ month: string; cogs_cents: number | null }>();
  const cogsByMonth = new Map(cogs.results.map((row) => [row.month, row.cogs_cents]));
  const rows: string[][] = [];
  for (const row of result.results) {
    const pending = Number(row.pending_fees) > 0;
    const cogsCents = cogsByMonth.get(row.month);
    const cogsKnown = cogsCents !== undefined && cogsCents !== null;
    const revenue =
      Number(row.gross_sales_cents) -
      Number(row.discounts_cents) +
      Number(row.shipping_charged_cents) -
      Number(row.refunds_cents) -
      Number(row.chargeback_gross_cents);
    const lines: Array<[string, string]> = [
      ['Gross sales', money(row.gross_sales_cents)],
      ['Discounts', money(row.discounts_cents)],
      ['Shipping charged', money(row.shipping_charged_cents)],
      ['Refunds', money(row.refunds_cents)],
      ['Chargebacks', money(row.chargeback_gross_cents)],
      ['Revenue', money(revenue)],
      ['COGS', cogsKnown ? money(cogsCents) : ''],
      ['Selling fees', money(row.fees_cents, pending)],
      ['Dispute fees', money(row.dispute_fee_cents)],
      ['Shipping labels', row.label_cents === null ? '' : money(row.label_cents)],
      ['Other expenses', '0.00'],
    ];
    const profit =
      pending || !cogsKnown
        ? 'PENDING'
        : money(revenue - Number(cogsCents) - Number(row.fees_cents) - Number(row.dispute_fee_cents) - Number(row.label_cents ?? 0));
    lines.push(['Operating result', profit]);
    for (const [line, amount] of lines) rows.push([row.month, line, amount]);
  }
  return {
    title: 'Monthly P&L',
    note: 'Tax is excluded. Other expenses stay at zero until a receipt source exists. This is not tax advice.',
    headers: ['Month', 'Line', 'Amount'],
    rows,
  };
}

type PayoutView = {
  channel: string;
  payout_id: string;
  payout_date: string;
  amount_cents: number;
  matched_cents: number;
  variance_cents: number;
};

export async function payoutTables(db: D1Database): Promise<Table[]> {
  const payouts = await db
    .prepare(
      `SELECT p.channel, p.payout_id, p.payout_date, p.amount_cents,
         (SELECT COALESCE(SUM(net_cents), 0) FROM effective_entries e
           WHERE e.row_kind != 'variance' AND e.net_cents IS NOT NULL
             AND e.order_id IN (
               SELECT order_id FROM entries x
               WHERE x.channel = p.channel AND x.payout_id = p.payout_id AND x.row_kind != 'variance'
             )) AS matched_cents,
         (SELECT COALESCE(SUM(net_cents), 0) FROM entries v
           WHERE v.channel = p.channel AND v.payout_id = p.payout_id AND v.row_kind = 'variance') AS variance_cents
       FROM payouts p
       ORDER BY p.payout_date, p.channel, p.payout_id`,
    )
    .all<PayoutView>();
  const unmatched = await db
    .prepare(
      `SELECT channel, order_id, MIN(date) AS date
       FROM effective_entries e
       WHERE row_kind = 'sale'
         AND date <= date('now', '-7 day')
         AND NOT EXISTS (
           SELECT 1 FROM entries p
           WHERE p.order_id = e.order_id AND p.payout_id IS NOT NULL AND p.row_kind != 'variance'
         )
       GROUP BY channel, order_id
       ORDER BY date, order_id`,
    )
    .all<{ channel: string; order_id: string; date: string }>();
  return [
    {
      title: 'Payout reconciliation',
      note: 'Matched net plus variance equals the payout, to the cent. A gap stays open until it is explained. Non-JUP LIFE activity on a shared Stripe account shows up here as variance and is not stored.',
      headers: ['Channel', 'Payout', 'Date', 'Amount', 'Matched', 'Variance', 'Flag'],
      rows: payouts.results.map((row) => {
        const stale = Number(row.variance_cents) !== 0 && row.payout_date <= daysAgo(7);
        return [
          row.channel,
          row.payout_id,
          row.payout_date,
          money(row.amount_cents),
          money(row.matched_cents),
          money(row.variance_cents),
          stale ? 'flagged' : '',
        ];
      }),
    },
    {
      title: 'Unmatched orders older than 7 days',
      note: 'Flagged for Ledger. These sales have no payout link yet.',
      headers: ['Channel', 'Order', 'Date'],
      rows: unmatched.results.map((row) => [row.channel, row.order_id, row.date]),
    },
  ];
}

function daysAgo(days: number): string {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

type TaxRow = { month: string; channel: string; tax_cents: number };

export async function taxTable(db: D1Database): Promise<Table> {
  const result = await db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, channel, COALESCE(SUM(tax_collected_cents), 0) AS tax_cents
       FROM effective_entries
       GROUP BY month, channel
       HAVING tax_cents != 0
       ORDER BY month, channel`,
    )
    .all<TaxRow>();
  return {
    title: 'Tax collected',
    note: 'Tax collected is a liability, not revenue. For the CPA only. The ledger gives no tax advice.',
    headers: ['Month', 'Channel', 'Tax collected'],
    rows: result.results.map((row) => [row.month, row.channel, money(row.tax_cents)]),
  };
}

export const VIEW_NAMES = ['daily', 'weekly', 'monthly', 'margin', 'pnl', 'payouts', 'tax'] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

export function isViewName(name: string): name is ViewName {
  return (VIEW_NAMES as readonly string[]).includes(name);
}

export async function viewByName(db: D1Database, name: ViewName): Promise<Table[]> {
  switch (name) {
    case 'daily':
      return [await dailyTable(db)];
    case 'weekly':
      return [await weeklyTable(db)];
    case 'monthly':
      return [await monthlyTable(db)];
    case 'margin':
      return [await marginTable(db)];
    case 'pnl':
      return [await pnlTable(db)];
    case 'payouts':
      return payoutTables(db);
    case 'tax':
      return [await taxTable(db)];
    default: {
      const neverName: never = name;
      return neverName;
    }
  }
}
