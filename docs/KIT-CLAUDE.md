# CLAUDE.md: juplifestudio.com v2 build

You are finishing the LEAN rebuild of **juplifestudio.com** for **JUP LIFE by Mrs. Smash**, a small 3D-printing studio in Jupiter, FL.
The brand, copy and layout are **decided**. Build what's specified here; don't redesign or offer alternatives.

Read in this order before writing code:
1. `docs/BRIEF.md`: the original brief (source of truth for copy, tokens, guardrails, SEO, acceptance)
2. `docs/AMENDMENTS.md`: decisions made after the brief (these override it)
3. `web/index.html`, `web/shop.html`, `web/wholesale.html` + `web/css/*` + `web/js/main.js`: the **approved, working pages**. Treat them as the reference implementation and component library.
4. `design/screens/*.png`: approved renders at 1440 and 375 px
5. `docs/PLACEHOLDERS.md`: open `[[...]]` items. Show them visibly; never invent values.

## What exists vs. what you build

| Piece | Status |
|---|---|
| Home `/` (all 8 sections + video strip) | ✅ Done in `web/index.html`. Port into templates, don't restyle. |
| Sample-request modal (`<dialog>`) | ✅ Done. Posts to `/api/sample-request`. |
| Bag + Stripe Checkout (client) | ✅ Done in `main.js` (localStorage bag → `POST /api/checkout` → redirect). |
| API: checkout, webhook, sample intake | ✅ Done in `api/` (FastAPI, 5 passing tests). |
| Shop `/shop` ("the bakery case") | ✅ Done in `web/shop.html`: Today's tray, Always on the shelf, Baked to order, checkout banners, Product JSON-LD. |
| Wholesale & Samples `/wholesale` ("The Bakery Counter, for restaurants") | ✅ Done in `web/wholesale.html` per `docs/WHOLESALE_SPEC.md`: hero, Taste/Order/Delivered strip, price board with batch totals, Built for service, Your logo our oven, Who it's for, FAQ (+FAQPage JSON-LD), sample form with Address, sample modal. |
| Shared header/footer/modal partials + build step | ⬜ **Build** |
| Self-hosted fonts, OG image, sitemap, robots, redirects | ⬜ **Build** |
| Stripe live config + webhook endpoint | ⬜ **Configure** (owner supplies keys/price IDs) |

## Architecture (decided)

```
juplife-site/
├── web/            static site (HTML/CSS/vanilla JS). Deployed to a static host/CDN.
│   ├── templates/  (you create) Jinja2 pages + partials: base, header, footer, sample_dialog, bag_dialog, card, board
│   ├── data/       batch.json (Today's Batch), products.json (cards)
│   ├── css/ js/ img/ video/
│   └── dist/       (build output, gitignored)
├── tools/build.py  (you create) renders templates + data → web/dist/. Python, Jinja2 only.
├── tools/todays-batch/  existing print/social card generator (batch.yaml → PDF/PNGs). Keep batch.yaml and web/data/batch.json in sync: build.py should read batch.yaml if present.
└── api/            FastAPI service (uvicorn). Routes: /api/health, /api/checkout, /api/stripe/webhook, /api/sample-request
```

- **No frontend framework.** Budget: total JS ≤ 50 KB (current `main.js` is ~8 KB unminified). Static HTML is pre-rendered at build so cards, boards and prices are in the HTML (SEO + LCP).
- **Today's Batch board** renders from `batch.json`. At build, pre-render the rows into the HTML (keep the inline `#batch-data` + JS as the hydration path so a daily JSON swap still works without a rebuild if you choose to fetch it).
- **Same-origin API**: serve the static site and route `/api/*` to the FastAPI service (reverse proxy, e.g. Caddy/Nginx, or the host's rewrites). If the API lives on another origin, set `<meta name="api-base" content="https://api.…/api">` and add that origin to `ALLOWED_ORIGINS`.
- **Payments = Stripe Checkout (hosted).** No card data touches our servers. The client sends only `{sku, qty}`; `api/app/catalog.py` maps sku → Stripe Price ID from env. Unpriced items ("Ask about this batch") are not purchasable and route to the modal. The brief says "keep the existing Stripe checkout and bag": if the owner has existing Stripe Products/Prices, put their IDs in env rather than creating new ones.

## Build tasks (in order)

1. **Templates + build step.** The three pages currently duplicate header, footer and dialogs. Create `tools/build.py` (Jinja2) and `web/templates/`. Extract header, footer, both dialogs, the product card, the chalkboard board and the price board from `index.html` into partials. Output `dist/index.html` byte-for-byte equivalent in structure to the current page. Cards render from `products.json` (`home: true` for Home, `shop: true` for Shop).
2. **Shop `/shop`**: ✅ built in `web/shop.html`; port into templates. Original spec for reference: (`<title>Shop the Batch | Washable TPU Coasters | JUP LIFE</title>`)
   - H1 "The Batch." Sub: "The current tray, plus the always-on favorites."
   - Current tray: the Fall flavor board image (`img/flavor-board-fall.webp`) + the Fall Tray Pop Coasters card (swatches from batch).
   - Always-on cards from `products.json` where `shop: true`, in file order, then the custom-logo CTA strip (opens the modal).
   - The Readers: `$19`, **Add to bag**, photo placeholder `[[PHOTO: The Readers]]` until a real one arrives.
   - Cards with `gallery` may show a second image on hover/focus or a small thumbnail row. **No carousels.**
   - Each "Ask about this batch" opens the modal with **Product question** preselected and `product` filled (already wired via `data-type`/`data-product`).
   - `?checkout=success` → show a cream banner "It's on the tray. Your order is in." (bag already clears in JS). `?checkout=cancel` → "No worries, your bag is saved."
   - Product + Offer JSON-LD for the two priced items (6-Coaster Set + Case $29, The Readers $19).
   - Summer assets (`flavor-board-summer.webp`, `trio-peach-sage-cream.webp`) are **for the next tray swap**. Don't show them until batch.json says Summer.
3. **Wholesale & Samples `/wholesale`**: ✅ built in `web/wholesale.html` (plus a "Who we bake for" section the owner asked for); port into templates. Original spec for reference: (`<title>Custom Logo Coasters for Restaurants | Palm Beach County</title>`)
   1. Hero: H1 "Your logo, fresh baked." Sub "Washable, dishwasher-safe TPU 95A coasters with your logo, made in Jupiter, FL." + [Get a free Half Dozen]. Image: `restaurant-drink.webp`.
   2. Price board (reuse partial). Note under it: "Logo setup, shipping and lead time: `[[CONFIRM]]`."
   3. How it works, 4 numbered steps: Request a Half Dozen → Try it on your bar → Send your logo → We bake your batch ("bulk ships in closed kraft boxes", image `bulk-boxes.webp`).
   4. **Inline** request form (same fields/endpoint as the modal; reuse the partial in inline mode). Submit "Send my Half Dozen". Success "It's on the tray. We'll be in touch within `[[RESPONSE TIME]]`."
   5. Custom orders: "Something else in mind? Team colors, event gifts, monograms. Tell us the recipe." Same form with request type **Custom** + notes.
   6. Contact strip (exact contacts, see below).
4. **Fonts**: self-host DM Serif Display 400 + Montserrat 400/600 (+400 italic) as WOFF2 under `web/fonts/` (`npm i @fontsource/dm-serif-display @fontsource/montserrat` and copy the latin woff2 files, or download from Google Fonts). `font-display: swap`, preload the two above-the-fold files. Remove the Google Fonts `<link>`s.
5. **SEO plumbing**: `sitemap.xml` (3 URLs), `robots.txt`, canonical tags, OG image (`img/og-hero.jpg`, 1200×630, cut from `hero-dome-1600.webp` with the logo, or from `banner_Website_hero_1920x800.png` if the owner provides it). 301s: `/restaurants` → `/wholesale`; `/collection/*`, `/weddings*`, `/coming-soon*` → `/shop`. Implement in the host's redirect config.
6. **Performance**: AVIF + WebP `<picture>` with `srcset` for every raster (generate AVIF in build.py with Pillow; widths 400/800/1200/1600). Hero image < 150 KB on mobile (current mobile source is 26 KB). `loading="lazy"` below the fold (done). Videos are `preload="none"`, tap-to-play: **never autoplay**. Target: mobile LCP < 2 s, Lighthouse mobile ≥ 90 on Performance, Accessibility, SEO.
7. **API deploy**: `cd api && pip install -r requirements.txt && uvicorn app.main:app --host 0.0.0.0 --port 8000` behind the proxy. Set env from `.env.example`. In Stripe: create the webhook endpoint `https://juplifestudio.com/api/stripe/webhook` for `checkout.session.completed`; test with `stripe listen --forward-to localhost:8000/api/stripe/webhook` and `stripe trigger checkout.session.completed`. Uploaded logos go to `UPLOAD_DIR`: move to object storage (R2/S3) for production; the API is single-instance unless the throttle is moved to Redis.
8. **Tests**: keep `api/tests` green (`pytest -q`). Add a Playwright smoke test for: modal opens from every `[data-open-sample]`, Esc closes, focus returns; required-field validation; bag add/qty/checkout POST (mock `/api/checkout`); `/restaurants` redirect.

## Hard rules (from the brief; don't break)

- **Contacts, exact.** Wholesale: call Smash, `561-532-7120` (`tel:+15615327120`). Say hello: `hello@juplifestudio.com`. Email Dee: `dee@juplifestudio.com`. **Text us: `561-581-8015`**: only ever labeled "Text us", only `sms:` links, never `tel:`. X: @juplifestudio. TikTok Shop: `[[TIKTOK_SHOP_URL]]`.
- **Claims.** Allowed only: washable; dishwasher safe (**TPU parts only**); made in Jupiter, FL; "locally grown" (playful); the five "Quality by design" facts. No antimicrobial/antibacterial/hygienic/food-safe/health claims, no durability stats, no "lasts forever". Never call PLA or PETG dishwasher safe. Stack Bands and The Gigi have **no material line** until the owner confirms.
- **No** other brands' names or marks, no metal-chain imagery, no fake reviews/testimonials/ratings/customer logos/counts, no invented prices/emails/phones/lead times/URLs.
- **Scope**: exactly 3 pages + 1 modal (plus the existing Shipping & Returns and Privacy pages). No About/Drops/Hospitality/Weddings/blog/coming-soon. No carousels, no popups on load, no autoplay.
- **Color**: site chrome uses only the six core tokens. Ingredient colors only on swatches/flavor tags, always next to the flavor name. No light text on kraft; cocoa on kraft only for large/bold text.
- **Renders**: every AI/studio render keeps a "Studio rendering" caption. Swap for real photos as they arrive.
- **A11y**: AA contrast, real buttons/links, labeled inputs, visible focus, `prefers-reduced-motion` respected (already in CSS).

## Acceptance (ship gate)
Copy `docs/BRIEF.md` §10 and tick each: 3 pages + modal · LCP < 2 s · Lighthouse ≥ 90 ×3 · "Get a free Half Dozen" above the fold at 375×667 · price board is live text (100/$2.00, 500/$1.60, 1,000/$1.20, samples free) · Today's Batch from JSON · "dishwasher safe" only on TPU items · contacts exact · `/restaurants` 301 works · LocalBusiness schema validates · AA contrast · reduced motion respected. Plus: Stripe test-mode purchase of the 6-Coaster Set completes end to end and the webhook logs the order.
