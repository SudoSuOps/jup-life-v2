# context.md: JUP LIFE by Mrs. Smash (juplifestudio.com)

Built 2026-11-20 from the repo and the live site. Every line cites its source. If the product and a page disagree, the product wins.

## What it is
- A small 3D-printing studio in Jupiter, FL, run by Smash (Donovan) and Dee (Mrs. Smash). It prints coasters in small seasonal batches with a bakery voice ("Fresh baked. Built different."). [docs/BRIEF.md §1–2]
- Two buyers:
  1. **Retail and gift buyers** purchase coaster sets online, and checkout runs on Shopify at shop.juplifestudio.com. [README.md; web/data/shopify.json]
  2. **Enterprise buyers** are restaurants, bars, boutique hotels, Airbnb hosts and event hosts ordering custom logo coasters. [docs/AMENDMENTS.md "Who it's for"; https://juplifestudio.com/enterprise]
- **Conversion:** the owner counts a call, text or email, or a free sample request (`POST /api/sample-request`, sent from the modal and the Enterprise form). [owner, 2026-11-20; functions/api/sample-request.js]

## Products and prices (display prices; Shopify charges)
| SKU | Name | Price | Line | Source |
|---|---|---|---|---|
| pop-coasters-6 | Pop Coasters 6-Pack | $29 | Six round Pop coasters and a case. Flat or Edge. Mixed tray or one color. | web/data/products.json |
| flower-set-case | Flower Coaster Set with Case | $39 | Sunflower, or Hibiscus in Peach, Sage, Cream, Ruby or Frost. | web/data/products.json |
| coastal-6 | Coastal Coasters 6-Pack | $39 | Six coastal Pops in one design, inspired by the Jupiter shoreline. | web/data/products.json |

Listed SKUs and their order are set in web/data/catalog.json.

## Enterprise (logo coasters)
- Prices: 200 coasters at $2.00 each ($400), 500 at $1.90 ($950), 1,000 at $1.75 ($1,750). Samples are free on request. [web/data/site.json tiers]
- Process: you send the art, the studio prints a sample for approval, and the batch ships within 10 days of approval. [web/data/site.json placeholders.logo_terms]

## Shipping and returns
- U.S. shipping is free with no minimum. Orders leave the studio within 2–3 business days. [web/templates/shipping_returns.html; site.json lead_times]
- Returns are accepted within 7 days of delivery. The customer pays return postage; the studio pays for damaged or incorrect orders. [web/templates/shipping_returns.html]
- The guarantee is labelled "100% Satisfaction Guarantee". [site.json guarantee]

## Contacts (use exactly as written)
- Call 561-532-7120 (`tel:+15615327120`). Text 561-581-8015, labelled "Text us" and linked with `sms:` only, never `tel:`. [docs/KIT-CLAUDE.md Hard rules]
- Email: hello@juplifestudio.com and dee@juplifestudio.com. [docs/AMENDMENTS.md Contacts]
- TikTok: @juplifestudios. [commit ae3b12f]

## Claims guardrails (hard rules)
- **Material and care:** the only care claim is "washable". Make no dishwasher, TPU or material claims, because the live care copy was cut back to "washable" (commit 180686b) and the live product lines say only "Washable".
- **Banned claims:** antimicrobial, food-safe, health, durability statistics, "lasts forever", other brands' marks, and fake reviews, ratings, customer logos or counts. [docs/BRIEF.md §8]
- **"Doesn't chip":** the owner confirmed it (commit 9e28991, 2026-10-22).
- Never invent prices, lead times, emails or URLs. [docs/BRIEF.md §8]
- **Page scope:** the brief §8 bans blog, About, Weddings and similar pages. /about and /palm-beach-county now exist, so the owner has relaxed this, but articles and comparison pages still need explicit owner approval.

## Site facts
- Jinja static build: web/templates + web/data, built to dist/ by tools/build.py, served on Cloudflare Pages with Functions under /api/*. [README.md]
- **Adding a page touches four lists in tools/build.py:** `pages`, `crumbs`, sitemap `urls` and the `llms_txt` Pages list. It also needs the nav/footer partials. Check web/_redirects before choosing a slug.
- Production build: `INDEXABLE=1 SITE_URL=https://juplifestudio.com python tools/build.py`. Tests: `npm test`.
- Structured data: LocalBusiness+Store (home), Product+Offer (shop), OfferCatalog+FAQPage (enterprise), FAQPage (home), MerchantReturnPolicy (shipping-returns), BreadcrumbList.
- IndexNow: tools/indexnow.py.
- Google Search Console: verified in #35/#36 on 2026-11-20. No data yet.

## Competitors (who shows up for the buyer queries, 2026-11-20 web search)
- **National promotional printers:** 4imprint, Custom Ink, Vistaprint, Rush Order Tees, CustomCoastersNow. They print on paper, cork and stone. None of them sells 3D printed coasters.
- **Florida print shop:** icustomlabel.com says it prints and quality-checks in Florida and offers bulk pricing for bars and hotels.
- **Marketplaces:** Etsy and Faire, where 3D printed coaster makers sell.
- **Positioning gap:** none of these competitors appears for "3D printed coasters" with a local Palm Beach County angle. Those results are design-file sites (makerworld, thangs, all3dp).
