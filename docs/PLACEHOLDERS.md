# Open placeholders: owner to fill before launch

Each shows on the page as visible terracotta `[[...]]` text (`.ph` class). `grep -rn "\[\[" web/` finds them all. Launch gate: zero matches in `web/dist/`.

| Placeholder | Where | Needed from owner |
|---|---|---|
| `[[TIKTOK_SHOP_URL]]` | 6-Coaster Set card, footer | TikTok Shop listing URL |
| `[[CONFIRM: hand-checked]]` | Quality by design, beat 5 | Confirm the claim wording |
| `[[CONFIRM: top-rack / temperature guidance]]` | FAQ | Dishwasher guidance for TPU |
| `[[CONFIRM: retail dispatch and wholesale lead times]]` | FAQ, Wholesale | Lead times |
| `[[CONFIRM]]` logo setup / shipping terms | Wholesale price-board note | Terms |
| `[[RESPONSE TIME]]` | Modal + form success | e.g. "1 business day" |
| 561-581-8015 as texting line | Footer, contact strip | Confirm it's the text line |
| Prices: Pop Coasters, Stack Bands, The Gigi, Tide Soap Dish, Tide Dispenser | Cards ("Ask about this batch") | Prices + Stripe Price IDs if they become buyable |
| Materials: Stack Bands, The Gigi | Cards (no material line yet) | TPU? Dishwasher safe? |
| Real photos | All product cards (all current images are studio renderings) | Real photos of 6-coaster set + case, The Readers, and the rest |
| `[[PHOTO: The Readers]]` | Shop | Any photo |
| Full-res originals | `tide-soap-dish`, `soapdish-*`, `tide-trio`, `tide-hotel-bath`, `gigi-earthtone-stack`, `pop-coasters-pumpkin`, `flex-closeup` | These were cut from contact sheets at ~380–400 px; swap in full-size files |
| `og-hero.jpg` | `<meta property="og:image">` | `banner_Website_hero_1920x800.png` or approve a cut from the hero render |
| Stripe | `api/.env` | Live secret key, webhook secret, Price IDs for 6-Coaster Set ($29) and The Readers ($19) |
| Email provider | `api/.env` | Resend API key + verified juplifestudio.com sender (or swap `notify()` for their provider) |
