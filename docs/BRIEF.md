# JupLifeStudio.com v2: LEAN Rebuild (Claude Design Prompt)

> Paste this whole document into Claude Design and upload `JupLifeStudio_Web_Assets.zip` (its README maps the files). The decisions below are final, so don't offer alternatives. Anything in `[[BRACKETS]]` is a placeholder: show it visibly and never invent a value.

## 1. Role and goal
You are rebuilding **juplifestudio.com** from scratch for **JUP LIFE by Mrs. Smash**, a small 3D-printing studio in Jupiter, FL run by Smash (Donovan) and Dee (Mrs. Smash). It's a **total rebuild with no bloat**. The site does three things only:
1. Says **"Fresh baked. Built different."** We're a bakery-style studio, not an assembly line. Small seasonal batches, with colorways named after ingredients.
2. Sells the **products**.
3. Gets restaurants and bars to **request a free Half Dozen sample box**.

**Scope:** 3 pages plus 1 modal. Nothing else.

## 2. Voice
Short, warm and confident, like a bakery chalkboard. Use bakery verbs (baked, batch, tray, fresh).
Lines: "Fresh baked. Built different." · "Today's Batch is out of the oven." · "Your logo, fresh baked." · "Samples are on the house." · "Locally baked in Jupiter, FL." (playful) · "A little piece of our happy place."

## 3. Design system
**Colors (site chrome uses only these):**
| Token | Hex | Use |
|---|---|---|
| `--cream` | `#FBF7F0` | Page background |
| `--cocoa` | `#5A3E2B` | All text and the footer background (9.1:1 on cream) |
| `--kraft` | `#C9A67A` | Tags, cards, the box section (cocoa text: 4.3:1, **large/bold text only**) |
| `--sage` | `#9CAF88` | TPU band divider, secondary accents |
| `--terracotta` | `#A9532F` | Primary buttons with cream text (5.3:1), links |
| `--chalkboard` | `#2B2B2B` | Price board and Today's Batch board (cream text, 13.3:1) |

**Ingredient colors appear ONLY on flavor tags and swatches, always with the flavor name written next to them:**
- FALL: Pumpkin `#E8731E` · Cinnamon `#A0522D` · Cranberry `#9B1B30` · Maple `#C8862A` · Rhubarb `#C93A5B`
- SUMMER: Blueberry `#3F5BB8` · Peach `#FFB07C` · Key Lime `#A8D94A` · Watermelon `#F2546B` · Coconut `#F4EFE3`
- ALWAYS ON: Sea Salt `#7FD1C2` · Sunflower `#F6C21C`

**Type (2 fonts):** **DM Serif Display** for headlines, product names and board titles. **Montserrat** (400/600) for everything else: body 17 px with 1.6 line-height, eyebrows in uppercase 600 with 0.12em tracking. Self-host both as WOFF2.

**Shape and texture:** 8 px spacing grid. 14 px radius on cards, full pill shape on buttons and swatches. Subtle kraft grain (SVG noise, about 5%) only on tags and the Half Dozen section. Warm soft shadows. No other textures.

**Photos:** Use real photos first. Label renders with a small "Studio rendering" caption. Products sit on wood trays or kraft, in warm morning light.

**Motion (minimal):** a one-time 12 px fade-up on sections, a 4 px card lift on hover, 200 ms timing. Everything is off under `prefers-reduced-motion`. No marquees, carousels or autoplay.

## 4. Components (exactly 4)
1. **Flavor-tag product card.** A kraft hang tag with a punched hole and a short sage "band" string. It has the product image on cream, swatch dots with flavor names, the product name (serif), one line of copy, the price or "Ask about this batch", and one button.
2. **Chalkboard price board.** Live HTML text, not an image. Dotted-leader rows: `100 coasters ...... $2.00 ea` · `500 ...... $1.60 ea` · `1,000 ...... $1.20 ea` · `Samples ...... on the house`. Footer: "Locally baked in Jupiter, FL."
3. **Today's Batch board.** The same chalkboard style. It shows the date, tray name, up to 6 flavor rows (swatch, name and short note like "Pumpkin, fall harvest"), and an optional diagonal "Chef's Special" ribbon. It's **rendered from JSON** `{date, tray, batch_no, flavors:[{name,hex,note}], chefs_special}` so it can be updated daily. Visual reference: `todays_batch_fall_feed_1080x1350.jpg`.
4. **Sample box CTA.** A kraft panel with the Half Dozen box image, "Six coasters. One little box. On the house.", and a **[Get a free Half Dozen]** button that opens the modal. It's reused on every page.

Divider: a rounded **sage TPU band** line (8 px, full pill shape) between sections. It's a style rule, not a component.

## 5. Pages

### Page 1: Home `/` (one scroll)
1. **Hero.** On mobile it stacks headline, then board, then CTAs. On desktop it's a split with copy on the left and the board on the right.
   - Eyebrow: "FRESH BAKED DAILY · JUPITER, FL"
   - H1: **"Fresh baked. Built different."**
   - Sub: "Washable TPU coasters and coastal pieces, 3D-printed in small seasonal batches in Jupiter, FL."
   - CTAs: **[Shop the Batch]** (terracotta) → /shop · **[Get a free Half Dozen]** (outline) → modal
   - Right/below: the **Today's Batch board** (current: The Fall Tray, with Pumpkin, Cinnamon, Cranberry, Maple and Rhubarb). Background image: `banner_master_notext_2560x1440.jpg`, softly blurred behind the board on desktop only.
2. **This Week's Tray.** H2 "This week's tray." 4–6 flavor-tag cards (see the Shop list), then "See the whole batch →".
3. **Why we're built different.** (This replaces "How we bake.")
   - H2: **"Quality by design."**
   - Sub: "We're a small studio that bakes in batches, not an assembly line."
   - Five proof beats, each with a kraft line icon (1.5 px cocoa stroke, simple and hand-drawn) and a bold title plus one line:
     - **Small batches.** (icon: bakery tray) "Every tray is designed in-house, seasonal, and baked fresh. No assembly line."
     - **Designed in Jupiter.** (icon: pencil + wave) "Our own design team builds every piece for single-color TPU, tested on our own printers."
     - **Our own studio.** (icon: printer) "A fleet of 30 printers: 10 Bambu P1S, 10 Qidi Max 4 and 10 Prusa Core One, plus in-house compute."
     - **Built to be used.** (icon: coaster + water drop) "Flexible TPU 95A. Washable, dishwasher safe, made for daily use."
     - **Checked before it ships.** (icon: kraft tag with check) "Every piece is [[CONFIRM: hand-checked]] before it leaves the studio."
   - Layout: on mobile, a single column of icon-left rows with 16 px gaps. On desktop, a 5-up row (or 3 + 2) with the sage TPU band divider above and below. Optional image: `bakery_studio_vision.jpg` (caption "Studio rendering").
   - Use only the facts above. No percentages, lifespan claims or extra specs.
4. **The Half Dozen.** The sample box CTA component, with `halfdozen_concept_1_single.jpg` and the line "Windowed kraft box, sage TPU band, the Mrs. Smash tag, and a Today's Batch menu card inside."
5. **For restaurants.** H2 "Your logo, fresh baked." The chalkboard price board, one line ("Custom-logo coasters for bars and restaurants in Jupiter, Palm Beach County and beyond."), and the link **[Wholesale & samples →]**.
6. **Meet Mrs. Smash.** One photo [[DEE PORTRAIT]] and three lines: "Dee is Mrs. Smash: mom of four, wife to one, and the heart of the studio. She and Smash bake every batch right here in Jupiter. A little piece of our happy place."
7. **FAQ (4 questions, accordion):**
   - *What are they made of?* TPU 95A, a flexible printed material. Each listing says if a piece is PLA or PETG.
   - *Are they dishwasher safe?* Yes. TPU pieces are washable and dishwasher safe. [[CONFIRM: top-rack / temperature guidance]]. Wash PLA and PETG pieces by hand.
   - *Can I get my logo on them?* Yes, from 100 coasters. Start with a free Half Dozen.
   - *How fast do you ship?* [[CONFIRM: retail dispatch and wholesale lead times]]
8. **Footer** (cocoa background): stacked logo, "Fresh baked. Built different.", links to Shop / Wholesale & Samples, the contacts (see section 7), "Made in Jupiter, FL", © 2026 JUP LIFE by Mrs. Smash, and the Shipping & Returns and Privacy links (keep the existing pages).

### Page 2: Shop `/shop`
- H1 "The Batch." Sub: "The current tray, plus the always-on favorites."
- **Current tray:** The Fall Tray. Pop coasters in the tray flavors. Price: **Ask about this batch**.
- **Always on (flavor-tag cards):**
  - **6-Coaster Set + Case: $29.** [Add to bag]
  - **The Readers** (thumb page holder + stand): **$19**
  - **Tide Soap Dish** (draining wave ridges, swappable inserts): **Ask about this batch.** Photo: `photo_tide_dish_lime_wave.jpg`
  - **Tide Hand Soap Dispenser** (TPU housing, PETG refill bottle, square-wave base): **Ask about this batch.** Photo: `photo_tide_dispenser_tpu_fade_1.jpg`
  - **Custom logo coasters:** a CTA card, "Your logo, fresh baked → Get a free Half Dozen" (opens the modal)
- Each card has a small material line ("TPU 95A · washable · dishwasher safe" on TPU items only). "Ask about this batch" opens the modal with "Product question" preselected.
- Keep the existing Stripe checkout and bag. No filters needed.

### Page 3: Wholesale & Samples `/wholesale`
1. **Hero.** H1 **"Your logo, fresh baked."** Sub: "Washable, dishwasher-safe TPU 95A coasters with your logo, made in Jupiter, FL." [Get a free Half Dozen]
2. **Price by the batch:** the chalkboard board. Note: "Logo setup, shipping and lead time: [[CONFIRM]]."
3. **How it works** (4 steps): Request a Half Dozen → Try it on your bar → Send your logo → We bake your batch (bulk ships in closed kraft boxes).
4. **Request form (inline):** Name* · Business* · City* · Email* · Phone · Logo upload (optional: PNG, JPG, SVG or PDF, up to 4 MB). Submit button: **"Send my Half Dozen"**. Success message: "It's on the tray. We'll be in touch within [[RESPONSE TIME]]."
5. **Custom orders** (one section): "Something else in mind? Team colors, event gifts, monograms. Tell us the recipe." It uses the same form with an "Order type: Custom" toggle and a notes field.
6. **Contact strip:** wholesale contacts (section 7).

### Modal: Sample request
The same fields as the form on Page 3, plus a hidden "source page" field. It opens from every **Get a free Half Dozen** and **Ask about this batch** button. Focus is trapped, Esc closes it, and the success state matches the form.

## 6. SEO essentials
- Titles:
  - Home: "JUP LIFE | Custom Coasters, Jupiter FL · Fresh Baked"
  - Shop: "Shop the Batch | Washable TPU Coasters | JUP LIFE"
  - Wholesale: "Custom Logo Coasters for Restaurants | Palm Beach County"
- Keywords: custom coasters Jupiter FL, custom logo coasters Palm Beach County, restaurant bar coasters, washable TPU coasters.
- **LocalBusiness schema**: Jupiter, FL, with areaServed Jupiter, Tequesta, Palm Beach Gardens, Juno Beach and Palm Beach County, telephone +1-561-532-7120, email dee@juplifestudio.com. Add Product/Offer schema for the two priced items.
- **301 redirects:** /restaurants → /wholesale. The old /collection/*, weddings and coming-soon pages → /shop.
- OG image: `banner_Website_hero_1920x800.png`.
- **Performance:** AVIF/WebP with srcset, the hero image under 150 KB on mobile, lazy-loading below the fold, JS of about 50 KB or less.

## 7. Contacts (exact)
- **Wholesale: call Smash, 561-532-7120**
- **Email: dee@juplifestudio.com**
- **Text us: 561-581-8015** [[CONFIRM: texting line, show as "Text us" only]]. Never label it as a call number and never use a `tel:` link for it (use `sms:`).
- X: @juplifestudio. TikTok: @juplifestudio.

## 8. Claims guardrails and do-not list
- **Allowed claims only:** washable; dishwasher safe (**TPU parts only**); made in Jupiter, FL; "locally baked" as playful copy; the five facts in "Quality by design".
- ❌ No antimicrobial, antibacterial, hygienic, food-safe or health claims. No "lasts forever", no durability stats or percentages.
- ❌ Never call PLA or PETG parts dishwasher safe.
- ❌ No Gucci, Yurman or other brands' marks or names. No metal-chain imagery.
- ❌ No fake reviews, testimonials, ratings, customer logos or counts.
- ❌ Don't invent prices, emails, phone numbers, lead times or URLs.
- ❌ No About, Drops, Hospitality, Weddings, blog or coming-soon pages. No long FAQ. No carousels, popups on load or autoplay.
- ❌ No ingredient colors in the page chrome, and no light-colored text on kraft.

## 9. Deliverables
The 3 pages and the modal at 375 px and 1440 px, a one-page token and component sheet, semantic HTML/CSS with minimal JS (accordion, modal, form validation, the JSON-driven board), and a handoff list of the open `[[PLACEHOLDERS]]`.

## 10. Acceptance checklist
- [ ] Exactly 3 pages plus 1 modal.
- [ ] Mobile LCP under 2 s. Lighthouse mobile scores of 90+ on Performance, Accessibility and SEO.
- [ ] **"Get a free Half Dozen" is visible above the fold on a 375 × 667 screen.**
- [ ] The price board reads 100 at $2.00 / 500 at $1.60 / 1,000 at $1.20 / samples free, as live text.
- [ ] Today's Batch renders from JSON.
- [ ] "Dishwasher safe" appears only on TPU items. No unverified claims anywhere.
- [ ] Contacts exactly as in section 7. 561-581-8015 appears only as "Text us".
- [ ] The /restaurants → /wholesale 301 redirect works. LocalBusiness schema is valid.
- [ ] AA contrast passes. Reduced motion is respected.

## 11. Placeholders to fill
`[[DEE PORTRAIT]]` · top-rack / dishwasher guidance · retail dispatch and wholesale lead times · logo setup and shipping terms · `[[RESPONSE TIME]]` · confirm "hand-checked" · confirm 561-581-8015 as the texting line · prices for Pop coasters, the Tide dish and the Tide dispenser (until then they show "Ask about this batch") · real photos of the 6-coaster set + case and The Readers.