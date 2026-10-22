# Amendments to BRIEF.md (decided during design, Oct 22 2026)

These override the brief where they conflict.

## Contacts
- **Added `hello@juplifestudio.com`** as the general address ("Say hello"). `dee@juplifestudio.com` stays, labeled "Email Dee". LocalBusiness schema `email` = hello@. Sample-request notifications go to both.

## Home page
- **Today's Batch (Fall Tray) now has 6 flavors**: Pumpkin, Cinnamon, Cranberry, Maple, Rhubarb, **Sunflower ("the hero")**, matching the owner's Pop Coasters flavor board. Sunflower `#F6C21C` is the always-on hero in both Fall and Summer trays.
- **Hero**: the cake-dome studio render (`hero-dome-*.webp`) sits softly blurred behind the board (desktop only). The "Fresh Baked Daily" seal sticker overlaps the board's top-left corner.
- **This week's tray** = 6 cards + a full-width custom-logo CTA strip:
  Fall Tray Pop Coasters · **Stack Bands** (new) · 6-Coaster Set + Case ($29) · **The Gigi** (new) · Tide Soap Dish · Tide Hand Soap Dispenser.
  **The Readers moved to Shop only** (brief caps Home at 6 cards; no photo yet).
  A full-width Fall flavor-board image sits above the cards.
- **New section "Out of the oven."** (after the tray): three tap-to-play vertical shorts. `preload="none"`, no autoplay, posters set.
  - `fresh-baked.mp4` (15 s), `coaster-party.mp4` (15 s), `built-different.mp4` (23.4 s).
  - `built-different.mp4` is the owner's 30 s "Built different" cut **with the "Meet The Gigi." segment (≈17.7–23.9 s) removed** because it shows a gold metal-chain bracelet (brief bans metal-chain imagery). Do not restore the original.
- **Quality by design**: flex close-up render beside the heading; the studio-vision render (`studio-vision.webp`, the brief's optional `bakery_studio_vision.jpg`) full width under the five beats.
- **For restaurants**: beach-table drink render under the copy.
- **Meet Mrs. Smash**: real portrait of Dee (`img/dee-portrait.webp`) with the Mrs. Smash tag as a small sticker. The source photo was **retouched**: the sunglasses' lens wordmark was removed, the temple stripe recolored to plain navy, and the crop sits above her name badge (which carried another business's logo). This keeps the brief's "no other brands' marks" rule. Don't swap in the unretouched original.

## Shop = "the bakery case"
- Eyebrow "The bakery case · Jupiter, FL", H1 "The Batch." + Today's Batch board in the hero.
- Sections: **Today's tray** (Fall flavor board, Pop Coasters, Stack Bands with combo swatches) → **Always on the shelf** ("The everyday bakes": 6-Coaster Set $29, The Readers $19, The Gigi, Tide Soap Dish, Tide Dispenser; extra shots as small thumbnails, no carousel) → **Baked to order** CTA strip.
- `?checkout=success|cancel` banners.

## Wholesale = "The Bakery Counter, for restaurants" (supersedes the earlier audience-tile version)
Built to `docs/WHOLESALE_SPEC.md`. Deviations / decisions:
- **Hero**: split layout on desktop (copy left, photo right) instead of text over the photo. The photo's left side isn't empty (palms, sea), and an overlay panel covered the drink. Mobile: copy + CTA first, so "Claim a free Half Dozen" sits above the fold at 375×667.
- **Price board** shows batch totals plus per-coaster prices: 100 = $200 ($2.00 ea), 500 = $800 ($1.60 ea), 1,000 = $1,200 ($1.20 ea), samples on the house. Live text. The chalkboard background image (03) is not used; the board component already is the chalkboard.
- **Built for service**: "Doesn't chip" carries a visible `[[CONFIRM claim]]` because it is outside the brief's allowed-claims list (§8). "It bends instead of breaking" is kept as a restatement of "Flexible TPU 95A"; the owner should confirm both.
- **Who it's for**: chips = Restaurants · Bars · Boutique hotels · Airbnb hosts · **Events · Custom by design** (last two kept from the owner's earlier ask).
- **Logo mockup** is captioned "Example design, not a client."
- **Sample form** uses **Address** (not City). The API accepts `address` or `city` (one is required). The inline form posts `segment=Restaurant or bar`.
- New images: `ws-hero-bar-*`, `ws-step-taste|order|delivered`, `ws-logo-mockup-example`, `ws-bulk-boxes-studio`, `studio-counter-*`. The step tiles and bulk boxes were cut from the contact sheet at 380 px; swap in full-size files.

## Studio image swap
- `studio-counter-*.webp` (clean, no signage) replaces `studio-vision.webp` on Home (Quality by design) and also appears on Shop (bakery counter banner) and Wholesale (Who it's for).

## Products added
- **Stack Bands**: 3-packs by the batch. Fall: Harvest (Pumpkin/Cinnamon/Maple), Berry Pie (Cranberry/Rhubarb/Maple), Coastal Batch (Sea Salt/Pumpkin/Rhubarb). Summer: Sunset (Peach/Watermelon/Key Lime), Berry Coast (Blueberry/Coconut/Sea Salt), Coastal Batch (Sea Salt/Peach/Coconut). Price: Ask about this batch. Material: unconfirmed, so no material line and no dishwasher claim.
- **The Gigi**: flexible monogram band ("JI" monogram). Price: Ask about this batch. Material: unconfirmed. Owner to sanity-check the name + repeating monogram against the "no other brands' marks" rule.

## Implementation decisions
- Modal and bag use native `<dialog>` (focus containment + Esc built in). FAQ uses `<details>/<summary>` (zero JS).
- Payments: Stripe Checkout (hosted) via `POST /api/checkout`, server-side sku→Price ID mapping, verified webhook.
- Form intake: `POST /api/sample-request` (multipart) with honeypot, per-IP throttle, logo type/size/magic-byte checks, SVG script rejection; notifications via Resend HTTP API (optional; logs otherwise).
