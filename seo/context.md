# context.md: JUP LIFE by Mrs. Smash (juplifestudio.com)

Built 2026-11-20 from the repo and the live site. Every line cites its source. If the product and a page disagree, the product wins.

## What it is
- A small 3D-printing studio in Jupiter, FL, run by Smash (Donovan) and Dee (Mrs. Smash). It prints coasters in small seasonal batches with a bakery voice ("Fresh baked. Built different."). [docs/BRIEF.md §1–2]
- Two buyers:
  1. **Retail and gift buyers** purchase coaster sets online, and checkout runs on Shopify at shop.juplifestudio.com. [README.md; web/data/shopify.json]
  2. **Enterprise buyers** are restaurants, bars, boutique hotels, Airbnb hosts and event hosts ordering custom logo coasters. [docs/AMENDMENTS.md "Who it's for"; https://juplifestudio.com/enterprise]
- **Conversion:** a call, text or email, as the owner chose on 2026-11-20. The site's stated goal is also a free sample request (BRIEF §1), sent through `POST /api/sample-request` from the modal and the Enterprise form [functions/api/sample-request.js].

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
- U.S. shipping is always free, including custom logo batches [owner, 2026-11-20]; no minimum. Orders leave the studio within 2–3 business days. [web/templates/shipping_returns.html; site.json lead_times]
- Returns are accepted within 7 days of delivery. The customer pays return postage; the studio pays for damaged or incorrect orders. [web/templates/shipping_returns.html]
- The guarantee is labelled "100% Satisfaction Guarantee". [site.json guarantee]

## Contacts (use exactly as written)
- Call 561-532-7120 (`tel:+15615327120`). Text 561-581-8015, labelled "Text us" and linked with `sms:` only, never `tel:`. [docs/KIT-CLAUDE.md Hard rules]
- Email: hello@juplifestudio.com and dee@juplifestudio.com. [docs/AMENDMENTS.md Contacts]
- TikTok: @juplifestudios. [commit ae3b12f]

## Claims guardrails (hard rules)
- **Material and care (owner-confirmed 2026-11-20):** coasters are TPU 95A (all colors, filament/seed.sql). Allowed: "washable", "rinse and repeat", "flexible, bends, won't break", "doesn't chip". Still no dishwasher, food-safe or durability-statistic claims. Owner says the coasters use **TPU 95A HF** (high-flow grade), printed across the whole fleet: 30 printers, 10 Bambu P1S, 10 Qidi Max 4, 10 Prusa Core One [web/templates/about.html; owner 2026-11-20]. Filament brand not confirmed. Spec numbers (elongation, tensile) only from the manufacturer TDS: bambulab.com and wiki.bambulab.com blocked automated fetches on 2026-11-20, so get the TDS PDF from the owner.
- **Banned claims:** antimicrobial, food-safe, health, durability statistics, "lasts forever", other brands' marks, and fake reviews, ratings, customer logos or counts. [docs/BRIEF.md §8]
- **"Doesn't chip":** live on /enterprise ("Doesn't chip. No cracked corners after a Friday rush.", web/templates/wholesale.html:111). The owner confirmed it in commit 9e28991 (2026-10-22). Reuse only this wording.
- Never invent prices, lead times, emails or URLs. [docs/BRIEF.md §8]
- **Page scope:** the owner approved a blog and use-case pages on 2026-11-20 (hotels, events, weddings, Airbnb/hospitality), overriding brief §8.
- **Service area:** national orders, shipped anywhere in the U.S. Local focus is Palm Beach County plus South Florida (Miami, Fort Lauderdale). [owner, 2026-11-20]
- **Search Console:** owner said 2026-11-20: "i have the site index with search google is done". Indexing still not verified by me.

## Site facts
- Jinja static build: web/templates + web/data, built to dist/ by tools/build.py, served on Cloudflare Pages with Functions under /api/*. [README.md]
- **Adding a page touches four lists in tools/build.py:** `pages`, `crumbs`, sitemap `urls` and the `llms_txt` Pages list. It also needs the nav/footer partials. Check web/_redirects before choosing a slug.
- Production build: `INDEXABLE=1 SITE_URL=https://juplifestudio.com python tools/build.py`. Tests: `npm test`.
- Structured data: LocalBusiness+Store (home), Product+Offer (shop), OfferCatalog+FAQPage (enterprise), FAQPage (home), MerchantReturnPolicy (shipping-returns), BreadcrumbList.
- IndexNow: tools/indexnow.py.
- Google Search Console: verified in #35/#36 on 2026-11-20. No query data pulled yet.
- **Prices are hard-coded** in copy (besides site.json tiers): web/templates/use/*.html, custom_coasters.html, south_florida.html, blog/how-many-wedding-coasters.html, use/airbnb.html (shop prices), seo/social/*. Grep `\$2.00|\$1.90|\$1.75|\$29|\$39` after any price change.
- **Sample wording:** "we print a sample for your approval" (site.json logo_terms) and "free samples, by request" are separate facts. Don't claim the custom-design sample is free or mailed until the owner confirms.

## Competitors (who shows up for the buyer queries, 2026-11-20 web search)
Source: four WebSearch queries run 2026-11-20 ("custom logo coasters restaurant Palm Beach County", "3D printed coasters Jupiter FL", "custom 3D printed logo coasters for bars wholesale", brand name).
- **National promotional printers:** 4imprint, Custom Ink, Vistaprint, Rush Order Tees and CustomCoastersNow ranked for the logo-coaster queries. The pages returned offered paper, cork and stone coasters. No 3D printed product appeared in those results; that does not establish that they don't sell one.
- **Florida print shop:** icustomlabel.com says it prints and quality-checks in Florida and offers bulk pricing for bars and hotels.
- **Faire:** appeared once, with a stone logo coaster ($150 minimum).
- **"3D printed coasters Jupiter FL":** returned design-file sites (makerworld, thangs, all3dp) and no local seller. No seller result paired 3D printed coasters with Palm Beach County.
