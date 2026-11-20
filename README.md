# juplifestudio.com v2

Fresh print daily. Built different. Static site (Jinja build) + Cloudflare Pages Functions for the sample form and Drops signup. **Checkout is Shopify** (shop.juplifestudio.com): the bag sends shoppers to a Shopify cart permalink, so orders, payments, tax, shipping and TikTok Shop all live in one place.

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python tools/build.py          # -> dist/
cp .dev.vars.example .dev.vars           # Resend key etc. (never committed)
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
| `RESEND_API_KEY` | secret. Empty = sample requests and Drops signups are only logged. Needs Full access to save Drops signups as contacts |
| `RESEND_AUDIENCE_ID` (or `RESEND_SEGMENT_ID`) | optional. Resend audience/segment to file Drops signups in |
| `NOTIFY_TO`, `NOTIFY_FROM` | defaults in `wrangler.jsonc` |
| `SITE_URL` | **build + runtime.** The domain this deploy lives on. Drives canonicals, sitemap and OG. Unset = Pages URL / request origin |
| `INDEXABLE` | **build.** Unset = every page is `noindex` and robots.txt blocks all crawlers. **Production must have `INDEXABLE=1` and `SITE_URL=https://juplifestudio.com`**, or Google can't index the site |

No Stripe keys. Payments happen on Shopify. Resend needs `juplifestudio.com` verified as a sending domain.

## Selling on Shopify
- The site lists three coasters (`web/data/catalog.json`): Pop Coasters 6-Pack with case ($29), Flower Coaster Set with Case ($39), Coastal Coasters 6-Pack ($39).
- `web/data/shopify.json` maps every choice on a card (style, tray, flower, design) to a Shopify **variant ID**. The bag's Checkout button opens `https://shop.juplifestudio.com/cart/<variant>:<qty>,...`.
- Prices are charged by Shopify. `products.json` prices are display only, so keep them in step with Shopify.
- Added or changed a variant in Shopify? Update its ID in `shopify.json` and rebuild. The build fails, and `npm test` fails, if any card choice has no variant.
- Products must stay **Active** and published to the **Online Store** channel in Shopify, or the cart link won't add them.

## Editing content
- `web/data/catalog.json` decides what the home page and shop show, in order. Every listed SKU needs a card in `products.json` and variants in `shopify.json`.
- **Photo swap:** edit only `web/data/photos.json`. Each style, tray color and flower has its own `img` slot. Point `img` at the new file under `web/img/`, rewrite `alt` to match the photo, and leave `render` at `false`. Do not add a studio rendering or concept render caption. An empty `img` shows “Photo coming”. Rebuild. Do not edit the HTML.
- `web/data/products.json` cards, `web/data/batch.json` / `tools/todays-batch/batch.yaml` (yaml wins) Today's Batch, `web/data/site.json` price tiers and the open placeholders.
- Fill a value in `site.json` > `placeholders` and rebuild; the visible `[[...]]` marker disappears. Launch gate: `grep -r "\[\[" dist/` returns nothing.

Brief and decisions: `docs/BRIEF.md`, `docs/AMENDMENTS.md`, `docs/PLACEHOLDERS.md`, original kit notes `docs/KIT-CLAUDE.md`.
