# juplifestudio.com v2

Fresh baked. Built different. Static site (Jinja build) + Cloudflare Pages Functions for checkout, Stripe webhook and the sample form.

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python tools/build.py          # -> dist/
cp .dev.vars.example .dev.vars           # Stripe test keys etc. (never committed)
npx wrangler pages dev dist --port 8788  # site + /api/* locally
npm test                                 # API unit tests (node:test)
CHROME=/path/to/chrome npm run smoke     # browser smoke test against the running site
```

## Cloudflare Pages
- Repo `SudoSuOps/jup-life-v2`, branch `main`, framework preset **None**.
- Build command: `pip install -r requirements.txt && python tools/build.py`
- Output directory: `dist`. Root directory: repo root. (`functions/` is picked up automatically.)
- Custom domain: `juplifestudio.com`.

### Environment variables / secrets (Settings > Variables and Secrets)
| Name | Notes |
|---|---|
| `STRIPE_SECRET_KEY` | secret. `sk_test_...` until launch |
| `STRIPE_WEBHOOK_SECRET` | secret. `whsec_...` from the webhook endpoint below |
| `STRIPE_PRICE_SIX_SET_CASE` | `price_...` for the $29 6-Coaster Set + Case |
| `STRIPE_PRICE_FALL_POP_COASTERS` | `price_...` for Fall Tray Pop Coasters ($29) |
| `STRIPE_PRICE_GIGI` | `price_...` for The Gigi ($9) |
| `STRIPE_PRICE_TIDE_SOAP_DISH` | `price_...` for Tide Soap Dish ($14) |
| `STRIPE_PRICE_TIDE_DISPENSER` | `price_...` for Tide Hand Soap Dispenser ($21) |
| `STRIPE_PRICE_READERS` | `price_...` for The Readers ($19) |
| `RESEND_API_KEY` | secret. Empty = requests/orders are only logged. Needs Full access to save Drops signups as contacts |
| `RESEND_SEGMENT_ID` | optional. Resend segment (Contacts > Segments) to file Drops signups in |
| `NOTIFY_TO`, `NOTIFY_FROM`, `SHIP_COUNTRIES` | defaults in `wrangler.jsonc` |
| `SITE_URL` | **build + runtime.** The domain this deploy lives on, e.g. `https://staging-domain.com`. Drives canonicals, sitemap, OG and Stripe return URLs. Unset = Pages URL / request origin |
| `INDEXABLE` | **build.** Leave unset on staging (pages are `noindex`, robots disallows all). Set `1` together with `SITE_URL=https://juplifestudio.com` at launch |

Stripe webhook endpoint: `https://juplifestudio.com/api/stripe/webhook`, event `checkout.session.completed`.
Items with no price ID configured are not purchasable (they show "Ask about this batch").
Resend needs `juplifestudio.com` verified as a sending domain.

## Editing content
- `web/data/products.json` cards, `web/data/batch.json` / `tools/todays-batch/batch.yaml` (yaml wins) Today's Batch, `web/data/site.json` price tiers and the open placeholders.
- Fill a value in `site.json` > `placeholders` and rebuild; the visible `[[...]]` marker disappears. Launch gate: `grep -r "\[\[" dist/` returns nothing.
- Summer swap: set the tray in `batch.yaml` to "The Summer Tray"; Shop/Home switch to the summer flavor board and Stack Bands summer combos.

Brief and decisions: `docs/BRIEF.md`, `docs/AMENDMENTS.md`, `docs/PLACEHOLDERS.md`, original kit notes `docs/KIT-CLAUDE.md`.
