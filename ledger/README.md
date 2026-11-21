# JUP LIFE sales ledger

Private book of JUP LIFE sales. It is a Cloudflare Worker with a D1 database, separate from the storefront. It reads Shopify, Stripe, and TikTok Shop files. It never writes to those systems.

Do not deploy this from the draft pull request. Deploy later, behind Cloudflare Access, after the Access application exists.

## What it stores

One row per order line, plus an order-level fee row and later adjusting rows. Money is integer cents. The raw source JSON is kept on every stored row.

Unsettled fees are `NULL` with `fees_status = pending`. The UI prints `PENDING`. The book does not estimate a fee.

Rows are append-only. A correction is a new row. The worker never updates or deletes ledger rows. Re-importing the same `(channel, source_id, line_id)` is a no-op.

Net = gross − discounts + shipping charged − platform fee − processor fee − refunds − chargebacks. Tax is not in net. Shipping-label cost is not in net. Both are reported on their own.

Refunds and chargebacks are new rows on the date they happened, linked to the original order. The sale row stays as it was.

A payout must match the sum of its JUP LIFE rows to the cent. A gap inserts a `variance` row. The same gap is not inserted twice. Orders with no payout link after 7 days show up as flagged on the payout view.

## JUP LIFE only

The Stripe account also carries other Swarm & Bee businesses. A Checkout Session is stored only when one of these is true:

- `success_url` or `cancel_url` host is `juplifestudio.com` or a subdomain
- `metadata.brand` is `juplife`
- every line-item price id is in `JUP_PRICE_IDS` (an empty line-item list does not pass)

Anything else is dropped before a row or its raw JSON is written. Refunds and disputes are stored only when they link to a stored JUP LIFE charge, or the charge metadata says `juplife`.

The live site checkout uses a `juplifestudio.com` success URL, so those sessions match on the host. It does not set `metadata.brand`. Put current JUP LIFE Stripe price ids in `JUP_PRICE_IDS` for any session that lacks that host.

Payouts on this Stripe account include the other businesses. Their charges are not stored. The cent gap becomes a variance row with no raw JSON from the dropped objects.

If Shopify charges land in the same Stripe account, set `SHOPIFY_ON_STRIPE` to `"true"`. Those Stripe objects are dropped and the Shopify order is the one row. The default is `"false"` until that is confirmed.

## Views

Served as HTML tables, with a CSV download on each view. All of these require a Cloudflare Access JWT.

| Path | View |
| --- | --- |
| `/daily`, `/weekly`, `/monthly` | Sales by channel and SKU |
| `/margin` | Unit cost and gross margin from `unit_costs` |
| `/pnl` | Monthly P&L |
| `/payouts` | Payout match, variance, and stale unmatched orders |
| `/tax` | Tax collected. Liability, not revenue. Not tax advice. |
| `/import/tiktok` | TikTok CSV upload |

`unit_costs` is empty until Ledger loads costs (`sku`, `unit_cost_cents`, `landed_extra_cents`, `effective_from`). Margin stays blank until then. There is no cost-editing screen.

## TikTok

There is no TikTok API app. The only path is CSV.

The column map is **provisional**. It is the single table `TIKTOK_COLUMNS` in `src/tiktok.ts`. No Seller Center sample was in the handoff when this was written. Change that table when a real export arrives. Do not scatter header names through the importer.

Upload from `/import/tiktok` (orders or settlement), or:

```bash
LEDGER_URL=https://ledger.juplifestudio.com ACCESS_JWT='...' \
  node scripts/import-tiktok.mjs orders ./orders.csv
```

Order files use source tag `csv_import`. Settlement files use `tiktok_settlement`.

## Sources

| Source | Webhook | Backfill |
| --- | --- | --- |
| Stripe | `POST /hook/stripe` | Checkout Sessions, Balance Transactions, Payouts. GET only. |
| Shopify `yvvpu5-3p.myshopify.com` | `POST /hook/shopify` | Admin GraphQL orders and refunds. Queries only. |
| TikTok Shop | none | CSV only |

Stripe events: `checkout.session.completed`, `charge.refunded`, `charge.dispute.created`, `payout.paid`.

Shopify topics: `orders/paid`, `refunds/create`. The shop has no orders yet. Shopify fee columns stay pending until a payments payout feed is confirmed. The order query does not invent a fee.

Cron `15 11 * * *` runs the daily read. Cron `15 12 * * 1` runs the weekly full read and reconciliation.

Webhook routes skip Access and reject a bad signature. Every other route requires `Cf-Access-Jwt-Assertion` validated against `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN`. A missing or bad token is 403.

`workers_dev` is false. No custom domain is configured. `ledger.juplifestudio.com` is commented in `wrangler.jsonc` until Access exists.

## Setup

Run these from `ledger/`. The `database_id` in `wrangler.jsonc` is a placeholder. Replace it after the database exists. None of the commands below were run against the live account for this draft.

1. Create the D1 database and paste the id into `wrangler.jsonc`:

   ```bash
   npx wrangler d1 create jup-life-ledger
   ```

2. Apply migrations:

   ```bash
   npx wrangler d1 migrations apply jup-life-ledger --local
   npx wrangler d1 migrations apply jup-life-ledger --remote
   ```

3. Create the Cloudflare Access application for the hostname **before** attaching a route. Copy the application audience tag. `ACCESS_TEAM_DOMAIN` is either `https://<team>.cloudflareaccess.com` or the team name.

4. Set secrets on the worker. Do this as part of the later deploy, not from this draft. `wrangler secret put` publishes a version.

   ```bash
   npx wrangler secret put STRIPE_READ_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   npx wrangler secret put SHOPIFY_ADMIN_TOKEN
   npx wrangler secret put SHOPIFY_WEBHOOK_SECRET
   npx wrangler secret put ACCESS_AUD
   npx wrangler secret put ACCESS_TEAM_DOMAIN
   npx wrangler secret put JUP_PRICE_IDS
   ```

   `STRIPE_READ_KEY` is a restricted key with read access to Checkout Sessions, Charges, Balance Transactions, Refunds, Disputes, and Payouts. No write permission.

   `SHOPIFY_ADMIN_TOKEN` needs `read_orders` and `read_all_orders`. The shop is `yvvpu5-3p.myshopify.com`.

   `JUP_PRICE_IDS` is a comma-separated allowlist, for example `price_abc,price_def`.

5. Only after Access is enforcing on the hostname, uncomment the route in `wrangler.jsonc` and deploy.

6. Then register webhooks, pointing at the Access hostname. Webhook paths are not behind Access. They check signatures.

   - Stripe: the four events above, URL `https://ledger.juplifestudio.com/hook/stripe`
   - Shopify: `orders/paid` and `refunds/create`, URL `https://ledger.juplifestudio.com/hook/shopify`

## Local

```bash
cd ledger
npm install
cp .dev.vars.example .dev.vars
npm test
npm run migrate:local
npm run dev
```

`.dev.vars` is gitignored. The example values are fakes.

For local UI requests, point `ACCESS_TEAM_DOMAIN` at a process you control that serves `/cdn-cgi/access/certs`, and send a JWT signed by that key with `aud` equal to `ACCESS_AUD`. Webhook curls only need a valid `Stripe-Signature` or `X-Shopify-Hmac-Sha256`.

## Not in this book yet

These were called out in the spec and are not imported:

- cash, Venmo, Zelle, Cash App, markets, and other in-person sales
- Shopify POS
- ChatGPT or other agent checkout
- gift cards
- manual invoices
- a receipt file for “other expenses” on the P&L (that line stays zero)

Non-USD amounts are dropped rather than converted.

## Open questions

1. Does Shopify run on Shopify Payments or Stripe? `SHOPIFY_ON_STRIPE` stays `false` until that is known.
2. The Stripe key in use is the BullPrint Lab account (Swarm & Bee LLC). Confirm there is no second JUP LIFE Stripe account that this book should also read.
3. Are there cash, Venmo, or in-person sales to record, and who will enter them?
4. What start date should backfill use? Right now it reads the full history the APIs return.
5. Who can log in: Smash only, or Mrs. Smash too? That is the Access policy, which is not in this repo.
6. TikTok column names are provisional until a real Seller Center export is checked against `TIKTOK_COLUMNS`.
