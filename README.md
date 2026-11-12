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
| `STRIPE_PRICE_SIX_SET_CASE` | unused for checkout. The Hibiscus Set uses `STRIPE_PRICE_HIBISCUS_SET`. |
| `STRIPE_PRICE_FALL_POP_COASTERS` | unused for checkout. Holiday Tray Pop Coasters and the three Pop Trays use `STRIPE_PRICE_POP_COASTERS_6` at $29. |
| `STRIPE_PRICE_GIGI` | `price_...` for The Gigi ($9) |
| `STRIPE_PRICE_TIDE_SOAP_DISH` | `price_...` for Tide Soap Dish ($14) |
| `STRIPE_PRICE_TIDE_DISPENSER` | `price_...` for Tide Hand Soap Dispenser ($21) |
| `STRIPE_PRICE_READER_21` | `price_...` for Readers at $21. Leave unset until that Stripe price exists. The button stays Coming soon, and checkout will not use `STRIPE_PRICE_READERS`. |
| `STRIPE_PRICE_POP_COASTERS_6` | `price_...` for Pop coasters at $29, Flat or Edge: the 6-pack, Holiday Tray Pop Coasters, and Pop Trays 1–3. No fallback. Missing or set to a reserved box price keeps the buy button on Coming soon. |
| `STRIPE_PRICE_HIBISCUS_SET` | `price_...` for The Hibiscus Set (`six-set-case`) at $39. If unset, checkout falls back to `STRIPE_PRICE_FLOWER_SET_CASE`. Never uses `STRIPE_PRICE_SIX_SET_CASE`. |
| `STRIPE_PRICE_FLOWER_SET_CASE` | `price_...` for the Flower Coaster Set with Case (`flower-set-case`) at $39. No fallback, and never a reserved box price. Also the fallback for The Hibiscus Set when `STRIPE_PRICE_HIBISCUS_SET` is unset. |
| `STRIPE_PRICE_HALF_DOZEN` | optional override; defaults to the live $29 Half Dozen price |
| `STRIPE_PRICE_BAKERS_DOZEN` | optional override; defaults to the live $39 Baker's Dozen price |
| `RESEND_API_KEY` | secret. Empty = requests/orders are only logged. Needs Full access to save Drops signups as contacts |
| `RESEND_SEGMENT_ID` | optional. Resend segment (Contacts > Segments) to file Drops signups in |
| `NOTIFY_TO`, `NOTIFY_FROM`, `SHIP_COUNTRIES` | defaults in `wrangler.jsonc` |
| `SITE_URL` | **build + runtime.** The domain this deploy lives on, e.g. `https://staging-domain.com`. Drives canonicals, sitemap, OG and Stripe return URLs. Unset = Pages URL / request origin |
| `INDEXABLE` | **build.** Leave unset on staging (pages are `noindex`, robots disallows all). Set `1` together with `SITE_URL=https://juplifestudio.com` at launch |

Stripe webhook endpoint: `https://juplifestudio.com/api/stripe/webhook`, event `checkout.session.completed`.
Items with no price ID configured are not purchasable (they show "Ask about this batch").
Resend needs `juplifestudio.com` verified as a sending domain.

## Editing content
- `web/data/catalog.json` decides what the home page and shop show. `listed` is Pop Coasters 6-Pack and Flower Coaster Set with Case. Other products stay in `products.json` and `functions/_lib.js`. Set `show_legacy` to `true` to bring the old tray, pop trays, shelf and Half Dozen back.
- **Photo swap:** edit only `web/data/photos.json`. Each style, tray color and flower has its own `img` slot. Point `img` at the new file under `web/img/`, rewrite `alt` to match the photo, and leave `render` at `false`. Do not add a studio rendering or concept render caption. An empty `img` shows “Photo coming”. Rebuild. Do not edit the HTML.
- `web/data/products.json` cards, `web/data/batch.json` / `tools/todays-batch/batch.yaml` (yaml wins) Today's Batch, `web/data/site.json` price tiers and the open placeholders.
- Fill a value in `site.json` > `placeholders` and rebuild; the visible `[[...]]` marker disappears. Launch gate: `grep -r "\[\[" dist/` returns nothing.
- Summer swap: set the tray in `batch.yaml` to "The Summer Tray"; Shop/Home switch to the summer flavor board and Stack Bands summer combos.

Brief and decisions: `docs/BRIEF.md`, `docs/AMENDMENTS.md`, `docs/PLACEHOLDERS.md`, original kit notes `docs/KIT-CLAUDE.md`.
